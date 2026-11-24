import type { GenerationSettings, ApiKeyEntry, AssetType } from "../types";
import { compressImage } from "../lib/utils";
import { getApiUrl } from "./dbService";

function getFormatLabel(fileExtension?: string, assetType: AssetType = 'Photo', isTransparent = false): { extUpper: string; phrase: string } {
  const ext = (fileExtension || '').toLowerCase().replace(/^\./, '');
  const extUpper = ext.toUpperCase();
  if (ext === 'eps') return { extUpper: 'EPS', phrase: 'EPS vector illustration' };
  if (ext === 'ai') return { extUpper: 'AI', phrase: 'AI vector illustration' };
  if (ext === 'svg') return { extUpper: 'SVG', phrase: 'SVG vector graphic' };
  if (ext === 'pdf') return { extUpper: 'PDF', phrase: 'PDF vector graphic' };
  if (ext === 'png') return { extUpper: 'PNG', phrase: isTransparent ? 'transparent PNG' : 'PNG graphic' };
  if (ext === 'jpg' || ext === 'jpeg') {
    return { extUpper: 'JPG', phrase: assetType === 'Illustration' ? 'JPG illustration' : assetType === 'Vector' ? 'JPG vector graphic' : 'JPG photo' };
  }
  if (ext === 'webp') return { extUpper: 'WEBP', phrase: isTransparent ? 'transparent WebP graphic' : 'WebP image' };
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'mpg'].includes(ext)) return { extUpper: extUpper || 'MP4', phrase: `${extUpper || 'MP4'} stock video` };
  if (assetType === 'Vector') return { extUpper: 'VECTOR', phrase: 'vector illustration' };
  if (assetType === 'Illustration') return { extUpper: 'ILLUSTRATION', phrase: 'digital illustration' };
  if (assetType === 'Video') return { extUpper: 'VIDEO', phrase: 'stock video footage' };
  return { extUpper: extUpper || 'PHOTO', phrase: 'stock photo' };
}

export function buildSeoPrompt(settings: GenerationSettings, assetType: AssetType = 'Photo', fileExtension?: string): string {
  const isTransparent = Boolean(settings.transparentBackground);
  const { extUpper, phrase } = getFormatLabel(fileExtension, assetType, isTransparent);

  return `
    You are an elite Stock Marketplace SEO Strategist who ranks assets #1 on ${settings.platform}, Shutterstock, and Freepik for maximum contributor downloads.
    Analyze the image carefully and generate ultra-high-converting, buyer-intent metadata.

    Asset Context:
    - Target Marketplace: ${settings.platform}
    - Asset Type: ${assetType}
    - File Format: ${extUpper} (${phrase})
    - Title Length Target: ${settings.titleLength} characters (strictly respect this length window).
    - Keyword Count: Exactly ${settings.keywordCount} keywords.
    - Transparent Background Mode: ${isTransparent ? 'ENABLED (MANDATORY)' : 'AUTO-DETECT'}

    Title SEO Rules (CRITICAL for top search ranking & downloads):
    1. Front-load the most-searched primary subject, action, and commercial concept in the FIRST 50 characters.
    2. ALWAYS naturally include the asset/file format (${extUpper} / ${phrase}) inside the title so buyers filtering or searching for "${extUpper}" or "${assetType.toLowerCase()}" find this asset immediately.
    3. Include visual style, mood, composition, or commercial use-case without robotic repetition.
    ${isTransparent
      ? `4. TRANSPARENT RULE (STRICT): This file has a transparent background. You MUST explicitly include "transparent" or "isolated on transparent background" in the title. NEVER write "white background", "on white", "isolated on white", or "white backdrop" anywhere in the title, description, or keywords.`
      : `4. Background Rule: Only describe a white background if it is visibly solid white; if isolated or transparent, state "isolated on transparent background" or "isolated graphic".`}
    ${settings.prefix ? `5. Title Prefix context: Start naturally with or accommodate prefix "${settings.prefix}".` : ''}
    ${settings.suffix ? `6. Title Suffix context: End naturally with or accommodate suffix "${settings.suffix}".` : ''}

    Keyword SEO Rules (Ordered strictly by search weight — strongest 10 keywords FIRST):
    1. Top 10 keywords MUST be the highest-volume exact-match subject, style, and main commercial concept terms.
    2. Remaining keywords MUST blend high-converting buyer-intent phrases, commercial use-cases, color/mood/lighting descriptors, and format/asset tags (${extUpper.toLowerCase()}, ${assetType.toLowerCase()}).
    ${isTransparent
      ? `3. TRANSPARENT & PNG KEYWORDS REQUIRED: Include high-traffic transparent keywords ("transparent", "transparent background", "png", "isolated", "cutout", "no background", "alpha channel") among the keywords. Exclude any "white background" keywords.`
      : ''}
    4. Exclude weak filler words ("nice", "good", "file", "picture"), duplicates, and prohibited terms: ${settings.negativeKeywords || 'None'}.

    Output strictly valid JSON with keys: "title", "description", "keywords" (array of ${settings.keywordCount} unique SEO keywords).
  `;
}

