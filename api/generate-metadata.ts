import {
  applyCors,
  buildSeoPrompt,
  extractCleanUpstreamError,
  generateGeminiMetadataWithRecovery,
  generateGroqMetadataServer,
  isAuthOrAccessError,
  isQuotaOrRateError,
  isTransientBusyError,
  parseImageDataPayload,
} from "./_geminiShared.js";

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { base64Image, settings, apiKey, provider, assetType, fileExtension } = req.body || {};

    const customKey = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!customKey) {
      return res.status(400).json({
        error: "API key required. Please add your Gemini or Groq API key in AI Configuration.",
      });
    }

    if (typeof base64Image !== "string" || !base64Image.trim() || base64Image.startsWith("blob:")) {
      return res.status(400).json({
        error:
          "Invalid or missing image preview data. Please re-upload the file or attach a JPG/PNG preview.",
      });
    }

    const { mimeType, data } = parseImageDataPayload(base64Image);
    const dataUri = base64Image.startsWith("data:")
      ? base64Image.trim()
      : `data:${mimeType};base64,${data}`;

    const prompt = buildSeoPrompt(settings || {}, assetType || "Photo", fileExtension);
    const keywordCount = Number(settings?.keywordCount) || 30;

    const useGroq = provider === "Groq" || customKey.startsWith("gsk_");
    const result = useGroq
      ? await generateGroqMetadataServer({
          base64Image: dataUri,
          apiKey: customKey,
          prompt,
          settings: settings || {},
          assetType: assetType || "Photo",
          fileExtension,
          isServerless: true,
        })
      : await generateGeminiMetadataWithRecovery({
          apiKey: customKey,
          data,
          mimeType,
          prompt,
          keywordCount,
          settings: settings || {},
          assetType: assetType || "Photo",
          fileExtension,
          isServerless: true,
        });

    return res.status(200).json(result);
  } catch (err: any) {
    const cleanMsg = extractCleanUpstreamError(err, "AI metadata generation failed");
    const explicitStatus = Number(err?.status || 0);
    if (explicitStatus === 400) {
      return res.status(400).json({ error: cleanMsg, upstreamStatus: 400 });
    }
    const isQuota429 = isQuotaOrRateError(err);
    const isBusy503 = isTransientBusyError(err);
    const isAuth403 = isAuthOrAccessError(err);
    const status = isQuota429 ? 429 : isBusy503 ? 503 : isAuth403 ? 401 : 500;
    return res.status(status).json({
      error: cleanMsg,
      upstreamStatus: isQuota429 ? 429 : isBusy503 ? 503 : isAuth403 ? explicitStatus || 403 : 500,
    });
  }
}

