import { ThinkingLevel, Type } from "@google/genai";
import {
  applyCors,
  extractCleanUpstreamError,
  getAiClient,
  safeParseJsonObject,
} from "../_geminiShared.js";

const FULL_BG_STYLE_CATALOG = `
1. Technology, Digital & Cyber: "Circuit Board & Microchip Patterns", "Digital Networks & Connected Nodes", "Futuristic Grids & Perspective Horizons", "Data Flows & Particle Streams", "Wireframes & Holographic Layouts", "Cyber Security & Matrix Streams", "AI & Neural Topology"
2. 3D Procedural & Shader Art: "Liquid Chrome & Metallic Surfaces", "3D Spheres, Torus & Geometric Forms", "Frosted Glass & Refraction Effects", "3D Isometric & Architectural Blocks", "Volumetric Lighting & Light Rays", "3D Terrain & Elevation Mesh"
3. Abstract & Geometric Art: "Low-Poly & Polygon Compositions", "Voronoi & Cellular Patterns", "Tessellations & Repeating Geometry", "Moiré Interference & Optical Illusions", "Minimalist Bauhaus & Modern Shapes", "Abstract Ribbons & Layered Swirls"
4. Mathematical & Algorithmic Generative Art: "Fractals & Self-Similar Structures", "Perlin & Simplex Noise Fields", "Domain Warping & Fluid Marble", "Parametric & Harmonic Curves", "Strange Attractors & Chaotic Systems", "Phyllotaxis & Sacred Geometry", "Sine Waves, Soundwaves & Equalizers"
5. Patterns, Textures & Surface Overlays: "Mesh Gradients & Aurora Blends", "Topographic Contour Lines", "Halftone Dots & Print Patterns", "Film Grain, Noise & Paper Texture", "Stripes, Chevrons & Linear Rhythms", "Organic & Botanical-Inspired Patterns"
6. Commercial, Minimal & Editorial Backgrounds: "Minimal Corporate & Presentation Backdrops", "Pastel, Soft & Calm Aesthetic Backgrounds", "Luxury, Dark & Gold Editorial Backgrounds", "Retro, Synthwave & Vintage Backgrounds", "Nature, Sky, Water & Atmospheric Abstracts"
7. Typography, Graphic & Editorial Systems: "Swiss Grid & Editorial Posters", "Minimalist Line Art & Contour Posters", "Halftone Pop & Graphic Halftone"
8. Atmospheric, Light & Optical Phenomena: "Caustics & Water Light Patterns", "Bokeh, Light Orbs & Depth Blur", "Prism, Dispersion & Iridescent Sheen"
9. Abstract Flow, Fluids & Physical Dynamics: "Curl Noise & Smoke/Ink Diffusion", "Reaction-Diffusion & Turing Patterns", "Pendulum, Spirograph & Harmonograph", "Cloth, Wave & Mesh Deformation"
10. Architectural, Structural & Spatial Layouts: "Brutalist Concrete & Monolithic Blocks", "Grid Systems, Blueprints & Technical CAD", "Perspective Tunnels, Portals & Corridors"
`.trim();

const BG_SYSTEM_INSTRUCTION = `You are a Principal Graphics Shader Engineer (GLSL ES 3.00 + HTML5 Canvas 2D), Generative Art Director, and Top-Selling Adobe Stock Contributor.

MISSION:
- Code renders at 4K (3840x2160) & 8K (7680x4320) for paying stock buyers. Deliver studio-grade Octane/Cycles 3D renders, optical macro light physics, or precision vector craft — NEVER flat unshaded boxes, muddy gray blurs, or tangled lines.
- CUSTOMIZATION MANDATE: NEVER hardcode hex strings ('#...') or fixed RGB vec3(...) colors inside glslCode or canvasCode! Drive ALL colors from u_base, u_primary, u_secondary, u_accent, u_highlight (GLSL) or api.palette.* & api.rgba/api.mix (Canvas). Also bind u_density/density, u_scale/scale, u_rotation/rotationRad, u_warp/warp, u_glow/glow, u_depth/depth, u_lineWeight/lineWeight, u_seed/seed.

ENGINE SELECTION (renderMode):
- "glsl": 3D raymarched chrome/gold/metallic spheres, ribbed toruses, frosted glass, Voronoi, domain-warped waves, caustics, optical bokeh, fractals, aurora meshes.
- "canvas": PCB circuits, depth-sorted 3D network graphs, light trails, isometric monoliths, low-poly wireframes, Moire curves, Fibonacci spirals, Swiss grids.
- "hybrid": glslCode renders lighting/backdrop FIRST, canvasCode overlays vectors cleanly (NEVER call fillBackground/meshBackdrop in "hybrid").

GLSL ES 3.00 CONTRACT: Write ONLY helpers + vec4 renderBackground(vec2 uv, vec2 p, float aspect) { ... }. NO #version, precision, out, or uniform lines. Strict float literals (0.0, 1.0) & constant-bound loops.
CANVAS 2D CONTRACT: Write ONLY inner JS statements (NO wrapper function). Scale sizes via api.ps(...), coordinates via api.px/py or api.cx/cy, total draw ops <= 1800, NO DOM/getImageData.
CODE DISCIPLINE: 22-60 crisp lines (< 3,500 chars).

CATALOG:
${FULL_BG_STYLE_CATALOG}`;