export async function generateMetadata(
  base64Image: string,
  settings: GenerationSettings,
  activeKey: ApiKeyEntry | null,
  assetType: AssetType = 'Photo',
  fileExtension?: string
): Promise<{ title: string; description: string; keywords: string[] }> {
  
  // Skip redundant re-compression only when caller already compressed image to a compact raster JPEG/PNG/WebP data URL
  let optimizedBase64 = base64Image;
  const isCompactRasterDataUrl = /^data:image\/(jpeg|png|webp);base64,/i.test(base64Image) && base64Image.length < 150000;
  if (!isCompactRasterDataUrl) {
    try {
      const compressed = await compressImage(base64Image, 384, 384, 0.68);
      if (compressed) {
        optimizedBase64 = compressed;
      }
    } catch (err) {
      console.warn("Failed to compress image for AI service, sending original:", err);
    }
  }

  if (!/^data:image\/(jpeg|png|webp|heic|heif);base64,[A-Za-z0-9+/=]{16,}/i.test(optimizedBase64)) {
    throw new Error("Could not encode image preview for AI analysis. Please attach a valid JPG or PNG preview.");
  }

  // If the user explicitly has a Groq key active, use Groq provider directly
  if (activeKey && activeKey.provider === 'Groq' && activeKey.key?.trim()) {
    const prompt = buildSeoPrompt(settings, assetType, fileExtension);
    return await callGroq(optimizedBase64, prompt, activeKey.key.trim(), settings, assetType, fileExtension);
  }

  // Collect user-provided Gemini API keys (active key first)
  const orderedGeminiKeys: string[] = [];
  if (activeKey?.provider === 'Gemini' && activeKey.key?.trim()) {
    orderedGeminiKeys.push(activeKey.key.trim());
  }
  for (const entry of settings.apiKeys || []) {
    const trimmed = entry?.provider === 'Gemini' ? entry.key?.trim() : '';
    if (trimmed && !orderedGeminiKeys.includes(trimmed)) {
      orderedGeminiKeys.push(trimmed);
    }
  }
  if (orderedGeminiKeys.length === 0) {
    const fallbackGroq = (settings.apiKeys || []).find((k) => k?.provider === 'Groq' && k.key?.trim());
    if (fallbackGroq?.key?.trim()) {
      const prompt = buildSeoPrompt(settings, assetType, fileExtension);
      return await callGroq(optimizedBase64, prompt, fallbackGroq.key.trim(), settings, assetType, fileExtension);
    }
    throw new Error("API key required. Please add your Gemini or Groq API key in AI Configuration.");
  }

  const requestMetadataFromServer = async (geminiKey: string) => {
    const payload = JSON.stringify({
      base64Image: optimizedBase64,
      settings,
      apiKey: geminiKey,
      assetType,
      fileExtension
    });

    const primaryUrl = getApiUrl("/api/generate-metadata");
    const candidateUrls = primaryUrl !== "/api/generate-metadata"
      ? [primaryUrl, "/api/generate-metadata"]
      : [primaryUrl];

    let lastFetchErr: Error | null = null;

    for (let idx = 0; idx < candidateUrls.length; idx++) {
      const targetUrl = candidateUrls[idx];
      let response: Response;
      try {
        response = await fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload
        });
      } catch (networkErr: any) {
        lastFetchErr = networkErr instanceof Error ? networkErr : new Error("Network request failed");
        continue;
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const rawBody = await response.text();
      let parsedBody: any = null;
      if (rawBody) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = null;
        }
      }

      const isHtml = contentType.includes("text/html") || /^\s*<!doctype|^\s*<html/i.test(rawBody);
      if (isHtml && idx < candidateUrls.length - 1) {
        // Stale custom API URL returned HTML; retry on same-origin /api/generate-metadata
        continue;
      }

      if (!response.ok) {
        const errorMessage =
          parsedBody?.error ||
          (isHtml
            ? `Server returned an HTML error page (HTTP ${response.status}). Please retry in a moment.`
            : `Server generation failed (Status: ${response.status})`);
        const err = new Error(errorMessage) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      if (!parsedBody) {
        throw new Error(
          isHtml
            ? "Metadata API endpoint returned HTML instead of JSON. Please refresh or ensure the backend server is running."
            : "Invalid non-JSON response received from server metadata engine."
        );
      }

      if (!parsedBody.title || !Array.isArray(parsedBody.keywords)) {
        throw new Error("Invalid output received from server metadata engine.");
      }

      return parseAndPolish(JSON.stringify(parsedBody), settings, assetType, fileExtension);
    }

    throw lastFetchErr || new Error("Failed to reach metadata API endpoint.");
  };

  let lastKeyError: any = null;
  for (let i = 0; i < orderedGeminiKeys.length; i++) {
    try {
      return await requestMetadataFromServer(orderedGeminiKeys[i]);
    } catch (err: any) {
      lastKeyError = err;
      const status = Number(err?.status || 0);
      const msg = String(err?.message || '').toLowerCase();
      const isRetryableWithNextKey =
        status === 429 ||
        status === 503 ||
        status === 401 ||
        status === 403 ||
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('quota') ||
        msg.includes('busy');
      if (!isRetryableWithNextKey || i === orderedGeminiKeys.length - 1) {
        throw err;
      }
    }
  }

  throw lastKeyError || new Error("Metadata generation failed.");
}

