import { GoogleGenAI, Type } from "@google/genai";
import type { GenerationSettings, ApiKeyEntry, AssetType } from "../types";
import { compressImage } from "../lib/utils";

export async function generateMetadata(
  base64Image: string,
  settings: GenerationSettings,
  activeKey: ApiKeyEntry | null,
  assetType: AssetType = 'Photo'
): Promise<{ title: string; description: string; keywords: string[] }> {
  
  // Compress image to a highly optimized standard size (max 512px) right at the start.
  // This reduces the payload size by over 99% (e.g. from 10MB to 30KB),
  // which makes both the network upload and Gemini/Groq model processing superfast (typically under 2 seconds).
  let optimizedBase64 = base64Image;
  try {
    optimizedBase64 = await compressImage(base64Image, 512, 512, 0.75);
  } catch (err) {
    console.warn("Failed to compress image for AI service, sending original:", err);
  }

  // Build a prioritized list of keys to try
  const keysToTry: ApiKeyEntry[] = [];
  const allKeys = settings.apiKeys || [];
  const active = activeKey && activeKey.key ? activeKey : null;
  
  const geminiKeys = allKeys.filter(k => k.provider === 'Gemini' && k.key);
  const groqKeys = allKeys.filter(k => k.provider === 'Groq' && k.key);
  
  // Try active key first if it is Gemini
  if (active && active.provider === 'Gemini') {
    keysToTry.push(active);
    keysToTry.push(...geminiKeys.filter(k => k.id !== active.id));
  } else {
    keysToTry.push(...geminiKeys);
  }
  
  // Try active key next if it is Groq
  if (active && active.provider === 'Groq') {
    keysToTry.push(active);
    keysToTry.push(...groqKeys.filter(k => k.id !== active.id));
  } else {
    keysToTry.push(...groqKeys);
  }
  
  // De-duplicate
  const uniqueKeys: ApiKeyEntry[] = [];
  const seenIds = new Set<string>();
  for (const k of keysToTry) {
    if (!seenIds.has(k.id)) {
      seenIds.add(k.id);
      uniqueKeys.push(k);
    }
  }

  if (uniqueKeys.length === 0) {
    throw new Error("No valid API keys found. Please add at least one Gemini or Groq API key in Settings.");
  }

  const prompt = `
    You are a world-class Stock Content SEO Expert. 
    Analyze the provided image and generate metadata optimized specifically for ${settings.platform}.
    
    Asset Context:
    - Target Platform: ${settings.platform}
    - Asset Type: ${assetType}
    - Platform Rules: ${settings.platform === 'Adobe Stock' ? 'Focus on commercial appeal, avoid numbers/camera info in title.' : ''}
    ${settings.platform === 'Shutterstock' ? 'Requires descriptive titles, keywords should be noun/adjective heavy.' : ''}
    ${settings.platform === 'Freepik' ? 'Highly descriptive, focus on use-case and design elements.' : ''}
    ${settings.platform === 'Getty Images' ? 'Editorial or commercial clarity, precise keywords.' : ''}
    - Title Length: ${settings.titleLength} characters.
    - Keyword Count: Exactly ${settings.keywordCount} keywords.
    - PNG / Transparent Background Rule:
      Check if the image has a transparent background (as is common with PNGs/vectors/graphics/isolated illustrations). If the background is transparent, describe it as "isolated on a transparent background", "transparent PNG", or "isolated graphic". Do NOT mention "white background" or "isolated on white" if the background is actually transparent. Only describe it as "white background" or "isolated on white" if there is a solid white background.
    - Asset specific instruction: 
      ${assetType === 'Vector' ? 'Focus on technical execution, usage as a design asset (SVG/EPS), and scalability. Mention "vector", "illustration", and specific design styles (flat, isometric, etc.).' : ''} 
      ${assetType === 'Illustration' ? 'Focus on artistic style, mood, and digital/hand-drawn textures. Use descriptive adjectives (watercolor, charcoal, digital art).' : ''}
      ${assetType === 'Video' ? 'Focus on motion, camera movement (pan, tilt, zoom), lighting, and the "story" captured in the clip. This is for stock footage SEO.' : ''}
    - Keywords must be: SEO optimized, comma-separated, high-traffic terms, excluding stop words.
    - Prefix: ${settings.prefix || 'None'}
    - Suffix: ${settings.suffix || 'None'}
    - Prohibited Terms (Exclude these): ${settings.negativeKeywords || 'None'}

    Output Requirements:
    - Return ONLY a raw JSON object string.
    - "title": A powerful, SEO-driven title based on image content and platform rules.
    - "description": A clear, semantic description for search engine indexing.
    - "keywords": A flat array of ${settings.keywordCount} strings.
  `;

  let lastError: any = null;
  
  for (const keyEntry of uniqueKeys) {
    try {
      console.log(`Attempting generation with ${keyEntry.provider} key "${keyEntry.label}"...`);
      if (keyEntry.provider === 'Gemini') {
        return await callGemini(optimizedBase64, prompt, keyEntry.key, settings);
      } else {
        return await callGroq(optimizedBase64, prompt, keyEntry.key, settings);
      }
    } catch (err: any) {
      console.warn(`${keyEntry.provider} key "${keyEntry.label}" failed:`, err);
      lastError = err;
    }
  }

  // If all keys in uniqueKeys failed, throw a readable combined error
  const finalErrorMsg = lastError?.message || lastError || "Unknown error";
  throw new Error(`All ${uniqueKeys.length} configured API keys failed. Last provider error: ${finalErrorMsg}`);
}

