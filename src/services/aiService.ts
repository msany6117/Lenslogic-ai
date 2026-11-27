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

  return `Stock SEO strategist for ${settings.platform}. Analyze image & return JSON: {"title","description","keywords"}.
Context: Type=${assetType}, Format=${extUpper} (${phrase}), TitleLen=${settings.titleLength} chars, Keywords=${settings.keywordCount} exact, Transparent=${isTransparent ? 'MANDATORY' : 'AUTO'}.
Title rules: Front-load top commercial subject in first 50 chars; include ${extUpper}/${phrase}; ${isTransparent ? 'MUST include "transparent" or "isolated on transparent background", NEVER mention "white background".' : 'Note "transparent background" if transparent, or "white background" only if solid white.'}${settings.prefix ? ` Start with "${settings.prefix}".` : ''}${settings.suffix ? ` End with "${settings.suffix}".` : ''}
Keyword rules: Top 10 highest-volume subject/style terms first, then buyer use-cases, mood, format (${extUpper.toLowerCase()}, ${assetType.toLowerCase()}).${isTransparent ? ' Include "transparent","transparent background","png","isolated","cutout","no background"; exclude white background.' : ''} No duplicates, weak fillers, or: ${settings.negativeKeywords || 'None'}.`;
}

const keyHealthCooldown = new Map<string, number>();

function getKeyTokenId(entry: ApiKeyEntry): string {
  return entry.id || entry.key.trim();
}

export function isApiKeyHealthy(entry: ApiKeyEntry): boolean {
  if (!entry?.key?.trim()) return false;
  const until = keyHealthCooldown.get(getKeyTokenId(entry)) || 0;
  return Date.now() >= until;
}

export function getHealthyApiKeys(keys: ApiKeyEntry[]): ApiKeyEntry[] {
  const valid = (keys || []).filter((k) => Boolean(k?.key?.trim()));
  if (valid.length === 0) return [];
  const healthy = valid.filter(isApiKeyHealthy);
  return healthy.length > 0 ? healthy : valid;
}

function markKeyCooldown(entry: ApiKeyEntry, durationMs: number) {
  keyHealthCooldown.set(getKeyTokenId(entry), Date.now() + durationMs);
}

