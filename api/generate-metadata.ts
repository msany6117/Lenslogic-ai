import { ThinkingLevel, Type } from "@google/genai";
import {
  applyCors,
  buildSeoPrompt,
  extractCleanUpstreamError,
  fingerprintKey,
  getAiClient,
  modelQuotaCooldown,
  modelTransientCooldown,
  recordModelCooldownIfDailyQuota,
  safeParseJsonObject,
  sanitizeTransparentAndFormat,
} from "./_geminiShared.js";

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  let hadDailyQuota429 = false;
  let primaryModelErr: any = null;

  try {
    const { base64Image, settings, apiKey, assetType, fileExtension } = req.body || {};

    const customKey = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!customKey) {
      return res.status(400).json({
        error: "API key required. Please add your Gemini API key in AI Configuration.",
      });
    }

    if (typeof base64Image !== "string" || !base64Image.trim() || base64Image.startsWith("blob:")) {
      return res.status(400).json({
        error:
          "Invalid or missing image preview data. Please re-upload the file or attach a JPG/PNG preview.",
      });
    }

    let mimeType = "image/jpeg";
    let data = "";
    if (base64Image.startsWith("data:")) {
      const commaIdx = base64Image.indexOf(",");
      const header = commaIdx >= 0 ? base64Image.slice(0, commaIdx) : base64Image;
      data = commaIdx >= 0 ? base64Image.slice(commaIdx + 1).trim() : "";
      const detected = header.match(/data:([^;]+);/i)?.[1]?.toLowerCase() || "image/jpeg";
      if (detected === "image/svg+xml") {
        return res.status(400).json({
          error: "SVG image must be rasterized to PNG/JPEG before AI analysis.",
        });
      }
      const allowedMimes = new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
      ]);
      mimeType = allowedMimes.has(detected) ? detected : "image/jpeg";
    } else {
      data = base64Image.trim();
    }

    if (!data || data.length < 16) {
      return res.status(400).json({
        error: "Image payload is empty or corrupted. Please try re-uploading the asset.",
      });
    }

    const ai = getAiClient(customKey);
    const keyFingerprint = fingerprintKey(customKey);
    const prompt = buildSeoPrompt(settings || {}, assetType || "Photo", fileExtension);
    const keywordCount = Number(settings?.keywordCount) || 30;

    const baseSchedule: Array<{
      model: string;
      thinkingLevel?: ThinkingLevel;
      delayBeforeMs: number;
      timeoutMs: number;
    }> = [
      { model: "gemini-4-hydrogen", thinkingLevel: ThinkingLevel.LOW, delayBeforeMs: 0, timeoutMs: 8000 },
      { model: "gemini-3.1-flash-lite", delayBeforeMs: 0, timeoutMs: 16000 },
      { model: "gemini-3.1-flash-lite", delayBeforeMs: 400, timeoutMs: 20000 },
    ];

    const now = Date.now();
    const primaryCooldownUntil = modelQuotaCooldown.get(`${keyFingerprint}:gemini-4-hydrogen`) || 0;
    hadDailyQuota429 = now < primaryCooldownUntil;

    let attemptSchedule = baseSchedule.filter((cfg) => {
      const quotaUntil = modelQuotaCooldown.get(`${keyFingerprint}:${cfg.model}`) || 0;
      const transientUntil = modelTransientCooldown.get(`${keyFingerprint}:${cfg.model}`) || 0;
      return now >= quotaUntil && now >= transientUntil;
    });
    if (attemptSchedule.length === 0) {
      attemptSchedule = [
        { model: "gemini-3.1-flash-lite", delayBeforeMs: 0, timeoutMs: 18000 },
        { model: "gemini-4-hydrogen", thinkingLevel: ThinkingLevel.LOW, delayBeforeMs: 500, timeoutMs: 20000 },
      ];
    }

    let response: any = null;
    let lastErr: any = null;
    let prevModel: string | null = null;

    for (const cfg of attemptSchedule) {
      const sameModelRetry = prevModel === cfg.model;
      prevModel = cfg.model;
      if (sameModelRetry && cfg.delayBeforeMs > 0) {
        const jitter = Math.floor(Math.random() * 150);
        await new Promise((resolve) => setTimeout(resolve, cfg.delayBeforeMs + jitter));
      }
      try {
        response = await ai.models.generateContent({
          model: cfg.model,
          contents: {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  data,
                  mimeType,
                },
              },
            ],
          },
          config: {
            ...(cfg.thinkingLevel ? { thinkingConfig: { thinkingLevel: cfg.thinkingLevel } } : {}),
            abortSignal: AbortSignal.timeout(cfg.timeoutMs),
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: {
                  type: Type.STRING,
                  description: "High-ranking SEO stock title optimized for downloads.",
                },
                description: {
                  type: Type.STRING,
                  description: "A clear semantic description for stock search indexing.",
                },
                keywords: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: `A flat array of exactly ${keywordCount} keywords ordered by search relevance.`,
                },
              },
              required: ["title", "description", "keywords"],
            },
          },
        });
        if (response?.text) {
          modelTransientCooldown.delete(`${keyFingerprint}:${cfg.model}`);
          break;
        }
      } catch (e: any) {
        lastErr = e;
        const rawMsg = String(e?.message || e || "");
        const upper = rawMsg.toUpperCase();
        if (
          cfg.model === "gemini-4-hydrogen" &&
          !upper.includes("503") &&
          !upper.includes("UNAVAILABLE") &&
          !upper.includes("ABORT") &&
          !upper.includes("TIMEOUT")
        ) {
          primaryModelErr = e;
        }
        if (recordModelCooldownIfDailyQuota(keyFingerprint, cfg.model, rawMsg)) {
          hadDailyQuota429 = true;
        } else if (
          upper.includes("503") ||
          upper.includes("UNAVAILABLE") ||
          upper.includes("HIGH DEMAND") ||
          upper.includes("ABORT") ||
          upper.includes("TIMEOUT")
        ) {
          modelTransientCooldown.set(`${keyFingerprint}:${cfg.model}`, Date.now() + 90 * 1000);
        }

        if (
          upper.includes("API_KEY_INVALID") ||
          upper.includes("API KEY NOT VALID") ||
          upper.includes("PERMISSION_DENIED") ||
          upper.includes("403") ||
          upper.includes("INVALID_ARGUMENT")
        ) {
          break;
        }
      }
    }

    if (!response || !response.text) {
      throw primaryModelErr || lastErr || new Error("No response returned from Gemini API");
    }

    const parsed = safeParseJsonObject(response.text);
    const result = sanitizeTransparentAndFormat(
      parsed,
      settings || {},
      assetType || "Photo",
      fileExtension
    );

    return res.status(200).json(result);
  } catch (err: any) {
    const raw = String(err?.message || "");
    let cleanMsg = extractCleanUpstreamError(err, "AI metadata generation failed");
    const isBusy503 = raw.includes("503") || raw.includes("UNAVAILABLE") || raw.includes("high demand");
    if (isBusy503 && hadDailyQuota429) {
      cleanMsg =
        "Your Gemini API key has reached its free-tier daily quota (429) and the fallback model is temporarily busy (503). Please try another key or Groq key in AI Configuration.";
    }
    const isQuota429 = raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED");
    const isAuth403 =
      raw.includes("API_KEY_INVALID") || raw.includes("PERMISSION_DENIED") || raw.includes("403");
    const status = isQuota429 || isBusy503 ? 429 : isAuth403 ? 401 : 500;
    return res.status(status).json({
      error: cleanMsg,
      upstreamStatus: isQuota429 ? 429 : isBusy503 ? 503 : isAuth403 ? 403 : 500,
    });
  }
}
