import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

export function getAiClient(customKey?: string) {
  const trimmed = typeof customKey === "string" ? customKey.trim() : "";
  return new GoogleGenAI({
    apiKey: trimmed || process.env.GEMINI_API_KEY || "",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

export function safeParseJsonObject(rawText: string): any {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("AI response did not contain valid JSON metadata.");
  }
}

export function parseMetadataJsonWithFallback(rawText: string): any {
  try {
    return safeParseJsonObject(rawText);
  } catch {
    const titleMatch = rawText.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const descMatch = rawText.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const keywordsMatch = rawText.match(/"keywords"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
    if (!titleMatch && !keywordsMatch) {
      throw new Error("AI response did not contain valid JSON metadata.");
    }
    const title = titleMatch
      ? titleMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : "Stock Asset";
    const description = descMatch
      ? descMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : "";
    let keywords: string[] = [];
    if (keywordsMatch) {
      const kwMatches = keywordsMatch[1].match(/"((?:[^"\\]|\\.)*)"/g);
      if (kwMatches) {
        keywords = kwMatches.map((m) =>
          m.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
        );
      }
    }
    return { title, description, keywords };
  }
}

export function isQuotaOrRateError(err: any): boolean {
  const status = Number(err?.status || err?.upstreamStatus || 0);
  const upper = String(err?.message || err || "").toUpperCase();
  return (
    status === 429 ||
    upper.includes("429") ||
    upper.includes("RESOURCE_EXHAUSTED") ||
    upper.includes("QUOTA") ||
    upper.includes("RATE LIMIT")
  );
}

export function isAuthOrAccessError(err: any): boolean {
  const status = Number(err?.status || err?.upstreamStatus || 0);
  const upper = String(err?.message || err || "").toUpperCase();
  return (
    status === 401 ||
    status === 403 ||
    upper.includes("API_KEY_INVALID") ||
    upper.includes("API KEY NOT VALID") ||
    upper.includes("INVALID_API_KEY") ||
    upper.includes("INVALID API KEY") ||
    upper.includes("PERMISSION_DENIED") ||
    upper.includes("UNAUTHORIZED") ||
    upper.includes("NO VISION-CAPABLE MODEL")
  );
}

export function isTransientBusyError(err: any): boolean {
  if (isQuotaOrRateError(err) || isAuthOrAccessError(err)) return false;
  const status = Number(err?.status || err?.upstreamStatus || 0);
  const upper = String(err?.message || err || "").toUpperCase();
  return (
    status === 503 ||
    status === 504 ||
    upper.includes("503") ||
    upper.includes("UNAVAILABLE") ||
    upper.includes("HIGH DEMAND") ||
    upper.includes("TEMPORARILY BUSY") ||
    upper.includes("ABORT") ||
    upper.includes("TIMEOUT") ||
    upper.includes("TIMED OUT")
  );
}

export function extractCleanUpstreamError(err: any, fallbackMsg: string): string {
  let raw = String(err?.message || fallbackMsg || "").trim();
  if (raw.startsWith("{") || raw.includes('"error"')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.error?.message) raw = String(parsed.error.message);
      else if (parsed?.message) raw = String(parsed.message);
    } catch {
      const match = raw.match(/"message"\s*:\s*"([^"]+)"/);
      if (match?.[1]) raw = match[1];
    }
  }
  if (raw.includes("high demand") || raw.includes("UNAVAILABLE") || raw.includes("503")) {
    return "Gemini AI servers are temporarily busy (503). Please try again in a moment.";
  }
  if (raw.includes("API_KEY_INVALID") || raw.includes("API key not valid")) {
    return "Gemini API key is invalid or unauthorized. Please check your key in AI Configuration.";
  }
  if (raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED") || raw.toLowerCase().includes("quota")) {
    const retryMatch = raw.match(/retry\s+in\s+([\d.]+)s/i);
    const retryHint = retryMatch ? ` (retry in ${Math.ceil(Number(retryMatch[1]))}s)` : "";
    return `Google Gemini API rate limit reached on your API key${retryHint}. Please wait a moment or add an additional key in AI Configuration.`;
  }
  if (
    raw.includes("Unterminated string") ||
    raw.includes("Unexpected end of JSON") ||
    raw.includes("did not contain valid JSON")
  ) {
    return "AI response was truncated during generation. Please retry.";
  }
  if (
    raw.includes("TimeoutError") ||
    raw.includes("aborted due to timeout") ||
    raw.includes("operation was aborted") ||
    raw.includes("AbortError")
  ) {
    return "AI request timed out under server load. Please retry in a moment.";
  }
  return raw || fallbackMsg;
}