const BG_BLUEPRINT_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    visualAnalysis: { type: Type.STRING },
    conceptTitle: { type: Type.STRING },
    marketDemandInsight: { type: Type.STRING },
    creativeRationale: { type: Type.STRING },
    resolvedCategory: { type: Type.STRING },
    styleName: { type: Type.STRING },
    renderMode: { type: Type.STRING },
    supportsTransparency: { type: Type.BOOLEAN },
    negativeSpaceZone: { type: Type.STRING },
    focalX: { type: Type.NUMBER },
    focalY: { type: Type.NUMBER },
    lightAngleDeg: { type: Type.NUMBER },
    geometryScale: { type: Type.NUMBER },
    densityFactor: { type: Type.NUMBER },
    glowFactor: { type: Type.NUMBER },
    depthFactor: { type: Type.NUMBER },
    paletteBase: { type: Type.STRING },
    palettePrimary: { type: Type.STRING },
    paletteSecondary: { type: Type.STRING },
    paletteAccent: { type: Type.STRING },
    paletteHighlight: { type: Type.STRING },
    glslCode: { type: Type.STRING },
    canvasCode: { type: Type.STRING },
  },
  required: [
    "visualAnalysis",
    "conceptTitle",
    "marketDemandInsight",
    "creativeRationale",
    "resolvedCategory",
    "styleName",
    "renderMode",
    "supportsTransparency",
    "negativeSpaceZone",
    "focalX",
    "focalY",
    "lightAngleDeg",
    "geometryScale",
    "densityFactor",
    "glowFactor",
    "depthFactor",
    "paletteBase",
    "palettePrimary",
    "paletteSecondary",
    "paletteAccent",
    "paletteHighlight",
    "glslCode",
    "canvasCode",
  ],
};

function validateCanvasCodeSyntax(code: unknown): string | null {
  if (typeof code !== "string" || !code.trim()) return "Empty canvasCode";
  try {
    new Function("ctx", "w", "h", "api", `"use strict";\n${code}`);
    return null;
  } catch (err: any) {
    return err?.message || "Invalid JS syntax";
  }
}

