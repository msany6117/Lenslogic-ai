import { ThinkingLevel, Type } from "@google/genai";
import {
  applyCors,
  buildSeoPrompt,
  extractCleanUpstreamError,
  getAiClient,
  safeParseJsonObject,
  sanitizeTransparentAndFormat,
} from "./_geminiShared.js";

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

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
    const prompt = buildSeoPrompt(settings || {}, assetType || "Photo", fileExtension);
    const keywordCount = Number(settings?.keywordCount) || 30;

    const attemptSchedule: Array<{
      model: string;
      thinkingLevel?: ThinkingLevel;
      delayBeforeMs: number;
      timeoutMs: number;
    }> = [
      { model: "gemini-4-hydrogen", thinkingLevel: ThinkingLevel.LOW, delayBeforeMs: 0, timeoutMs: 8000 },
      { model: "gemini-3.1-flash-lite", delayBeforeMs: 0, timeoutMs: 11000 },
      { model: "gemini-4-hydrogen", thinkingLevel: ThinkingLevel.LOW, delayBeforeMs: 1100, timeoutMs: 11000 },
      { model: "gemini-3.1-flash-lite", delayBeforeMs: 1800, timeoutMs: 12000 },
    ];

    let response: any = null;
    let lastErr: any = null;
    let skipPrimaryForRequest = false;

    for (let idx = 0; idx < attemptSchedule.length; idx++) {
      const baseCfg = attemptSchedule[idx];
      const cfg =
        skipPrimaryForRequest && baseCfg.model === "gemini-4-hydrogen"
          ? { ...baseCfg, model: "gemini-3.1-flash-lite", thinkingLevel: undefined }
          : baseCfg;

      if (idx > 0 && cfg.delayBeforeMs > 0) {
        const jitter = Math.floor(Math.random() * 350);
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
        if (
          cfg.model === "gemini-4-hydrogen" &&
          (/GenerateRequestsPerDay|limit:\s*0\b/i.test(rawMsg) || upper.includes("429"))
        ) {
          skipPrimaryForRequest = true;
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
    const cleanMsg = extractCleanUpstreamError(err, "AI metadata generation failed");
    const isBusy503 = raw.includes("503") || raw.includes("UNAVAILABLE") || raw.includes("high demand");
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