export function getFormatLabel(
  fileExtension?: string,
  assetType = "Photo",
  isTransparent = false
): { extUpper: string; phrase: string } {
  const ext = (fileExtension || "").toLowerCase().replace(/^\./, "");
  const extUpper = ext.toUpperCase();
  if (ext === "eps") return { extUpper: "EPS", phrase: "EPS vector illustration" };
  if (ext === "ai") return { extUpper: "AI", phrase: "AI vector illustration" };
  if (ext === "svg") return { extUpper: "SVG", phrase: "SVG vector graphic" };
  if (ext === "pdf") return { extUpper: "PDF", phrase: "PDF vector graphic" };
  if (ext === "png")
    return { extUpper: "PNG", phrase: isTransparent ? "transparent PNG" : "PNG graphic" };
  if (ext === "jpg" || ext === "jpeg") {
    return {
      extUpper: "JPG",
      phrase:
        assetType === "Illustration"
          ? "JPG illustration"
          : assetType === "Vector"
            ? "JPG vector graphic"
            : "JPG photo",
    };
  }
  if (ext === "webp")
    return { extUpper: "WEBP", phrase: isTransparent ? "transparent WebP graphic" : "WebP image" };
  if (["mp4", "mov", "avi", "mkv", "webm", "mpg"].includes(ext))
    return { extUpper: extUpper || "MP4", phrase: `${extUpper || "MP4"} stock video` };
  if (assetType === "Vector") return { extUpper: "VECTOR", phrase: "vector illustration" };
  if (assetType === "Illustration") return { extUpper: "ILLUSTRATION", phrase: "digital illustration" };
  if (assetType === "Video") return { extUpper: "VIDEO", phrase: "stock video footage" };
  return { extUpper: extUpper || "PHOTO", phrase: "stock photo" };
}

export function buildSeoPrompt(settings: any, assetType = "Photo", fileExtension?: string): string {
  const platform = settings?.platform || "Adobe Stock";
  const titleLength = settings?.titleLength || "20-200";
  const keywordCount = settings?.keywordCount || 30;
  const isTransparent = Boolean(settings?.transparentBackground);
  const { extUpper, phrase } = getFormatLabel(fileExtension, assetType, isTransparent);

  return `Stock SEO strategist for ${platform}. Analyze image & return JSON: {"title","description","keywords"}.
Context: Type=${assetType}, Format=${extUpper} (${phrase}), TitleLen=${titleLength} chars, Keywords=${keywordCount} exact, Transparent=${isTransparent ? "MANDATORY" : "AUTO"}.
Title rules: Front-load top commercial subject in first 50 chars; include ${extUpper}/${phrase}; ${
    isTransparent
      ? 'MUST include "transparent" or "isolated on transparent background", NEVER mention "white background".'
      : 'Note "transparent background" if transparent, or "white background" only if solid white.'
  }${settings?.prefix ? ` Start with "${settings.prefix}".` : ""}${settings?.suffix ? ` End with "${settings.suffix}".` : ""}
Keyword rules: Top 10 highest-volume subject/style terms first, then buyer use-cases, mood, format (${extUpper.toLowerCase()}, ${assetType.toLowerCase()}).${
    isTransparent
      ? ' Include "transparent","transparent background","png","isolated","cutout","no background"; exclude white background.'
      : ""
  } No duplicates, weak fillers, or: ${settings?.negativeKeywords || "None"}.`;
}