function unwrapCanvasBodyServer(rawCode: string): string {
  let code = rawCode
    .trim()
    .replace(/^```(?:javascript|js)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const wrapperMatch = code.match(
    /^(?:(?:export\s+default|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=)\s*)?(?:async\s+)?(?:function(?:\s+\w+)?\s*\([^)]*\)|(?:\([^)]*\)|ctx)\s*=>)\s*\{([\s\S]*)\}\s*;?\s*$/
  );
  if (wrapperMatch && typeof wrapperMatch[1] === "string") {
    code = wrapperMatch[1].trim();
  }
  if (validateCanvasCodeSyntax(code)) {
    let depth = 0;
    for (let i = 0; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") depth--;
    }
    if (depth > 0 && depth <= 3) {
      const candidate = `${code}\n${"}".repeat(depth)}`;
      if (!validateCanvasCodeSyntax(candidate)) {
        code = candidate;
      }
    }
  }
  return code;
}

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const {
      category,
      styleName,
      prompt,
      colorStyle,
      complexity,
      aspectLabel,
      count = 1,
      recentConcepts = [],
      referenceImage,
      previousBlueprint,
      refineInstruction,
      apiKey,
    } = req.body || {};

    const customKey = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!customKey) {
      return res.status(400).json({
        error: "API key required. Please add your Gemini API key in AI Configuration.",
      });
    }

    const safeCount = Math.max(1, Math.min(4, Number(count) || 1));
    const ai = getAiClient(customKey);
    const validRefImage =
      referenceImage &&
      typeof referenceImage.data === "string" &&
      referenceImage.data.trim().length > 32;

    const isAutoCategory = !category || String(category).startsWith("Auto");
    const isAiFreeInvention = !styleName || styleName === "ai-invention";

    const userPrompt =
      previousBlueprint && refineInstruction?.trim()
        ? `REFINE EXISTING CODE (${safeCount} variation): "${refineInstruction.trim()}"
Color Direction: ${colorStyle || "Random / AI-Curated"} | Complexity: ${complexity || "Balanced"} | Aspect: ${aspectLabel || "16:9"}
Active Blueprint: ${previousBlueprint.conceptTitle || "Active"} (${previousBlueprint.resolvedCategory || category}, ${previousBlueprint.renderMode || "glsl"})
${previousBlueprint.glslCode ? `Current glslCode:\n${previousBlueprint.glslCode}\n` : ""}${previousBlueprint.canvasCode ? `Current canvasCode:\n${previousBlueprint.canvasCode}\n` : ""}
Apply refinement cleanly and return valid JSON.`
        : `Generate ${safeCount} commercial stock-grade procedural background blueprint(s).
${validRefImage ? "REFERENCE IMAGE ATTACHED: Dissect the image in visualAnalysis first and write procedural GLSL/Canvas code delivering a fresh commercial variation in that EXACT visual style and finish." : ""}
- Category: ${isAutoCategory ? "Choose the highest-demand commercial category from catalog" : category}
- Style Target: ${isAiFreeInvention ? "AI Free Invention — craft an iconic studio composition" : `"${styleName}"`}
- Intent: ${prompt?.trim() ? `"${prompt.trim()}"` : "Agency/Adobe Stock flagship visual depth & appeal"}
- Color Direction: ${colorStyle || "Random / AI-Curated"} (5 high-contrast #RRGGBB colors)
- Complexity: ${complexity || "Balanced"} | Aspect: ${aspectLabel || "16:9"}
${Array.isArray(recentConcepts) && recentConcepts.length > 0 ? `- Avoid repeating: ${recentConcepts.slice(-10).join(" | ")}` : ""}`;

    const contentsPayload: any = validRefImage
      ? {
          parts: [
            {
              inlineData: {
                mimeType: String(referenceImage.mimeType || "image/jpeg"),
                data: String(referenceImage.data),
              },
            },
            { text: userPrompt },
          ],
        }
      : userPrompt;

    const candidateConfigs: Array<{ model: string; thinkingConfig?: any; timeoutMs: number }> = [
      {
        model: "gemini-4-hydrogen",
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        timeoutMs: safeCount > 1 ? 26000 : 16000,
      },
      {
        model: "gemini-3.1-flash-lite",
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        timeoutMs: safeCount > 1 ? 28000 : 22000,
      },
    ];

    let blueprints: any[] = [];
    let lastErr: any = null;
    const maxTokens = safeCount === 1 ? 4608 : 10240;

    for (const cfg of candidateConfigs) {
      try {
        const response = await ai.models.generateContent({
          model: cfg.model,
          contents: contentsPayload,
          config: {
            systemInstruction: BG_SYSTEM_INSTRUCTION,
            ...(cfg.thinkingConfig ? { thinkingConfig: cfg.thinkingConfig } : {}),
            maxOutputTokens: maxTokens,
            abortSignal: AbortSignal.timeout(cfg.timeoutMs),
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                blueprints: {
                  type: Type.ARRAY,
                  items: BG_BLUEPRINT_ITEM_SCHEMA,
                },
              },
              required: ["blueprints"],
            },
          },
        });

        const rawText = response?.text || "";
        if (!rawText) {
          throw new Error(`Model ${cfg.model} returned an empty response.`);
        }
        const parsed = safeParseJsonObject(rawText);
        const list = Array.isArray(parsed?.blueprints) ? parsed.blueprints : [];
        if (list.length === 0) {
          throw new Error(`Model ${cfg.model} returned an empty blueprint list.`);
        }
        blueprints = list;
        break;
      } catch (err: any) {
        lastErr = err;
        const msg = String(err?.message || err || "").toUpperCase();
        if (msg.includes("API_KEY") || msg.includes("PERMISSION_DENIED") || msg.includes("403")) {
          break;
        }
      }
    }

    if (blueprints.length === 0) {
      throw lastErr || new Error("Gemini Creative Director did not return a valid blueprint.");
    }

    for (const bp of blueprints) {
      if (bp.renderMode !== "glsl" && bp.renderMode !== "canvas" && bp.renderMode !== "hybrid") {
        bp.renderMode = bp.glslCode?.trim() ? "glsl" : "canvas";
      }
      if (bp.renderMode === "glsl") bp.canvasCode = "";
      if (bp.renderMode === "canvas") bp.glslCode = "";
      if ((bp.renderMode === "canvas" || bp.renderMode === "hybrid") && bp.canvasCode) {
        bp.canvasCode = unwrapCanvasBodyServer(bp.canvasCode);
      }
    }

    return res.status(200).json({ blueprints });
  } catch (err: any) {
    const cleanMsg = extractCleanUpstreamError(err, "Failed to generate creative direction.");
    const raw = String(err?.message || "");
    const isQuotaOrBusy =
      raw.includes("429") || raw.includes("503") || raw.includes("UNAVAILABLE") || raw.includes("high demand");
    const isAuth =
      raw.includes("API_KEY_INVALID") || raw.includes("PERMISSION_DENIED") || raw.includes("403");
    const status = isQuotaOrBusy ? 429 : isAuth ? 401 : 500;
    return res.status(status).json({ error: cleanMsg });
  }
}