async function callGroq(
  base64Image: string,
  prompt: string,
  apiKey: string,
  settings: GenerationSettings,
  assetType: AssetType = 'Photo',
  fileExtension?: string
) {
  // Compress the image specifically for Groq to guarantee it fits under Groq's payload limit (avoid "Request Entity Too Large" errors)
  let compressedForGroq = base64Image;
  try {
    compressedForGroq = await compressImage(base64Image, 300, 300, 0.5);
  } catch (err) {
    console.warn("Failed to compress image specifically for Groq:", err);
  }

  // Active Groq multimodal vision models
  const candidateModels = [
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct"
  ];
  
  let lastError: any = null;

  for (const modelName of candidateModels) {
    try {
      console.log(`Analyzing image using Groq model ${modelName}...`);
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: compressedForGroq
                  }
                }
              ]
            }
          ],
          response_format: { type: "json_object" }
        })
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
        throw new Error(result?.error?.message || response.statusText || `HTTP ${response.status}`);
      }

      if (!result) {
        throw new Error("Groq returned a non-JSON response. Please try again.");
      }

      const content = result.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("No response content from Groq");
      }
      
      return parseAndPolish(content, settings, assetType, fileExtension);
    } catch (error: any) {
      lastError = error;
      const errMsg = String(error?.message || "").toUpperCase();
      console.warn(`Groq model ${modelName} failed. Error:`, error);
      
      // If it's an API Key or permission error, do not fallback to other models
      if (errMsg.includes("API_KEY") || errMsg.includes("403") || errMsg.includes("UNAUTHORIZED")) {
        break;
      }
    }
  }

  throw new Error(`Groq API Error: ${lastError?.message || "Failed to generate metadata via Groq"}`);
}