function clearKeyCooldown(entry: ApiKeyEntry) {
  keyHealthCooldown.delete(getKeyTokenId(entry));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      const timeoutErr = new Error("Request timed out under load. Switching to next available key or retrying...") as Error & { status?: number };
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateMetadata(
  base64Image: string,
  settings: GenerationSettings,
  activeKey: ApiKeyEntry | null,
  assetType: AssetType = 'Photo',
  fileExtension?: string,
  onAutoSwitchKey?: (switchedKey: ApiKeyEntry, shouldPersist: boolean) => void
): Promise<{ title: string; description: string; keywords: string[]; usedKeyId?: string }> {
  
  // Skip redundant re-compression only when caller already compressed image to a compact raster JPEG/PNG/WebP data URL
  let optimizedBase64 = base64Image;
  const isCompactRasterDataUrl = /^data:image\/(jpeg|png|webp);base64,/i.test(base64Image) && base64Image.length < 150000;
  if (!isCompactRasterDataUrl) {
    try {
      const compressed = await compressImage(base64Image, 256, 256, 0.55);
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

  // Build deduplicated list of ALL user-configured keys (Gemini + Groq)
  const allValidEntries: ApiKeyEntry[] = [];
  const seenKeys = new Set<string>();
  const addEntry = (entry: ApiKeyEntry | null | undefined) => {
    const trimmed = entry?.key?.trim();
    if (!trimmed || seenKeys.has(trimmed)) return;
    seenKeys.add(trimmed);
    const inferredProvider = trimmed.startsWith('gsk_') ? 'Groq' : trimmed.startsWith('AIza') ? 'Gemini' : entry!.provider;
    allValidEntries.push({ ...entry!, key: trimmed, provider: inferredProvider });
  };

  addEntry(activeKey);
  for (const entry of settings.apiKeys || []) {
    addEntry(entry);
  }

  if (allValidEntries.length === 0) {
    throw new Error("API key required. Please add your Gemini or Groq API key in AI Configuration.");
  }

  // Order keys: healthy keys of preferred provider first -> healthy keys of backup provider -> any temporarily cooled keys last
  const preferredProvider = activeKey?.provider || allValidEntries[0].provider;
  const healthySameProvider = allValidEntries.filter((e) => e.provider === preferredProvider && isApiKeyHealthy(e));
  const healthyOtherProvider = allValidEntries.filter((e) => e.provider !== preferredProvider && isApiKeyHealthy(e));
  const cooledFallback = allValidEntries.filter((e) => !isApiKeyHealthy(e));
  const orderedEntries = [...healthySameProvider, ...healthyOtherProvider, ...cooledFallback];

  const requestMetadataFromServer = async (keyValue: string, provider: 'Gemini' | 'Groq') => {
    const payload = JSON.stringify({
      base64Image: optimizedBase64,
      settings,
      apiKey: keyValue,
      provider,
      assetType,
      fileExtension
    });

    const configuredUrl = getApiUrl("/api/generate-metadata");
    // Always prefer same-origin /api/generate-metadata first so stale localStorage URLs never cause Failed to fetch
    const candidateUrls = configuredUrl !== "/api/generate-metadata"
      ? ["/api/generate-metadata", configuredUrl]
      : ["/api/generate-metadata"];

    let lastFetchErr: Error | null = null;

    for (let idx = 0; idx < candidateUrls.length; idx++) {
      const targetUrl = candidateUrls[idx];
      let response: Response | null = null;
      let rawBody = "";
      let contentType = "";
      let isHtml = false;

      for (let netAttempt = 0; netAttempt < 2; netAttempt++) {
        try {
          response = await fetchWithTimeout(
            targetUrl,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: targetUrl.startsWith("/") ? "same-origin" : "omit",
              body: payload
            },
            19000
          );
          contentType = (response.headers.get("content-type") || "").toLowerCase();
          rawBody = await response.text();
          isHtml = contentType.includes("text/html") || /^\s*<!doctype|^\s*<html/i.test(rawBody);
          if (isHtml && netAttempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 450));
            continue;
          }
          break;
        } catch (networkErr: any) {
          lastFetchErr = networkErr instanceof Error ? networkErr : new Error("Network request failed");
          if (netAttempt === 0 && Number((networkErr as any)?.status || 0) !== 504) {
            await new Promise((resolve) => setTimeout(resolve, 350));
          } else {
            break;
          }
        }
      }

      if (!response) {
        continue;
      }

      let parsedBody: any = null;
      if (rawBody) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = null;
        }
      }

      if (isHtml && idx < candidateUrls.length - 1) {
        continue;
      }

      if (!response.ok) {
        const errorMessage =
          parsedBody?.error ||
          (isHtml
            ? `Server returned an HTML error page (HTTP ${response.status}). Please retry in a moment.`
            : `Server generation failed (Status: ${response.status})`);
        const err = new Error(errorMessage) as Error & { status?: number; upstreamStatus?: number; isEndpointMissing?: boolean };
        err.status = response.status;
        err.upstreamStatus = Number(parsedBody?.upstreamStatus || response.status);
        err.isEndpointMissing = isHtml || response.status === 404;
        throw err;
      }

      if (!parsedBody) {
        const err = new Error(
          isHtml
            ? "Metadata API endpoint returned HTML instead of JSON. Please refresh (Ctrl+Shift+R) and ensure the /api backend is deployed."
            : "Invalid non-JSON response received from server metadata engine."
        ) as Error & { isEndpointMissing?: boolean };
        err.isEndpointMissing = isHtml;
        throw err;
      }

      if (!parsedBody.title || !Array.isArray(parsedBody.keywords)) {
        throw new Error("Invalid output received from server metadata engine.");
      }

      return parseAndPolish(JSON.stringify(parsedBody), settings, assetType, fileExtension);
    }

    if (lastFetchErr && /failed to fetch|network/i.test(lastFetchErr.message)) {
      const err = new Error("Could not reach the metadata server. Please check your connection or refresh the page and try again.") as Error & { isEndpointMissing?: boolean };
      err.isEndpointMissing = true;
      throw err;
    }
    throw lastFetchErr || new Error("Failed to reach metadata API endpoint.");
  };

  let firstBusyError: any = null;
  let lastKeyError: any = null;
  let sawPermanentFailureOnPriorKey = false;
  const prompt = buildSeoPrompt(settings, assetType, fileExtension);

  for (let i = 0; i < orderedEntries.length; i++) {
    const entry = orderedEntries[i];
    try {
      let result: { title: string; description: string; keywords: string[] };
      if (entry.provider === 'Groq') {
        try {
          result = await requestMetadataFromServer(entry.key, 'Groq');
        } catch (proxyErr: any) {
          if (proxyErr?.isEndpointMissing) {
            result = await callGroq(optimizedBase64, prompt, entry.key, settings, assetType, fileExtension);
          } else {
            throw proxyErr;
          }
        }
      } else {
        result = await requestMetadataFromServer(entry.key, 'Gemini');
      }

      clearKeyCooldown(entry);
      if (entry.id && entry.id !== activeKey?.id) {
        onAutoSwitchKey?.(entry, sawPermanentFailureOnPriorKey);
      }
      return { ...result, usedKeyId: entry.id };
    } catch (err: any) {
      lastKeyError = err;
      const status = Number(err?.upstreamStatus || err?.status || 0);
      const msg = String(err?.message || '').toLowerCase();

      const isQuota429 = status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');
      const isAuth =
        status === 401 ||
        status === 403 ||
        msg.includes('invalid') ||
        msg.includes('unauthorized') ||
        msg.includes('api_key') ||
        msg.includes('no vision') ||
        msg.includes('do not have access');
      const isBusy503 =
        !isQuota429 &&
        !isAuth &&
        (status === 503 || status === 504 || msg.includes('503') || msg.includes('busy') || msg.includes('timed out') || msg.includes('aborted'));

      if (isQuota429) {
        markKeyCooldown(entry, 45000);
        sawPermanentFailureOnPriorKey = true;
      } else if (isAuth) {
        markKeyCooldown(entry, 120000);
        sawPermanentFailureOnPriorKey = true;
      } else if (isBusy503) {
        if (!firstBusyError) firstBusyError = err;
        markKeyCooldown(entry, 6000);
      }

      const isSwitchable = isQuota429 || isBusy503 || isAuth || status === 500 || Boolean(err?.isEndpointMissing);
      if (!isSwitchable || i === orderedEntries.length - 1) {
        if (firstBusyError && err !== firstBusyError && isAuth) {
          const combined = new Error(`${firstBusyError.message} (Backup key note: ${err.message})`) as Error & {
            status?: number;
            upstreamStatus?: number;
          };
          combined.status = Number(firstBusyError.status || 503);
          combined.upstreamStatus = Number(firstBusyError.upstreamStatus || 503);
          throw combined;
        }
        throw err;
      }
    }
  }

  throw lastKeyError || new Error("Metadata generation failed.");
}