async function callGemini(base64Image: string, prompt: string, apiKey: string, settings: GenerationSettings) {
  const ai = new GoogleGenAI({ apiKey });

  const [header, data] = base64Image.split(',');
  const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  
  const supportedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  const supportedVideoTypes = ['video/mp4', 'video/mpeg', 'video/mov', 'video/avi', 'video/flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gp'];
  const supportedDocTypes = ['application/pdf'];
  
  let finalMimeType = mimeType;
  if (!supportedImageTypes.includes(mimeType) && !supportedVideoTypes.includes(mimeType) && !supportedDocTypes.includes(mimeType)) {
    if (mimeType.includes('image')) {
      finalMimeType = 'image/jpeg'; 
    } else if (mimeType === 'application/postscript') {
       throw new Error(`Gemini cannot read EPS/AI directly. To analyze this, please upload a JPG/PNG with the EXACT same filename as the EPS.`);
    }
  }

  // Highly robust list of model candidates to fail over
  const candidateModels = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-3.5-flash"];
  let lastError: any = null;

  for (const modelName of candidateModels) {
    const maxRetries = 2; // Reduced from 3 to 2 to minimize wait times on transient errors
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Analyzing image using model ${modelName} (Attempt ${attempt}/${maxRetries})...`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  data: data,
                  mimeType: finalMimeType,
                },
              },
            ],
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: {
                  type: Type.STRING,
                  description: `An SEO-driven stock title based on image content and platform rules. Target length is ${settings.titleLength} characters.`
                },
                description: {
                  type: Type.STRING,
                  description: "A clear, semantic description of the image content for stock search indexing."
                },
                keywords: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: `A flat array of exactly ${settings.keywordCount} highly-relevant stock SEO keywords.`
                }
              },
              required: ["title", "description", "keywords"]
            }
          },
        });

        const text = response.text;
        if (!text) {
          throw new Error("No response from Gemini");
        }

        return parseAndPolish(text, settings);
      } catch (error: any) {
        lastError = error;
        const errMsg = String(error?.message || error || "").toUpperCase();
        console.warn(`Attempt ${attempt} on model ${modelName} failed. Error:`, error);

        // If it's a fatal key error, unauthorized/forbidden, invalid argument, or not found error, don't keep retrying this model
        if (
          errMsg.includes("APIKEY") || 
          errMsg.includes("API_KEY") ||
          errMsg.includes("INVALID_ARGUMENT") || 
          errMsg.includes("NOT_FOUND") || 
          errMsg.includes("NOT FOUND") || 
          errMsg.includes("404") || 
          errMsg.includes("403") || 
          errMsg.includes("UNAUTHORIZED")
        ) {
          break;
        }

        // Exponential backoff
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 300;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }

  // If we reach here, all candidate models failed
  console.error("All Gemini candidate models failed. Last error details:", lastError);
  const errorMsg = String(lastError?.message || lastError || "");
  if (errorMsg.includes('503') || errorMsg.includes('UNAVAILABLE') || errorMsg.includes('high demand')) {
    throw new Error("Gemini is experiencing extremely high demand at the moment. Please retry in a few seconds, or switch to Groq in Settings for instant results.");
  }
  if (errorMsg.includes('500') || errorMsg.includes('INTERNAL')) {
    throw new Error("Gemini is currently experiencing a temporary internal error. Please try again in a few moments or switch to Groq in Settings.");
  }
  throw new Error(`Gemini API Error: ${lastError?.message || "Failed to generate metadata"}`);
}

async function callGroq(base64Image: string, prompt: string, apiKey: string, settings: GenerationSettings) {
  // Compress the image specifically for Groq to guarantee it fits under Groq's payload limit (avoid "Request Entity Too Large" errors)
  let compressedForGroq = base64Image;
  try {
    compressedForGroq = await compressImage(base64Image, 300, 300, 0.5);
  } catch (err) {
    console.warn("Failed to compress image specifically for Groq:", err);
  }

  // Robust list of active Groq vision models to try
  const candidateModels = [
    "llama-3.2-90b-vision-instruct",
    "llama-3.2-11b-vision-preview"
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

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody?.error?.message || response.statusText || `HTTP ${response.status}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("No response content from Groq");
      }
      
      return parseAndPolish(content, settings);
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

function parseAndPolish(text: string, settings: GenerationSettings) {
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

  // Ensure exact keyword count
  if (settings.keywordCount && metadata.keywords.length > 0) {
    if (metadata.keywords.length > settings.keywordCount) {
      metadata.keywords = metadata.keywords.slice(0, settings.keywordCount);
    }
  }

  // Final polishing
  if (settings.prefix && !metadata.title.startsWith(settings.prefix)) {
    metadata.title = `${settings.prefix} ${metadata.title}`;
  }
  if (settings.suffix && !metadata.title.endsWith(settings.suffix)) {
    metadata.title = `${metadata.title} ${settings.suffix}`;
  }

  return metadata;
}