export function sanitizeTransparentAndFormat(
  result: any,
  settings: any,
  assetType = "Photo",
  fileExtension?: string
) {
  const keywordCount = Number(settings?.keywordCount) || 30;
  const isTransparent = Boolean(settings?.transparentBackground);
  const { extUpper } = getFormatLabel(fileExtension, assetType, isTransparent);

  let title = String(result?.title || "Stock Asset").trim();
  let description = String(result?.description || "").trim();
  let keywords: string[] = Array.isArray(result?.keywords)
    ? result.keywords.map((k: any) => String(k).trim()).filter((k: string) => k.length > 0)
    : [];

  const negList = String(settings?.negativeKeywords || "")
    .split(",")
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);

  if (isTransparent) {
    const stripWhiteBg = (txt: string) =>
      txt
        .replace(
          /\b(?:isolated\s+)?on\s+(?:a\s+|an\s+)?(?:clean\s+|pure\s+|solid\s+)?white\s+background\b/gi,
          "on transparent background"
        )
        .replace(/\bisolated\s+on\s+white\b/gi, "isolated on transparent background")
        .replace(/\b(?:pure\s+|solid\s+)?white\s+background\b/gi, "transparent background")
        .replace(/\bwhite\s+backdrop\b/gi, "transparent background")
        .replace(/\s{2,}/g, " ")
        .replace(/\s+,/g, ",")
        .trim();

    title = stripWhiteBg(title);
    description = stripWhiteBg(description);

    if (!/\btransparent\b/i.test(title)) {
      title = `${title}, Isolated on Transparent Background`;
    }

    keywords = keywords.filter(
      (k) => !/\bwhite\s*(background|backdrop)\b|^on white$|^isolated on white$/i.test(k)
    );

    const requiredTransparentTags = [
      "transparent",
      "transparent background",
      "png",
      "isolated",
      "cutout",
      "no background",
    ];
    const existingLower = new Set(keywords.map((k) => k.toLowerCase()));
    const missingTags = requiredTransparentTags.filter((t) => !existingLower.has(t));
    if (missingTags.length > 0) {
      const keepCount = Math.max(0, keywordCount - missingTags.length);
      keywords = [...keywords.slice(0, keepCount), ...missingTags];
    }
  }

  if (extUpper && extUpper !== "PHOTO" && extUpper !== "ILLUSTRATION" && extUpper !== "VIDEO") {
    const extRegex = new RegExp(`\\b${extUpper}\\b`, "i");
    if (!extRegex.test(title)) {
      if (extUpper === "EPS" || extUpper === "AI" || extUpper === "SVG") {
        title = /\bvector\b/i.test(title)
          ? title.replace(/\bvector\b/i, `${extUpper} Vector`)
          : `${title} ${extUpper} Vector`;
      } else {
        title = `${title} ${extUpper}`;
      }
    }
  } else if (assetType === "Vector" && !/\bvector\b/i.test(title)) {
    title = `${title} Vector`;
  }

  const seen = new Set<string>();
  keywords = keywords.filter((k) => {
    const lower = k.toLowerCase();
    if (seen.has(lower)) return false;
    if (negList.some((neg) => lower.includes(neg))) return false;
    seen.add(lower);
    return true;
  });

  if (keywordCount > 0 && keywords.length > keywordCount) {
    keywords = keywords.slice(0, keywordCount);
  }

  if (settings?.prefix && !title.toLowerCase().startsWith(settings.prefix.trim().toLowerCase())) {
    title = `${settings.prefix.trim()} ${title}`;
  }
  if (settings?.suffix && !title.toLowerCase().endsWith(settings.suffix.trim().toLowerCase())) {
    title = `${title} ${settings.suffix.trim()}`;
  }

  return { title, description, keywords };
}