const groqVisionModelsCache = new Map<string, { models: string[]; expiresAt: number }>();

async function resolveGroqVisionModels(apiKey: string): Promise<string[]> {
  const cached = groqVisionModelsCache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt && cached.models.length > 0) {
    return cached.models;
  }

  const fallbackDefaults = ["qwen/qwen3.8-27b", "meta-models/muse-spark-open"];
  const knownVisionOrder = [
    "qwen/qwen3.8-27b",
    "meta-models/muse-spark-open",
  ];

  try {
    const res = await fetchWithTimeout(
      "https://api.groq.com/openai/v1/models",
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      },
      3500
    );
    if (res.ok) {
      const payload = await res.json();
      const ids: string[] = Array.isArray(payload?.data)
        ? payload.data.map((m: any) => String(m?.id || "")).filter(Boolean)
        : [];
      const excluded = /whisper|playai|tts|guard|safeguard|embed|orpheus|allam|compound/i;
      const visionCandidates = ids.filter((id) =>
        !excluded.test(id) &&
        /(qwen3\.8|muse-spark|vision|\bvl\b|pixtral|llava|gemma-3|llama-4|multimodal|omni)/i.test(id)
      );
      if (visionCandidates.length > 0) {
        const ordered = [
          ...knownVisionOrder.filter((id) => visionCandidates.includes(id)),
          ...visionCandidates.filter((id) => !knownVisionOrder.includes(id)),
        ];
        groqVisionModelsCache.set(apiKey, {
          models: ordered,
          expiresAt: Date.now() + 5 * 60 * 1000,
        });
        return ordered;
      }
    }
  } catch {
    // Fall back to curated defaults if model list fetch fails
  }

  return fallbackDefaults;
}