function cleanAndRepairJson(str: string): string {
  let cleaned = str.trim();
  
  // Clean markdown blocks if present
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  
  // Find first opening brace
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace !== -1) {
    cleaned = cleaned.substring(firstBrace);
  }
  
  // Try direct parsing first
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch (_) {}
  
  // Try to find the exact matching closing brace for the first top-level object
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;
  let cutIndex = -1;
  
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') {
        openBraces++;
      } else if (char === '}') {
        openBraces--;
        if (openBraces === 0 && openBrackets === 0) {
          cutIndex = i + 1;
          break;
        }
      } else if (char === '[') {
        openBrackets++;
      } else if (char === ']') {
        openBrackets--;
      }
    }
  }
  
  if (cutIndex !== -1) {
    const candidate = cleaned.substring(0, cutIndex).trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch (_) {}
  }
  
  // If we couldn't find a clean match (e.g. truncated), let's repair it
  let repaired = cleaned;
  
  // Count again to see what is unclosed
  let activeBraces = 0;
  let activeBrackets = 0;
  let insideStr = false;
  let isEscaped = false;
  
  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (char === '\\') {
      isEscaped = true;
      continue;
    }
    if (char === '"') {
      insideStr = !insideStr;
      continue;
    }
    if (!insideStr) {
      if (char === '{') activeBraces++;
      else if (char === '}') activeBraces--;
      else if (char === '[') activeBrackets++;
      else if (char === ']') activeBrackets--;
    }
  }
  
  if (insideStr) {
    repaired += '"';
  }
  
  repaired = repaired.trim();
  if (repaired.endsWith(',')) {
    repaired = repaired.slice(0, -1).trim();
  }
  
  while (activeBrackets > 0) {
    repaired += ']';
    activeBrackets--;
  }
  while (activeBraces > 0) {
    repaired += '}';
    activeBraces--;
  }
  
  try {
    JSON.parse(repaired);
    return repaired;
  } catch (_) {}
  
  return cleaned;
}

function parseWithRegexFallback(text: string) {
  const titleMatch = text.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const descMatch = text.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const keywordsMatch = text.match(/"keywords"\s*:\s*\[([\s\S]*?)\]/);
  
  const title = titleMatch ? titleMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : "Untitled Stock Asset";
  const description = descMatch ? descMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : "Stock asset SEO metadata description.";
  
  let keywords: string[] = [];
  if (keywordsMatch) {
    const kwText = keywordsMatch[1];
    const kwMatches = kwText.match(/"((?:[^"\\]|\\.)*)"/g);
    if (kwMatches) {
      keywords = kwMatches.map(m => m.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    }
  }
  
  return { title, description, keywords };
}