export function parseImageDataPayload(base64Image: string): { mimeType: string; data: string } {
  let mimeType = "image/jpeg";
  let data = "";
  if (base64Image.startsWith("data:")) {
    const commaIdx = base64Image.indexOf(",");
    const header = commaIdx >= 0 ? base64Image.slice(0, commaIdx) : base64Image;
    data = commaIdx >= 0 ? base64Image.slice(commaIdx + 1).trim() : "";
    const detected = header.match(/data:([^;]+);/i)?.[1]?.toLowerCase() || "image/jpeg";
    if (detected === "image/svg+xml") {
      throw Object.assign(new Error("SVG image must be rasterized to PNG/JPEG before AI analysis."), {
        status: 400,
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
    throw Object.assign(
      new Error("Image payload is empty or corrupted. Please try re-uploading the asset."),
      { status: 400 }
    );
  }
  return { mimeType, data };
}

export async function generateGeminiMetadataWithRecovery(params: {
  apiKey: string;
  data: string;
  mimeType: string;
  prompt: string;
  keywordCount: number;
  settings: any;
  assetType?: string;
  fileExtension?: string;
  isServerless?: boolean;
}) {
  const {
    apiKey,
    data,
    mimeType,
    prompt,
    keywordCount,
    settings,
    assetType = "Photo",
    fileExtension,
    isServerless = false,
  } = params;

  const ai = getAiClient(apiKey);
  const totalBudgetMs = isServerless ? 8900 : 17500;
  const requestDeadline = Date.now() + totalBudgetMs;

  const runGeminiCall = (model: string, thinkingLevel: ThinkingLevel, timeoutMs: number) =>
    ai.models.generateContent({
      model,
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
        thinkingConfig: { thinkingLevel },
        abortSignal: AbortSignal.timeout(Math.max(1500, timeoutMs)),
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

  // Primary lightweight model (MINIMAL thinking, zero token waste).
  // Switch to Hydrogen / retry briefly ONLY on 503/timeout — NEVER retry 429/401/403 on the same key.
  const stages: Array<{ model: string; thinking: ThinkingLevel; maxTimeoutMs: number; delayBeforeMs: number }> =
    isServerless
      ? [
          { model: "gemini-3.1-flash-lite", thinking: ThinkingLevel.MINIMAL, maxTimeoutMs: 4400, delayBeforeMs: 0 },
          { model: "gemini-4-hydrogen", thinking: ThinkingLevel.LOW, maxTimeoutMs: 4200, delayBeforeMs: 0 },
          { model: "gemini-3.1-flash-lite", thinking: ThinkingLevel.MINIMAL, maxTimeoutMs: 4000, delayBeforeMs: 700 },
        ]
      : [
          { model: "gemini-3.1-flash-lite", thinking: ThinkingLevel.MINIMAL, maxTimeoutMs: 5500, delayBeforeMs: 0 },
          { model: "gemini-4-hydrogen", thinking: ThinkingLevel.LOW, maxTimeoutMs: 6500, delayBeforeMs: 0 },
          { model: "gemini-3.1-flash-lite", thinking: ThinkingLevel.MINIMAL, maxTimeoutMs: 5500, delayBeforeMs: 850 },
          { model: "gemini-4-hydrogen", thinking: ThinkingLevel.LOW, maxTimeoutMs: 6000, delayBeforeMs: 1150 },
        ];

  let lastErr: any = null;

  for (let idx = 0; idx < stages.length; idx++) {
    const stage = stages[idx];
    if (stage.delayBeforeMs > 0) {
      const jitter = Math.floor(Math.random() * 200);
      const waitMs = stage.delayBeforeMs + jitter;
      if (requestDeadline - Date.now() <= waitMs + 1800) {
        break;
      }
      await new Promise((r) => setTimeout(r, waitMs));
    }

    const remaining = requestDeadline - Date.now();
    if (remaining < 1700) {
      break;
    }

    try {
      const response = await runGeminiCall(
        stage.model,
        stage.thinking,
        Math.min(stage.maxTimeoutMs, remaining - 150)
      );
      if (!response || !response.text) {
        throw new Error("No response returned from Gemini API");
      }
      const parsed = parseMetadataJsonWithFallback(response.text);
      return sanitizeTransparentAndFormat(parsed, settings || {}, assetType, fileExtension);
    } catch (err: any) {
      lastErr = err;
      if (!isTransientBusyError(err)) {
        // Immediate exit on 429 quota, 401/403 invalid key, or bad payload
        throw err;
      }
    }
  }

  throw lastErr || new Error("Gemini AI servers are temporarily busy (503). Please try again in a moment.");
}

const serverGroqModelsCache = new Map<string, { models: string[]; expiresAt: number }>();

async function discoverGroqVisionModels(apiKey: string): Promise<string[]> {
  const cached = serverGroqModelsCache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt && cached.models.length > 0) {
    return cached.models;
  }

  const preferredOrder = [
    "qwen/qwen3.8-27b",
    "meta-models/muse-spark-open",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct",
  ];
  const fallbackDefaults = ["qwen/qwen3.8-27b", "meta-models/muse-spark-open"];

  let res: Response | null = null;
  try {
    res = await fetch("https://api.groq.com/openai/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(3500),
    });
  } catch {
    return fallbackDefaults;
  }

  if (res.status === 401 || res.status === 403) {
    throw Object.assign(
      new Error("Groq API key is invalid or unauthorized. Please check your key in AI Configuration."),
      { status: res.status }
    );
  }

  if (!res.ok) {
    return fallbackDefaults;
  }

  const payload = await res.json().catch(() => null);
  const allIds: string[] = Array.isArray(payload?.data)
    ? payload.data.map((m: any) => String(m?.id || "")).filter(Boolean)
    : [];

  if (allIds.length === 0) {
    return fallbackDefaults;
  }

  const excluded = /whisper|playai|tts|guard|safeguard|embed|orpheus|allam|compound/i;
  const visionCandidates = allIds.filter(
    (id) =>
      !excluded.test(id) &&
      /(qwen3\.8|muse-spark|vision|\bvl\b|pixtral|llava|gemma-3|llama-4|multimodal|omni)/i.test(id)
  );

  if (visionCandidates.length === 0) {
    throw Object.assign(
      new Error(
        "Groq key has no vision-capable model (such as qwen/qwen3.8-27b) enabled in Groq Console -> Model Permissions. Enable a vision model in Groq Console or use a Gemini API key."
      ),
      { status: 403 }
    );
  }

  const ordered = [
    ...preferredOrder.filter((id) => visionCandidates.includes(id)),
    ...visionCandidates.filter((id) => !preferredOrder.includes(id)),
  ];

  serverGroqModelsCache.set(apiKey, {
    models: ordered,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return ordered;
}

export async function generateGroqMetadataServer(params: {
  base64Image: string;
  apiKey: string;
  prompt: string;
  settings: any;
  assetType?: string;
  fileExtension?: string;
  isServerless?: boolean;
}) {
  const {
    base64Image,
    apiKey,
    prompt,
    settings,
    assetType = "Photo",
    fileExtension,
    isServerless = false,
  } = params;

  const candidateModels = await discoverGroqVisionModels(apiKey);
  const deadline = Date.now() + (isServerless ? 8800 : 16000);
  let lastError: any = null;

  for (const modelName of candidateModels) {
    let useJsonMode = true;
    let useReasoningNone = /qwen3\.8/i.test(modelName);

    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 1600) {
        throw lastError || Object.assign(new Error("Groq request timed out under load."), { status: 504 });
      }

      try {
        const bodyPayload: any = {
          model: modelName,
          temperature: 0.4,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: base64Image,
                  },
                },
              ],
            },
          ],
        };
        if (useJsonMode) {
          bodyPayload.response_format = { type: "json_object" };
        }
        if (useReasoningNone) {
          bodyPayload.reasoning_effort = "none";
        }

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(bodyPayload),
          signal: AbortSignal.timeout(Math.min(8200, remaining - 150)),
        });

        const rawText = await response.text();
        let result: any = null;
        if (rawText) {
          try {
            result = JSON.parse(rawText);
          } catch {
            result = null;
          }
        }

        if (!response.ok) {
          const msg = result?.error?.message || response.statusText || `HTTP ${response.status}`;
          throw Object.assign(new Error(msg), { status: response.status });
        }

        const content = result?.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error("No response content returned from Groq");
        }

        const parsed = parseMetadataJsonWithFallback(content);
        return sanitizeTransparentAndFormat(parsed, settings || {}, assetType, fileExtension);
      } catch (err: any) {
        lastError = err;
        const status = Number(err?.status || 0);
        const msg = String(err?.message || "");
        const upper = msg.toUpperCase();

        if (status === 400 && useReasoningNone && /reasoning_effort/i.test(msg)) {
          useReasoningNone = false;
          continue;
        }
        if (status === 400 && useJsonMode && /response_format|json_object|json/i.test(msg)) {
          useJsonMode = false;
          continue;
        }
        if (status === 401 || status === 403 || upper.includes("INVALID_API_KEY") || upper.includes("UNAUTHORIZED")) {
          throw Object.assign(new Error(`Groq API Error: ${msg}`), { status: status || 401 });
        }
        if (status === 429 || upper.includes("RATE LIMIT")) {
          throw Object.assign(new Error(`Groq API Error: ${msg}`), { status: 429 });
        }
        // On 404 (model access disabled) or 503, move to next candidate model
        break;
      }
    }
  }

  const finalMsg = String(lastError?.message || "Failed to generate metadata via Groq");
  if (/does not exist|do not have access/i.test(finalMsg)) {
    throw Object.assign(
      new Error(
        `Groq API Error: No vision model could be accessed on this Groq key (${finalMsg}). Check Groq Console -> Model Permissions or use a Gemini API key.`
      ),
      { status: 403 }
    );
  }
  throw Object.assign(new Error(`Groq API Error: ${finalMsg}`), {
    status: Number(lastError?.status || 500),
  });
}

export function applyCors(req: any, res: any): boolean {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

