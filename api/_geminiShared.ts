import { GoogleGenAI } from "@google/genai";

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
  if (raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED") || raw.includes("quota")) {
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
    raw.includes("operation was aborted")
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

  return `
      You are an elite Stock Marketplace SEO Strategist who ranks assets #1 on ${platform}, Shutterstock, and Freepik for maximum contributor downloads.
      Analyze the image carefully and generate ultra-high-converting, buyer-intent metadata.

      Asset Context:
      - Target Marketplace: ${platform}
      - Asset Type: ${assetType}
      - File Format: ${extUpper} (${phrase})
      - Title Length Target: ${titleLength} characters (strictly respect this length window).
      - Keyword Count: Exactly ${keywordCount} keywords.
      - Transparent Background Mode: ${isTransparent ? "ENABLED (MANDATORY)" : "AUTO-DETECT"}

      Title SEO Rules (CRITICAL for top search ranking & downloads):
      1. Front-load the most-searched primary subject, action, and commercial concept in the FIRST 50 characters.
      2. ALWAYS naturally include the asset/file format (${extUpper} / ${phrase}) inside the title so buyers filtering or searching for "${extUpper}" or "${assetType.toLowerCase()}" find this asset immediately.
      3. Include visual style, mood, composition, or commercial use-case (e.g., flat minimalist, 3D render, vibrant gradient, marketing banner, UI icon) without robotic repetition.
      ${
        isTransparent
          ? `4. TRANSPARENT RULE (STRICT): This file has a transparent background. You MUST explicitly include "transparent" or "isolated on transparent background" in the title. NEVER write "white background", "on white", "isolated on white", or "white backdrop" anywhere in the title, description, or keywords.`
          : `4. Background Rule: Only describe a white background if it is visibly solid white; if isolated or transparent, state "isolated on transparent background" or "isolated graphic".`
      }
      ${settings?.prefix ? `5. Title Prefix context: Start naturally with or accommodate prefix "${settings.prefix}".` : ""}
      ${settings?.suffix ? `6. Title Suffix context: End naturally with or accommodate suffix "${settings.suffix}".` : ""}

      Keyword SEO Rules (Ordered strictly by search weight — strongest 10 keywords FIRST):
      1. Top 10 keywords MUST be the highest-volume exact-match subject, style, and main commercial concept terms.
      2. Remaining keywords MUST blend high-converting buyer-intent phrases, commercial use-cases (branding, web design, poster, banner, marketing, presentation, template), color/mood/lighting descriptors, and format/asset tags (${extUpper.toLowerCase()}, ${assetType.toLowerCase()}).
      ${
        isTransparent
          ? `3. TRANSPARENT & PNG KEYWORDS REQUIRED: Include high-traffic transparent keywords ("transparent", "transparent background", "png", "isolated", "cutout", "no background", "alpha channel") among the keywords. Exclude any "white background" keywords.`
          : ""
      }
      4. Exclude weak filler words ("nice", "good", "file", "picture"), duplicates, and prohibited terms: ${settings?.negativeKeywords || "None"}.

      Output strictly valid JSON with keys: "title", "description", "keywords" (array of ${keywordCount} unique SEO keywords).
    `;
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
