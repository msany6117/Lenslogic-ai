import { ThinkingLevel, Type } from "@google/genai";
import {
  applyCors,
  extractCleanUpstreamError,
  getAiClient,
  safeParseJsonObject,
} from "../_geminiShared.js";

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { glslCode, canvasCode, errorLog, conceptTitle, apiKey } = req.body || {};
    const customKey = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!customKey) {
      return res.status(400).json({
        error: "API key required. Please add your Gemini API key in AI Configuration.",
      });
    }
    const ai = getAiClient(customKey);

    if (glslCode) {
      const repairPrompt = `Fix the WebGL2 GLSL ES 3.00 error in this fragment shader helper defining vec4 renderBackground(vec2 uv, vec2 p, float aspect).
DO NOT include #version, precision, out vec4, or uniform declarations.
Concept: ${conceptTitle || "Abstract Background"}
Compiler Error:
${errorLog}

Broken GLSL:
${glslCode}`;

      let parsed: any = null;
      for (const repairCfg of [
        { model: "gemini-4-hydrogen", thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
        { model: "gemini-3.1-flash-lite", thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      ]) {
        try {
          const r = await ai.models.generateContent({
            model: repairCfg.model,
            contents: repairPrompt,
            config: {
              thinkingConfig: repairCfg.thinkingConfig,
              abortSignal: AbortSignal.timeout(12000),
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: { glslCode: { type: Type.STRING } },
                required: ["glslCode"],
              },
            },
          });
          const p = safeParseJsonObject(r.text || "");
          if (p?.glslCode) {
            parsed = p;
            break;
          }
        } catch {
          // Try fallback model
        }
      }
      if (!parsed?.glslCode) throw new Error("Failed to repair GLSL shader.");
      return res.status(200).json({ glslCode: parsed.glslCode });
    }

    if (canvasCode) {
      const repairPrompt = `Fix the JavaScript runtime/syntax error in this Canvas 2D body receiving (ctx, w, h, api). Keep all visual layers & api.palette bindings intact.
Error: ${errorLog}
Broken Code:
${canvasCode}`;
      const r = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: repairPrompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          abortSignal: AbortSignal.timeout(12000),
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: { canvasCode: { type: Type.STRING } },
            required: ["canvasCode"],
          },
        },
      });
      const parsed = safeParseJsonObject(r.text || "");
      if (!parsed?.canvasCode) throw new Error("Failed to repair Canvas code.");
      return res.status(200).json({ canvasCode: parsed.canvasCode });
    }

    return res.status(400).json({ error: "No glslCode or canvasCode provided for repair." });
  } catch (err: any) {
    return res.status(500).json({ error: extractCleanUpstreamError(err, "Repair failed") });
  }
}