function parseAndPolish(
  text: string,
  settings: GenerationSettings,
  assetType: AssetType = 'Photo',
  fileExtension?: string
) {
  let metadata: any;
  
  try {
    const repairedJson = cleanAndRepairJson(text);
    metadata = JSON.parse(repairedJson);
  } catch (e) {
    console.warn("Standard JSON parse failed, trying regex fallback...", e);
    try {
      metadata = parseWithRegexFallback(text);
    } catch (regexErr) {
      console.error("Failed to parse AI response:", text, regexErr);
      throw new Error("Invalid output format from AI");
    }
  }

  // Ensure title and description are strings
  if (!metadata || typeof metadata !== 'object') {
    metadata = { title: "", description: "", keywords: [] };
  }
  
  if (typeof metadata.title !== 'string') {
    metadata.title = String(metadata.title || 'Untitled Stock Asset');
  }
  if (typeof metadata.description !== 'string') {
    metadata.description = String(metadata.description || 'Stock asset SEO metadata description.');
  }
  if (!Array.isArray(metadata.keywords)) {
    metadata.keywords = [];
  }
  
  // Map and clean up keywords
  metadata.keywords = metadata.keywords
    .map((k: any) => String(k).trim())
    .filter((k: string) => k.length > 0 && !k.includes('"') && !k.includes('\\'));

  const isTransparent = Boolean(settings.transparentBackground);
  const { extUpper } = getFormatLabel(fileExtension, assetType, isTransparent);

  if (isTransparent) {
    const stripWhiteBg = (txt: string) =>
      txt
        .replace(/\b(?:isolated\s+)?on\s+(?:a\s+|an\s+)?(?:clean\s+|pure\s+|solid\s+)?white\s+background\b/gi, 'on transparent background')
        .replace(/\bisolated\s+on\s+white\b/gi, 'isolated on transparent background')
        .replace(/\b(?:pure\s+|solid\s+)?white\s+background\b/gi, 'transparent background')
        .replace(/\bwhite\s+backdrop\b/gi, 'transparent background')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+,/g, ',')
        .trim();

    metadata.title = stripWhiteBg(metadata.title);
    metadata.description = stripWhiteBg(metadata.description);

    if (!/\btransparent\b/i.test(metadata.title)) {
      metadata.title = `${metadata.title}, Isolated on Transparent Background`;
    }

    metadata.keywords = metadata.keywords.filter(
      (k: string) => !/\bwhite\s*(background|backdrop)\b|^on white$|^isolated on white$/i.test(k)
    );

    const requiredTransparentTags = ['transparent', 'transparent background', 'png', 'isolated', 'cutout', 'no background'];
    const existingLower = new Set(metadata.keywords.map((k: string) => k.toLowerCase()));
    const missingTags = requiredTransparentTags.filter((t) => !existingLower.has(t));
    if (missingTags.length > 0 && settings.keywordCount) {
      const keepCount = Math.max(0, settings.keywordCount - missingTags.length);
      metadata.keywords = [...metadata.keywords.slice(0, keepCount), ...missingTags];
    }
  }

  // Ensure uploaded file format is reflected in title if missing
  if (extUpper && extUpper !== 'PHOTO' && extUpper !== 'ILLUSTRATION' && extUpper !== 'VIDEO') {
    const extRegex = new RegExp(`\\b${extUpper}\\b`, 'i');
    if (!extRegex.test(metadata.title)) {
      if (extUpper === 'EPS' || extUpper === 'AI' || extUpper === 'SVG') {
        metadata.title = /\bvector\b/i.test(metadata.title)
          ? metadata.title.replace(/\bvector\b/i, `${extUpper} Vector`)
          : `${metadata.title} ${extUpper} Vector`;
      } else {
        metadata.title = `${metadata.title} ${extUpper}`;
      }
    }
  } else if (assetType === 'Vector' && !/\bvector\b/i.test(metadata.title)) {
    metadata.title = `${metadata.title} Vector`;
  }

  // Filter duplicates and negative keywords
  const negList = String(settings.negativeKeywords || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set<string>();
  metadata.keywords = metadata.keywords.filter((k: string) => {
    const lower = k.toLowerCase();
    if (seen.has(lower)) return false;
    if (negList.some((neg) => lower.includes(neg))) return false;
    seen.add(lower);
    return true;
  });

  // Ensure exact keyword count
  if (settings.keywordCount && metadata.keywords.length > 0) {
    if (metadata.keywords.length > settings.keywordCount) {
      metadata.keywords = metadata.keywords.slice(0, settings.keywordCount);
    }
  }

  // Final polishing
  if (settings.prefix && !metadata.title.toLowerCase().startsWith(settings.prefix.trim().toLowerCase())) {
    metadata.title = `${settings.prefix.trim()} ${metadata.title}`;
  }
  if (settings.suffix && !metadata.title.toLowerCase().endsWith(settings.suffix.trim().toLowerCase())) {
    metadata.title = `${metadata.title} ${settings.suffix.trim()}`;
  }

  return metadata;
}