async function callGroq(
  base64Image: string,
  prompt: string,
  apiKey: string,
  settings: GenerationSettings,
  assetType: AssetType = 'Photo',
  fileExtension?: string
) {
  // Compress image compactly for Groq payload limits & maximum speed
  let compressedForGroq = base64Image;
  const alreadyCompact = /^data:image\/(jpeg|png|webp);base64,/i.test(base64Image) && base64Image.length < 95000;
  if (!alreadyCompact) {
    try {
      compressedForGroq = await compressImage(base64Image, 256, 256, 0.55);
    } catch (err) {
      console.warn("Failed to compress image specifically for Groq:", err);
    }
  }

  const candidateModels = await resolveGroqVisionModels(apiKey);
  let lastError: any = null;

  for (const modelName of candidateModels) {
    let useJsonMode = true;
    let useReasoningNone = /qwen3\.8/i.test(modelName);

    for (let attempt = 0; attempt < 3; attempt++) {
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
                    url: compressedForGroq
                  }
                }
              ]
            }
          ]
        };
        if (useJsonMode) {
          bodyPayload.response_format = { type: "json_object" };
        }
        if (useReasoningNone) {
          bodyPayload.reasoning_effort = "none";
        }

        const response = await fetchWithTimeout(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(bodyPayload)
          },
          9500
        );

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
          const err = new Error(msg) as Error & { status?: number };
          err.status = response.status;
          throw err;
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
        const status = Number(error?.status || 0);
        const errMsg = String(error?.message || "");
        const upper = errMsg.toUpperCase();

        if (status === 400 && useReasoningNone && /reasoning_effort/i.test(errMsg)) {
          useReasoningNone = false;
          continue;
        }

        if (status === 400 && useJsonMode && /response_format|json_object|json/i.test(errMsg)) {
          useJsonMode = false;
          continue;
        }

        if (status === 401 || status === 403 || upper.includes("INVALID_API_KEY") || upper.includes("INVALID API KEY") || upper.includes("UNAUTHORIZED")) {
          const authErr = new Error(`Groq API Error: ${errMsg}`) as Error & { status?: number };
          authErr.status = status || 401;
          throw authErr;
        }

        // Only try next discovered model if this model does not exist / access denied / 503; break immediately on 429 so key-switching happens fast
        if (status === 429 || upper.includes("RATE LIMIT")) {
          const rateErr = new Error(`Groq API Error: ${errMsg}`) as Error & { status?: number };
          rateErr.status = 429;
          throw rateErr;
        }
        break;
      }
    }
  }

  const finalErr = new Error(`Groq API Error: ${lastError?.message || "Failed to generate metadata via Groq"}`) as Error & { status?: number };
  if (lastError?.status) finalErr.status = lastError.status;
  throw finalErr;
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
