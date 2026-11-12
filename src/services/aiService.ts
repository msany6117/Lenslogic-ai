import type { GenerationSettings, ApiKeyEntry, AssetType } from "../types";
import { compressImage } from "../lib/utils";

export function buildSeoPrompt(settings: GenerationSettings, assetType: AssetType = 'Photo'): string {
  return `
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
}

export async function generateMetadata(
  base64Image: string,
  settings: GenerationSettings,
  activeKey: ApiKeyEntry | null,
  assetType: AssetType = 'Photo'
): Promise<{ title: string; description: string; keywords: string[] }> {
  
  // Compress image to a highly optimized standard size (max 512px) right at the start.
  // This reduces payload size by ~99% (sub-second network transfer).
  let optimizedBase64 = base64Image;
  try {
    optimizedBase64 = await compressImage(base64Image, 512, 512, 0.75);
  } catch (err) {
    console.warn("Failed to compress image for AI service, sending original:", err);
  }

  const prompt = buildSeoPrompt(settings, assetType);

  // If the user explicitly has a Groq key active, use Groq provider directly
  if (activeKey && activeKey.provider === 'Groq' && activeKey.key) {
    return await callGroq(optimizedBase64, prompt, activeKey.key, settings);
  }

  // All Gemini AI operations are handled on the server via /api/generate-metadata
  const geminiKey = (activeKey?.provider === 'Gemini' ? activeKey.key : null) || 
                    settings.apiKeys?.find(k => k.provider === 'Gemini' && k.key)?.key || undefined;

  const response = await fetch("/api/generate-metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      base64Image: optimizedBase64,
      settings,
      apiKey: geminiKey,
      assetType
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.error || `Server generation failed (Status: ${response.status})`;
    throw new Error(errorMessage);
  }

  const serverResult = await response.json();
  if (!serverResult || !serverResult.title || !Array.isArray(serverResult.keywords)) {
    throw new Error("Invalid output received from server metadata engine.");
  }

  return parseAndPolish(JSON.stringify(serverResult), settings);
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
