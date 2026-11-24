import {
  ALL_ALGORITHMS,
  AiBlueprint,
  BG_TAXONOMY,
  BgAlgorithmId,
  BgCategoryOption,
  BgShaderStyle,
  ColorStyleOption,
  ComplexityLevel,
  CORE_BG_CATEGORIES,
  CoreBgCategory,
  ReferenceImagePayload,
  TechBgParams,
  findStyleById,
  resolveTargetDimensions,
} from './techBgTypes';
import { renderWebGLFieldToCanvas } from './techBgShaders';
import { renderDynamicGlslToCanvas } from './techBgDynamicShaders';
import { executeDynamicCanvasCode } from './techBgDynamicCanvas';

// ============================================================================
// Seeded PRNG & Math Utilities
// ============================================================================

export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seedInt: number): () => number {
  let a = seedInt >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateRandomSeed(): string {
  const digits = Math.floor(100000 + Math.random() * 899999);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `BG-${digits}-${chars[Math.floor(Math.random() * chars.length)]}${chars[Math.floor(Math.random() * chars.length)]}`;
}

export function generateGenerationId(): string {
  const ts = Date.now().toString(36).toUpperCase().slice(-4);
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return `BGS-${ts}-${rnd}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function isValidHex(hex: unknown): hex is string {
  return typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex.trim());
}

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [0.06, 0.28, 0.65];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function hslToRgb01(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [hue2rgb(hue + 1 / 3), hue2rgb(hue), hue2rgb(hue - 1 / 3)];
}

function rgb01ToCss(rgb: [number, number, number], alpha = 1): string {
  const r = Math.round(clamp(rgb[0], 0, 1) * 255);
  const g = Math.round(clamp(rgb[1], 0, 1) * 255);
  const b = Math.round(clamp(rgb[2], 0, 1) * 255);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

function rgb01ToHex(rgb: [number, number, number]): string {
  const toHex = (v: number) =>
    Math.round(clamp(v, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  const u = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function noise2D(x: number, y: number, seedOffset: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (ix: number, iy: number) => {
    const n = Math.sin(ix * 127.1 + iy * 311.7 + seedOffset * 74.7) * 43758.5453123;
    return n - Math.floor(n);
  };
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return (
    h(xi, yi) * (1 - u) * (1 - v) +
    h(xi + 1, yi) * u * (1 - v) +
    h(xi, yi + 1) * (1 - u) * v +
    h(xi + 1, yi + 1) * u * v
  );
}

function fbm2D(x: number, y: number, seedOffset: number, octaves = 3): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * noise2D(x * freq, y * freq, seedOffset + i * 19.3);
    freq *= 2.03;
    amp *= 0.5;
  }
  return val;
}

const yieldFrame = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

// ============================================================================
// AI Creative Director API Client (/api/bg/think)
// ============================================================================

export async function requestAiBlueprints(options: {
  category: BgCategoryOption;
  styleName?: string;
  prompt: string;
  colorStyle: ColorStyleOption;
  complexity: ComplexityLevel;
  aspectLabel: string;
  count: number;
  recentConcepts?: string[];
  referenceImage?: ReferenceImagePayload;
  previousBlueprint?: AiBlueprint;
  refineInstruction?: string;
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<AiBlueprint[]> {
  const response = await fetch('/api/bg/think', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      category: options.category,
      styleName: options.styleName || 'ai-invention',
      prompt: options.prompt,
      colorStyle: options.colorStyle,
      complexity: options.complexity,
      aspectLabel: options.aspectLabel,
      count: options.count,
      recentConcepts: options.recentConcepts || [],
      referenceImage: options.referenceImage
        ? {
            mimeType: options.referenceImage.mimeType,
            data: options.referenceImage.data,
          }
        : undefined,
      previousBlueprint: options.previousBlueprint,
      refineInstruction: options.refineInstruction,
      apiKey: options.apiKey,
    }),
  });

  const rawText = await response.text();
  let data: any = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = {};
    }
  }
  const isHtml = (response.headers.get('content-type') || '').includes('text/html') || /^\s*<!doctype|^\s*<html/i.test(rawText);
  if (!response.ok) {
    throw new Error(
      data?.error ||
        (isHtml ? `Server temporarily unavailable (HTTP ${response.status}). Please retry in a moment.` : `AI Creative Director error (${response.status})`)
    );
  }
  if (!Array.isArray(data?.blueprints) || data.blueprints.length === 0) {
    throw new Error('AI Creative Director returned no blueprints.');
  }
  return data.blueprints as AiBlueprint[];
}

export interface AiKeyCandidate {
  id: string;
  label?: string;
  key: string;
  provider?: string;
}

export async function requestAiRepair(options: {
  glslCode?: string;
  canvasCode?: string;
  errorLog: string;
  conceptTitle?: string;
  apiKey?: string;
  apiKeys?: Array<AiKeyCandidate | string>;
  activeKeyId?: string | null;
  signal?: AbortSignal;
}): Promise<{ glslCode?: string; canvasCode?: string }> {
  const response = await fetch('/api/bg/repair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      glslCode: options.glslCode,
      canvasCode: options.canvasCode,
      errorLog: options.errorLog,
      conceptTitle: options.conceptTitle,
      apiKey: options.apiKey,
      apiKeys: options.apiKeys,
      activeKeyId: options.activeKeyId,
    }),
  });

  const rawText = await response.text();
  let data: any = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = {};
    }
  }
  if (!response.ok) {
    throw new Error(data?.error || `Repair failed (${response.status})`);
  }
  return data as { glslCode?: string; canvasCode?: string };
}

// ============================================================================
// Palette & Composition Resolution
// ============================================================================

interface ResolvedPalette {
  base: [number, number, number];
  primary: [number, number, number];
  secondary: [number, number, number];
  accent: [number, number, number];
  highlight: [number, number, number];
  isLight: boolean;
}

function resolvePalette(
  params: TechBgParams,
  rng: () => number,
  blueprint?: AiBlueprint
): ResolvedPalette {
  const style = params.colorStyle;
  let base: [number, number, number];
  let primary: [number, number, number];
  let secondary: [number, number, number];
  let accent: [number, number, number];
  let highlight: [number, number, number];
  let isLight = false;

  if (style === 'Custom Palette') {
    primary = hexToRgb01(params.customPalette.primary);
    secondary = hexToRgb01(params.customPalette.secondary);
    accent = hexToRgb01(params.customPalette.accent);
    highlight = hexToRgb01(params.customPalette.highlight);
    base = hexToRgb01(params.baseColor);
    const lum = base[0] * 0.299 + base[1] * 0.587 + base[2] * 0.114;
    isLight = lum > 0.58;
  } else if (
    style === 'Random / AI-Curated' &&
    blueprint &&
    isValidHex(blueprint.paletteBase) &&
    isValidHex(blueprint.palettePrimary) &&
    isValidHex(blueprint.paletteSecondary) &&
    isValidHex(blueprint.paletteAccent) &&
    isValidHex(blueprint.paletteHighlight)
  ) {
    base = hexToRgb01(blueprint.paletteBase);
    primary = hexToRgb01(blueprint.palettePrimary);
    secondary = hexToRgb01(blueprint.paletteSecondary);
    accent = hexToRgb01(blueprint.paletteAccent);
    highlight = hexToRgb01(blueprint.paletteHighlight);
    const lum = base[0] * 0.299 + base[1] * 0.587 + base[2] * 0.114;
    isLight = lum > 0.58;
  } else if (style === 'Blue & Cyan') {
    const h = 196 + (rng() - 0.5) * 20;
    base = hslToRgb01(218, 0.65, 0.045);
    primary = hslToRgb01(h + 16, 0.78, 0.22);
    secondary = hslToRgb01(228, 0.72, 0.36);
    accent = hslToRgb01(h - 10, 0.94, 0.54);
    highlight = hslToRgb01(192, 0.92, 0.88);
  } else if (style === 'Purple & Violet') {
    const h = 266 + (rng() - 0.5) * 24;
    base = hslToRgb01(260, 0.58, 0.045);
    primary = hslToRgb01(h, 0.72, 0.26);
    secondary = hslToRgb01(h + 36, 0.76, 0.4);
    accent = hslToRgb01(h - 28, 0.88, 0.62);
    highlight = hslToRgb01(292, 0.86, 0.88);
  } else if (style === 'Black & Gold') {
    base = [0.03, 0.032, 0.04];
    primary = hslToRgb01(38, 0.45, 0.2);
    secondary = hslToRgb01(220, 0.12, 0.32);
    accent = hslToRgb01(42, 0.88, 0.54);
    highlight = hslToRgb01(48, 0.95, 0.84);
  } else if (style === 'Neon') {
    const pairs = [
      [184, 316],
      [158, 286],
      [196, 338],
    ];
    const p = pairs[Math.floor(rng() * pairs.length)];
    base = hslToRgb01(236, 0.55, 0.03);
    primary = hslToRgb01(p[0], 0.88, 0.28);
    secondary = hslToRgb01(p[1], 0.88, 0.42);
    accent = hslToRgb01(p[0], 0.98, 0.56);
    highlight = hslToRgb01(p[1], 0.95, 0.8);
  } else if (style === 'Monochrome') {
    const lightChance = rng() > 0.5;
    isLight = lightChance;
    if (lightChance) {
      base = [0.97, 0.975, 0.98];
      primary = [0.78, 0.8, 0.84];
      secondary = [0.54, 0.58, 0.64];
      accent = [0.14, 0.16, 0.2];
      highlight = [0.04, 0.05, 0.07];
    } else {
      base = [0.025, 0.028, 0.035];
      primary = [0.16, 0.18, 0.22];
      secondary = [0.38, 0.41, 0.47];
      accent = [0.78, 0.81, 0.86];
      highlight = [0.98, 0.99, 1.0];
    }
  } else if (style === 'Dark') {
    const h = [210, 232, 185, 258][Math.floor(rng() * 4)];
    base = hslToRgb01(h, 0.42, 0.035);
    primary = hslToRgb01(h, 0.58, 0.16);
    secondary = hslToRgb01(h + 24, 0.52, 0.28);
    accent = hslToRgb01(h - 8, 0.84, 0.52);
    highlight = hslToRgb01(h, 0.72, 0.86);
  } else if (style === 'Light') {
    isLight = true;
    const h = 202 + (rng() - 0.5) * 40;
    base = hslToRgb01(h, 0.22, 0.972);
    primary = hslToRgb01(h, 0.62, 0.74);
    secondary = hslToRgb01(h + 26, 0.56, 0.6);
    accent = hslToRgb01(h - 10, 0.82, 0.44);
    highlight = hslToRgb01(h + 6, 0.88, 0.26);
  } else {
    const h = rng() * 360;
    const lightVariant = rng() < 0.25;
    isLight = lightVariant;
    if (lightVariant) {
      base = hslToRgb01(h, 0.2, 0.965);
      primary = hslToRgb01(h, 0.6, 0.68);
      secondary = hslToRgb01(h + 36, 0.56, 0.56);
      accent = hslToRgb01(h + 145, 0.74, 0.44);
      highlight = hslToRgb01(h, 0.8, 0.24);
    } else {
      base = hslToRgb01(h, 0.5, 0.04);
      primary = hslToRgb01(h + 12, 0.72, 0.22);
      secondary = hslToRgb01(h + 50, 0.68, 0.36);
      accent = hslToRgb01(h - 16, 0.88, 0.55);
      highlight = hslToRgb01(h, 0.85, 0.86);
    }
  }

  if (params.useCustomBaseColor) {
    base = hexToRgb01(params.baseColor);
    const lum = base[0] * 0.299 + base[1] * 0.587 + base[2] * 0.114;
    isLight = lum > 0.58;
  }

  return { base, primary, secondary, accent, highlight, isLight };
}

export function resolvePaletteHexPreview(params: TechBgParams): {
  base: string;
  primary: string;
  secondary: string;
  accent: string;
  highlight: string;
  isLight: boolean;
} {
  const seedInt = hashSeed(params.seed || 'BG-DEFAULT');
  const rng = mulberry32(seedInt);
  // Consume the same initial RNG state as resolveComposition does? Wait:
  // resolveComposition runs before resolvePalette in renderBackgroundToCanvas; we mirror that order
  resolveComposition(params, rng);
  const p = resolvePalette(params, rng, params.aiBlueprint);
  return {
    base: rgb01ToHex(p.base),
    primary: rgb01ToHex(p.primary),
    secondary: rgb01ToHex(p.secondary),
    accent: rgb01ToHex(p.accent),
    highlight: rgb01ToHex(p.highlight),
    isLight: p.isLight,
  };
}

interface ResolvedComposition {
  resolvedCategory: CoreBgCategory;
  styleName: string;
  algorithmId: BgAlgorithmId;
  shaderStyle: BgShaderStyle;
  focalPoint: [number, number];
  lightAngle: number;
  geometryScale: number;
  conceptTitle: string;
  marketDemandInsight?: string;
  creativeRationale?: string;
  supportsTransparency: boolean;
}

const TRANSPARENT_CAPABLE: Record<BgAlgorithmId, boolean> = {
  'circuit-board': true,
  'network-nodes': true,
  'digital-grid': true,
  'data-matrix': true,
  'geometric-patterns': false,
  'low-poly': false,
  'voronoi-patterns': true,
  'concentric-patterns': true,
  '3d-spheres': true,
  '3d-torus': true,
  'liquid-chrome': true,
  '3d-structures': false,
  'fractal-art': false,
  'parametric-curves': true,
  'noise-patterns': true,
  'moire-patterns': true,
  'particle-field': true,
  'light-rays': true,
  'flow-waves': false,
  'light-trails': true,
  'topographic-elevation': true,
  'halftone-matrix': true,
  'isometric-architecture': false,
};

const DEFAULT_SHADER_BY_ALGO: Record<BgAlgorithmId, BgShaderStyle> = {
  'circuit-board': 'studio-minimal',
  'network-nodes': 'mesh-atmospheric',
  'digital-grid': 'studio-minimal',
  'data-matrix': 'studio-minimal',
  'geometric-patterns': 'studio-minimal',
  'low-poly': 'studio-minimal',
  'voronoi-patterns': 'voronoi-caustic',
  'concentric-patterns': 'studio-minimal',
  '3d-spheres': 'raymarch-spheres',
  '3d-torus': 'raymarch-torus',
  'liquid-chrome': 'raymarch-chrome',
  '3d-structures': 'studio-minimal',
  'fractal-art': 'fractal-julia',
  'parametric-curves': 'studio-minimal',
  'noise-patterns': 'noise-ridge',
  'moire-patterns': 'mesh-atmospheric',
  'particle-field': 'mesh-atmospheric',
  'light-rays': 'studio-minimal',
  'flow-waves': 'studio-minimal',
  'light-trails': 'mesh-atmospheric',
  'topographic-elevation': 'studio-minimal',
  'halftone-matrix': 'studio-minimal',
  'isometric-architecture': 'studio-minimal',
};

const CATEGORY_FALLBACK_ALGOS: Record<string, BgAlgorithmId[]> = {
  'Technology, Digital & Cyber': ['circuit-board', 'network-nodes', 'digital-grid', 'data-matrix'],
  '3D Procedural & Shader Art': ['3d-spheres', '3d-torus', 'liquid-chrome', '3d-structures', 'isometric-architecture'],
  'Abstract & Geometric Art': ['low-poly', 'geometric-patterns', 'voronoi-patterns', 'concentric-patterns', 'moire-patterns'],
  'Mathematical & Algorithmic Generative Art': ['fractal-art', 'parametric-curves', 'noise-patterns', 'moire-patterns'],
  'Patterns, Textures & Surface Overlays': ['topographic-elevation', 'halftone-matrix', 'noise-patterns', 'concentric-patterns'],
  'Commercial, Minimal & Editorial Backgrounds': ['flow-waves', 'light-rays', '3d-spheres', 'topographic-elevation'],
  'Typography, Graphic & Editorial Systems': ['geometric-patterns', 'concentric-patterns', 'halftone-matrix'],
  'Atmospheric, Light & Optical Phenomena': ['light-rays', 'light-trails', 'voronoi-patterns', 'particle-field'],
  'Abstract Flow, Fluids & Physical Dynamics': ['flow-waves', 'particle-field', 'light-trails', 'parametric-curves'],
  'Architectural, Structural & Spatial Layouts': ['isometric-architecture', '3d-structures', 'digital-grid', 'geometric-patterns'],
};

const STYLE_TO_FALLBACK_ALGO: Record<string, BgAlgorithmId> = {
  'circuit-board-microchip': 'circuit-board',
  'digital-networks-nodes': 'network-nodes',
  'futuristic-grids-horizons': 'digital-grid',
  'data-flows-particle-streams': 'light-trails',
  'wireframes-holographic': 'digital-grid',
  'cyber-security-matrix': 'data-matrix',
  'ai-neural-topology': 'network-nodes',
  'liquid-chrome-metallic': 'liquid-chrome',
  '3d-spheres-torus-forms': '3d-spheres',
  'frosted-glass-refraction': '3d-torus',
  '3d-isometric-architectural': 'isometric-architecture',
  'volumetric-lighting-rays': 'light-rays',
  '3d-terrain-elevation-mesh': 'topographic-elevation',
  'low-poly-polygon': 'low-poly',
  'voronoi-cellular': 'voronoi-patterns',
  'tessellations-repeating': 'geometric-patterns',
  'moire-interference': 'moire-patterns',
  'minimalist-bauhaus': 'geometric-patterns',
  'abstract-ribbons-swirls': 'flow-waves',
  'fractals-self-similar': 'fractal-art',
  'perlin-simplex-noise': 'noise-patterns',
  'domain-warping-marble': 'flow-waves',
  'parametric-harmonic-curves': 'parametric-curves',
  'strange-attractors': 'particle-field',
  'phyllotaxis-sacred-geometry': 'concentric-patterns',
  'sine-soundwaves-equalizers': 'parametric-curves',
  'mesh-gradients-aurora': 'flow-waves',
  'topographic-contour-lines': 'topographic-elevation',
  'halftone-dots-print': 'halftone-matrix',
  'film-grain-paper-texture': 'noise-patterns',
  'stripes-chevrons-rhythms': 'moire-patterns',
  'organic-botanical-patterns': 'concentric-patterns',
  'minimal-corporate-backdrops': 'topographic-elevation',
  'pastel-soft-calm': 'flow-waves',
  'luxury-dark-gold-editorial': '3d-spheres',
  'retro-synthwave-vintage': 'digital-grid',
  'nature-sky-water-abstracts': 'flow-waves',
  'swiss-grid-editorial': 'geometric-patterns',
  'minimalist-line-art-posters': 'concentric-patterns',
  'halftone-pop-graphic': 'halftone-matrix',
  'caustics-water-light': 'voronoi-patterns',
  'bokeh-light-orbs': 'particle-field',
  'prism-dispersion-iridescent': 'light-rays',
  'curl-noise-smoke-ink': 'light-trails',
  'reaction-diffusion-turing': 'noise-patterns',
  'pendulum-spirograph-harmonograph': 'parametric-curves',
  'cloth-wave-mesh-deformation': 'parametric-curves',
  'brutalist-concrete-monolithic': '3d-structures',
  'grid-systems-blueprints-cad': 'circuit-board',
  'perspective-tunnels-portals': 'digital-grid',
};

const VALID_ALGO_SET = new Set<string>(ALL_ALGORITHMS);

export function formatAlgoLabel(id: BgAlgorithmId): string {
  return id
    .split('-')
    .map((w) => (w === '3d' ? '3D' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function findCategoryForAlgo(id: BgAlgorithmId): CoreBgCategory {
  for (const [cat, algos] of Object.entries(CATEGORY_FALLBACK_ALGOS)) {
    if (algos.includes(id)) return cat;
  }
  return BG_TAXONOMY[0].name;
}

function resolveComposition(
  params: TechBgParams,
  rng: () => number
): ResolvedComposition {
  const bp = params.aiBlueprint;
  const isAutoCategory = !params.category || params.category.startsWith('Auto');
  const userForcedCategory = !isAutoCategory ? params.category : null;
  const selectedStyle =
    params.styleSelection && params.styleSelection !== 'ai-invention'
      ? findStyleById(params.styleSelection)
      : null;

  let resolvedCategory: CoreBgCategory =
    userForcedCategory ||
    selectedStyle?.category.name ||
    (bp?.resolvedCategory && CORE_BG_CATEGORIES.includes(bp.resolvedCategory)
      ? bp.resolvedCategory
      : CORE_BG_CATEGORIES[Math.floor(rng() * CORE_BG_CATEGORIES.length)]);

  let algorithmId: BgAlgorithmId;
  if (params.algorithmOverride !== 'auto' && VALID_ALGO_SET.has(params.algorithmOverride)) {
    algorithmId = params.algorithmOverride;
    if (!userForcedCategory && !selectedStyle) {
      resolvedCategory = findCategoryForAlgo(algorithmId);
    }
  } else if (selectedStyle && STYLE_TO_FALLBACK_ALGO[selectedStyle.style.id]) {
    algorithmId = STYLE_TO_FALLBACK_ALGO[selectedStyle.style.id];
  } else if (bp?.algorithmId && VALID_ALGO_SET.has(bp.algorithmId)) {
    algorithmId = bp.algorithmId;
  } else if (CATEGORY_FALLBACK_ALGOS[resolvedCategory]) {
    const allowedAlgos = CATEGORY_FALLBACK_ALGOS[resolvedCategory];
    algorithmId = allowedAlgos[Math.floor(rng() * allowedAlgos.length)];
  } else if (bp) {
    const hint = `${bp.resolvedCategory || ''} ${bp.conceptTitle || ''} ${bp.styleName || ''}`.toLowerCase();
    if (/circuit|chip|pcb|matrix|cyber/.test(hint)) algorithmId = 'circuit-board';
    else if (/voronoi|crystal|glass|caustic/.test(hint)) algorithmId = 'voronoi-patterns';
    else if (/chrome|liquid|metal/.test(hint)) algorithmId = 'liquid-chrome';
    else if (/torus|ring|donut/.test(hint)) algorithmId = '3d-torus';
    else if (/wave|silk|aurora|mesh|gradient|fluid|soft|pastel|calm/.test(hint)) algorithmId = 'flow-waves';
    else algorithmId = bp.renderMode === 'glsl' ? '3d-spheres' : 'flow-waves';
  } else {
    algorithmId = ALL_ALGORITHMS[Math.floor(rng() * ALL_ALGORITHMS.length)];
  }

  const shaderStyle: BgShaderStyle = DEFAULT_SHADER_BY_ALGO[algorithmId];

  const focalPresets: [number, number][] = [
    [0.5, 0.5],
    [0.64, 0.48],
    [0.36, 0.52],
    [0.58, 0.4],
    [0.42, 0.6],
  ];
  const fallbackFocal = focalPresets[Math.floor(rng() * focalPresets.length)];

  const bpApplies =
    Boolean(bp) &&
    (!userForcedCategory || bp!.resolvedCategory === userForcedCategory);

  const baseFocalX = bpApplies
    ? clamp(Number(bp!.focalX) || fallbackFocal[0], 0.18, 0.82)
    : fallbackFocal[0];
  const baseFocalY = bpApplies
    ? clamp(Number(bp!.focalY) || fallbackFocal[1], 0.18, 0.82)
    : fallbackFocal[1];
  const focalX = clamp(baseFocalX + (params.offsetX || 0) / 220, 0.1, 0.9);
  const focalY = clamp(baseFocalY + (params.offsetY || 0) / 220, 0.1, 0.9);

  const baseAngleDeg = bpApplies ? Number(bp!.lightAngleDeg) || 0 : Math.round(rng() * 360);
  const lightAngle = (((baseAngleDeg + params.rotation) % 360) * Math.PI) / 180;

  const aiScale = bpApplies ? clamp(Number(bp!.geometryScale) || 1, 0.65, 1.5) : 1.0;
  const geometryScale = clamp((params.scale / 100) * aiScale, 0.35, 2.5);

  const styleName =
    (bpApplies && bp?.styleName) ||
    selectedStyle?.style.name ||
    formatAlgoLabel(algorithmId);

  const hasDynamicCode = Boolean(
    bpApplies &&
      bp &&
      (((bp.renderMode === 'glsl' || bp.renderMode === 'hybrid') && bp.glslCode?.trim()) ||
        ((bp.renderMode === 'canvas' || bp.renderMode === 'hybrid') && bp.canvasCode?.trim()))
  );

  const supportsTransparency = hasDynamicCode
    ? Boolean(bp?.supportsTransparency)
    : selectedStyle
      ? selectedStyle.style.supportsTransparency
      : TRANSPARENT_CAPABLE[algorithmId];

  return {
    resolvedCategory,
    styleName,
    algorithmId,
    shaderStyle,
    focalPoint: [focalX, focalY],
    lightAngle,
    geometryScale,
    conceptTitle: bpApplies && bp?.conceptTitle ? bp.conceptTitle : styleName,
    marketDemandInsight: bpApplies ? bp?.marketDemandInsight : undefined,
    creativeRationale: bpApplies ? bp?.creativeRationale : undefined,
    supportsTransparency,
  };
}

// ============================================================================
// High-Craft 2D Procedural Rendering Algorithms
// ============================================================================

interface DrawState {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  minDim: number;
  scale: number;
  lineScale: number;
  geoScale: number;
  rng: () => number;
  palette: ResolvedPalette;
  comp: ResolvedComposition;
  density: number;
  glow: number;
  depth: number;
  compMult: number;
  seedFloat: number;
  transparent: boolean;
}

const COMPLEXITY_MULT: Record<ComplexityLevel, number> = {
  Minimal: 0.55,
  Balanced: 0.9,
  Detailed: 1.25,
  'Ultra Detailed': 1.65,
};

// 1A. Circuit Board (Image 2 top-left: Dense crisp cyan 45/90 PCB traces with hollow ring vias)
function renderCircuitBoard(s: DrawState) {
  const { ctx, w, h, minDim, rng, palette, density, glow, compMult, lineScale, geoScale } = s;
  const step = (minDim / Math.round(22 + density * 24)) * geoScale;
  const count = Math.round((44 + density * 65) * compMult);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const vias: Array<{ x: number; y: number; r: number; bright: boolean }> = [];
  const cols = Math.floor(w / step);
  const rows = Math.floor(h / step);

  for (let i = 0; i < count; i++) {
    let cx = Math.floor(rng() * cols) * step;
    let cy = Math.floor(rng() * rows) * step;
    const bright = rng() < 0.42;
    const alpha = bright ? 0.55 + glow * 0.42 : 0.25 + glow * 0.25;

    ctx.strokeStyle = rgb01ToCss(bright ? palette.accent : palette.secondary, alpha);
    ctx.lineWidth = Math.max(0.85, s.scale * (bright ? 1.9 : 1.25) * lineScale);

    const segs = 3 + Math.floor(rng() * 6);
    let dir = Math.floor(rng() * 8);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    vias.push({ x: cx, y: cy, r: step * 0.26, bright });

    for (let k = 0; k < segs; k++) {
      const len = 1 + Math.floor(rng() * 4);
      const ang = (dir * Math.PI) / 4;
      cx += Math.round(Math.cos(ang)) * len * step;
      cy += Math.round(Math.sin(ang)) * len * step;
      ctx.lineTo(cx, cy);
      if (rng() < 0.65) {
        dir = (dir + (rng() > 0.5 ? 1 : -1) + 8) % 8;
      }
    }
    ctx.stroke();
    vias.push({ x: cx, y: cy, r: step * 0.28, bright });
  }

  // Hollow via pads ('o') exactly like precision PCB artwork
  for (const v of vias) {
    ctx.beginPath();
    ctx.arc(v.x, v.y, Math.max(2, v.r * lineScale), 0, Math.PI * 2);
    ctx.fillStyle = rgb01ToCss(palette.base, s.transparent ? 0.95 : 1.0);
    ctx.fill();
    ctx.strokeStyle = rgb01ToCss(v.bright ? palette.highlight : palette.accent, v.bright ? 0.92 : 0.55);
    ctx.lineWidth = Math.max(0.85, s.scale * 1.6 * lineScale);
    ctx.stroke();
  }
  ctx.restore();
}

// 1B. Network Nodes (Image 2 top-right: Deep cobalt + sharp triangulated mesh + luminous focal nodes)
function renderNetworkNodes(s: DrawState) {
  const { ctx, w, h, minDim, rng, palette, density, glow, depth, compMult, lineScale, geoScale } = s;
  const count = Math.round((36 + density * 64) * compMult);
  const fx = w * s.comp.focalPoint[0];
  const fy = h * s.comp.focalPoint[1];

  const nodes = Array.from({ length: count }, () => {
    const z = rng();
    const ang = rng() * Math.PI * 2;
    const rad = Math.pow(rng(), 0.65) * minDim * 0.58 * geoScale;
    return {
      x: fx + Math.cos(ang) * rad * (w / minDim) * 0.85,
      y: fy + Math.sin(ang) * rad * 0.78,
      z,
      hub: z > 0.72,
      r: s.scale * (1.8 + z * 4.8) * lineScale,
    };
  });

  ctx.save();
  ctx.globalCompositeOperation = palette.isLight ? 'source-over' : 'screen';
  const maxD = minDim * (0.17 + (1 - density) * 0.08) * geoScale;

  for (let i = 0; i < nodes.length; i++) {
    let links = 0;
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[j].x - nodes[i].x, nodes[j].y - nodes[i].y);
      if (d < maxD && links < 5) {
        links++;
        const zAvg = (nodes[i].z + nodes[j].z) * 0.5;
        const a = (1 - d / maxD) * (0.16 + zAvg * 0.45 * (0.4 + depth * 0.6));
        ctx.strokeStyle = rgb01ToCss(palette.accent, a * (0.65 + glow * 0.55));
        ctx.lineWidth = Math.max(0.65, s.scale * (0.7 + zAvg * 1.4) * lineScale);
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[j].x, nodes[j].y);
        ctx.stroke();
      }
    }
  }

  for (const n of nodes) {
    const a = 0.25 + n.z * 0.72;
    if (n.hub && glow > 0.15) {
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 5.2);
      g.addColorStop(0, rgb01ToCss(palette.highlight, a * 0.75 * glow));
      g.addColorStop(0.35, rgb01ToCss(palette.accent, a * 0.35 * glow));
      g.addColorStop(1, rgb01ToCss(palette.accent, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * 5.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = rgb01ToCss(n.hub ? palette.highlight : palette.accent, a);
    ctx.fill();
  }
  ctx.restore();
}

// 1C. Digital Grid (Image 2 bottom-left: Dual-plane 3D perspective floor + ceiling laser grid)
function renderDigitalGrid(s: DrawState) {
  const { ctx, w, h, palette, density, glow, depth, lineScale, geoScale } = s;
  const vx = w * s.comp.focalPoint[0];
  const vy = h * s.comp.focalPoint[1];

  ctx.save();
  ctx.globalCompositeOperation = palette.isLight ? 'source-over' : 'screen';

  const rays = Math.round((12 + density * 18) * geoScale);
  const spread = w * (1.8 + depth * 1.4);

  const drawPlane = (isCeiling: boolean) => {
    const edgeY = isCeiling ? 0 : h;
    for (let i = 0; i <= rays; i++) {
      const t = i / rays - 0.5;
      const xEnd = vx + t * spread;
      const g = ctx.createLinearGradient(vx, vy, xEnd, edgeY);
      g.addColorStop(0, rgb01ToCss(palette.accent, 0));
      g.addColorStop(0.28, rgb01ToCss(palette.accent, 0.18 + glow * 0.3));
      g.addColorStop(1, rgb01ToCss(palette.highlight, 0.45 + glow * 0.45));

      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(0.8, s.scale * 1.35 * lineScale);
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.lineTo(xEnd, edgeY);
      ctx.stroke();
    }

    const hLines = Math.round(7 + density * 10);
    for (let j = 1; j <= hLines; j++) {
      const u = Math.pow(j / hLines, 2.25);
      const y = vy + u * (edgeY - vy);
      ctx.strokeStyle = rgb01ToCss(palette.accent, (0.08 + u * 0.48) * (0.45 + glow * 0.55));
      ctx.lineWidth = Math.max(0.75, s.scale * (0.7 + u * 1.8) * lineScale);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  };

  drawPlane(false);
  drawPlane(true);
  ctx.restore();
}

// 1D. Data Matrix (Image 2 bottom-right: Crisp vertical binary 0/1 columns with bright head highlights)
function renderDataMatrix(s: DrawState) {
  const { ctx, w, h, minDim, rng, palette, density, glow, lineScale, geoScale } = s;
  const fontSize = Math.max(8, (minDim / Math.round(28 + density * 36)) * geoScale * lineScale);
  const colW = fontSize * 1.15;
  const rowH = fontSize * 1.28;
  const cols = Math.ceil(w / colW);
  const rows = Math.ceil(h / rowH);

  ctx.save();
  ctx.font = `600 ${Math.round(fontSize)}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let c = 0; c < cols; c++) {
    const x = c * colW + colW * 0.5;
    const colActive = rng();
    const isHeroCol = colActive > 0.86;
    const headRow = Math.floor(rng() * rows);
    const trailLen = Math.round(6 + rng() * rows * 0.65);

    for (let r = 0; r < rows; r++) {
      const dist = (headRow - r + rows) % rows;
      const inTrail = dist < trailLen;
      const baseAlpha = isHeroCol
        ? 0.25 + (1 - dist / trailLen) * 0.72
        : inTrail
          ? 0.08 + (1 - dist / trailLen) * 0.34
          : 0.05;

      const isBrightHead = (isHeroCol && dist <= 2) || rng() < 0.035;
      const bit = rng() > 0.5 ? '1' : '0';

      ctx.fillStyle = rgb01ToCss(
        isBrightHead ? palette.highlight : palette.accent,
        clamp(baseAlpha * (0.55 + glow * 0.65), 0.03, 0.98)
      );
      ctx.fillText(bit, x, r * rowH + rowH * 0.5);
    }
  }
  ctx.restore();
}

// 2A & 2B. Geometric Patterns (no stroke, rich dark/contrast facets) & Low Poly (vibrant gradient + crisp white borders)
function renderTriangulatedMesh(s: DrawState, withWhiteWireframe: boolean) {
  const { ctx, w, h, rng, palette, density, depth, glow, lineScale, geoScale } = s;
  const cols = Math.max(4, Math.round((6 + density * 11) / geoScale));
  const rows = Math.max(3, Math.round((cols * h) / w));
  const cw = w / cols;
  const ch = h / rows;

  const pts: Array<Array<[number, number]>> = [];
  for (let r = 0; r <= rows; r++) {
    const rowPts: Array<[number, number]> = [];
    for (let c = 0; c <= cols; c++) {
      const jx = c === 0 || c === cols ? 0 : (rng() - 0.5) * cw * 0.78;
      const jy = r === 0 || r === rows ? 0 : (rng() - 0.5) * ch * 0.78;
      rowPts.push([c * cw + jx, r * ch + jy]);
    }
    pts.push(rowPts);
  }

  const lx = Math.cos(s.comp.lightAngle);
  const ly = Math.sin(s.comp.lightAngle);

  ctx.save();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p00 = pts[r][c];
      const p10 = pts[r][c + 1];
      const p01 = pts[r + 1][c];
      const p11 = pts[r + 1][c + 1];

      const tris =
        rng() > 0.5
          ? [
              [p00, p10, p11],
              [p00, p11, p01],
            ]
          : [
              [p00, p10, p01],
              [p10, p11, p01],
            ];

      for (const tri of tris) {
        const mx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3 / w;
        const my = (tri[0][1] + tri[1][1] + tri[2][1]) / 3 / h;
        const dirVal = (mx - 0.5) * lx + (my - 0.5) * ly;

        let col: [number, number, number];
        if (withWhiteWireframe) {
          // Smooth gradient across canvas with facet variance (Low Poly style)
          const gT = clamp(0.5 + dirVal * 0.9 + (rng() - 0.5) * 0.14, 0, 1);
          col = gT < 0.5 ? lerpRgb(palette.primary, palette.secondary, gT * 2) : lerpRgb(palette.secondary, palette.accent, (gT - 0.5) * 2);
        } else {
          // Sharp contrasting geometric facets (Geometric Patterns style)
          const facetTone = clamp(0.45 + dirVal * (0.5 + depth * 0.5) + (rng() - 0.5) * 0.55, 0, 1);
          col =
            facetTone < 0.35
              ? lerpRgb(palette.base, palette.primary, facetTone / 0.35)
              : facetTone < 0.72
                ? lerpRgb(palette.primary, palette.secondary, (facetTone - 0.35) / 0.37)
                : lerpRgb(palette.secondary, palette.accent, (facetTone - 0.72) / 0.28);
        }

        ctx.beginPath();
        ctx.moveTo(tri[0][0], tri[0][1]);
        ctx.lineTo(tri[1][0], tri[1][1]);
        ctx.lineTo(tri[2][0], tri[2][1]);
        ctx.closePath();

        ctx.fillStyle = rgb01ToCss(col, 1.0);
        ctx.fill();

        if (withWhiteWireframe) {
          ctx.strokeStyle = rgb01ToCss(palette.highlight, 0.7 + glow * 0.28);
          ctx.lineWidth = Math.max(0.8, s.scale * 1.45 * lineScale);
          ctx.stroke();
        } else {
          // Subpixel anti-seam stroke matching fill color
          ctx.strokeStyle = rgb01ToCss(col, 1.0);
          ctx.lineWidth = 0.75;
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}

// 2D. Concentric Patterns (Image 1 bottom-right: Overlapping geometric concentric circle bands)
function renderConcentricPatterns(s: DrawState) {
  const { ctx, w, h, minDim, rng, palette, density, compMult, lineScale, geoScale } = s;
  const clusterCount = Math.round((5 + density * 6) * compMult);

  ctx.save();
  if (!s.transparent) {
    ctx.fillStyle = rgb01ToCss(palette.isLight ? palette.base : [0.98, 0.985, 0.99], 1);
    ctx.fillRect(0, 0, w, h);
  }

  const ringStroke = palette.isLight ? palette.highlight : [0.05, 0.06, 0.08] as [number, number, number];
  const discFill = palette.isLight ? palette.base : [0.985, 0.988, 0.992] as [number, number, number];

  for (let c = 0; c < clusterCount; c++) {
    const cx = rng() * w;
    const cy = rng() * h;
    const maxR = minDim * (0.28 + rng() * 0.35) * geoScale;
    const step = (minDim / Math.round(28 + density * 36)) * geoScale;

    // Mask previous concentric cluster cleanly so overlapping bands read like Image 1 bottom-right
    if (!s.transparent) {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.fillStyle = rgb01ToCss(discFill, 1);
      ctx.fill();
    }

    ctx.strokeStyle = rgb01ToCss(ringStroke, 0.92);
    ctx.lineWidth = Math.max(1.0, s.scale * 2.1 * lineScale);
    for (let r = step; r <= maxR; r += step) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// 3D. 3D Structures (Image 4 bottom-right: Dense extruded isometric architectural rectangular monolith blocks)
function render3DStructures(s: DrawState) {
  const { ctx, w, h, minDim, rng, palette, density, depth, glow, geoScale } = s;
  const cols = Math.round((9 + density * 10) / geoScale);
  const rows = Math.round((9 + density * 10) / geoScale);
  const blockW = (minDim * 0.14) * geoScale;
  const blockH = blockW * 0.56;
  const originX = w * 0.5;
  const originY = -h * 0.12;

  ctx.save();
  // Painter's algorithm back-to-front
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ix = originX + (c - r) * (blockW * 0.52);
      const iy = originY + (c + r) * (blockH * 0.52);
      const elev =
        (0.35 + fbm2D(c * 0.45, r * 0.45, s.seedFloat, 2) * 1.65 + rng() * 0.55) *
        minDim *
        (0.16 + depth * 0.2);

      const topY = iy - elev * 0.35;
      const hw = blockW * 0.54;
      const hh = blockH * 0.54;

      // Top face (lit key highlight)
      ctx.beginPath();
      ctx.moveTo(ix, topY - hh);
      ctx.lineTo(ix + hw, topY);
      ctx.lineTo(ix, topY + hh);
      ctx.lineTo(ix - hw, topY);
      ctx.closePath();
      ctx.fillStyle = rgb01ToCss(lerpRgb(palette.accent, palette.highlight, 0.2 + glow * 0.3), 1);
      ctx.fill();

      // Left face (mid tone)
      ctx.beginPath();
      ctx.moveTo(ix - hw, topY);
      ctx.lineTo(ix, topY + hh);
      ctx.lineTo(ix, topY + hh + elev);
      ctx.lineTo(ix - hw, topY + elev);
      ctx.closePath();
      ctx.fillStyle = rgb01ToCss(palette.secondary, 1);
      ctx.fill();

      // Right face (deep shadow tone)
      ctx.beginPath();
      ctx.moveTo(ix, topY + hh);
      ctx.lineTo(ix + hw, topY);
      ctx.lineTo(ix + hw, topY + elev);
      ctx.lineTo(ix, topY + hh + elev);
      ctx.closePath();
      ctx.fillStyle = rgb01ToCss(lerpRgb(palette.base, palette.primary, 0.55), 1);
      ctx.fill();
    }
  }
  ctx.restore();
}

// 4B. Parametric Curves (Image 3 top-right: Crisp twisting 45-strand ribbon of parallel sinusoidal curves)
function renderParametricCurves(s: DrawState) {
  const { ctx, w, h, minDim, palette, density, glow, depth, compMult, lineScale, geoScale } = s;
  const strands = Math.round((24 + density * 36) * compMult);
  const cols = 140;
  const amp = minDim * (0.14 + depth * 0.18) * geoScale;

  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.rotate((s.comp.lightAngle - Math.PI * 0.25) * 0.22);
  ctx.translate(-w * 0.5, -h * 0.5);

  for (let i = 0; i < strands; i++) {
    const t = i / Math.max(1, strands - 1);
    const alpha = (0.28 + Math.sin(t * Math.PI) * 0.6) * (0.55 + glow * 0.45);
    ctx.strokeStyle = rgb01ToCss(
      palette.isLight ? palette.highlight : lerpRgb(palette.accent, palette.highlight, 0.72),
      alpha
    );
    ctx.lineWidth = Math.max(0.7, s.scale * 1.15 * lineScale);
    ctx.beginPath();

    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const x = -w * 0.05 + u * w * 1.1;
      const twist = Math.sin(u * Math.PI * (1.8 + density * 1.4) + s.seedFloat * 0.2);
      const envelope = Math.cos(u * Math.PI * 1.3 - 0.4);
      const ribbonOffset = (t - 0.5) * minDim * (0.04 + 0.34 * Math.abs(envelope)) * geoScale;
      const y = h * 0.5 + twist * amp + ribbonOffset;
      if (c === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// 4D. Moire Patterns (Image 3 bottom-right: Symmetrical diamond/spindle interference harmonic lattice)
function renderMoirePatterns(s: DrawState) {
  const { ctx, w, h, minDim, palette, density, glow, depth, compMult, lineScale, geoScale } = s;
  const curves = Math.round((22 + density * 34) * compMult);
  const cols = 120;
  const lobes = Math.max(2, Math.round((3 + density * 3) / geoScale));

  ctx.save();
  ctx.globalCompositeOperation = palette.isLight ? 'source-over' : 'screen';

  for (let i = 0; i < curves; i++) {
    const t = (i / Math.max(1, curves - 1)) * 2 - 1;
    const isUpper = i % 2 === 0;
    const col = isUpper ? palette.accent : palette.secondary;
    ctx.strokeStyle = rgb01ToCss(col, (0.2 + (1 - Math.abs(t)) * 0.55) * (0.5 + glow * 0.5));
    ctx.lineWidth = Math.max(0.7, s.scale * 1.05 * lineScale);

    for (const sign of [-1, 1]) {
      ctx.beginPath();
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const x = u * w;
        const env = Math.sin(u * Math.PI * lobes);
        const y =
          h * 0.5 +
          sign * env * h * (0.12 + 0.32 * depth) * (0.35 + Math.abs(t) * 0.8) +
          t * minDim * 0.08;
        if (c === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// 4E. Particle Field (Image 5 top-left: Dense 3D dot-matrix wave surface with bright caustic ridges)
function renderParticleField(s: DrawState) {
  const { ctx, w, h, minDim, palette, density, glow, depth, lineScale, geoScale } = s;
  const cols = Math.round(48 + density * 38);
  const rows = Math.round(38 + density * 30);

  ctx.save();
  ctx.globalCompositeOperation = palette.isLight ? 'source-over' : 'screen';

  for (let r = 0; r < rows; r++) {
    const vt = r / rows;
    for (let c = 0; c < cols; c++) {
      const ut = c / cols;
      const n = fbm2D(ut * 3.8 / geoScale, vt * 3.8 / geoScale, s.seedFloat, 3);
      const wave = Math.sin(ut * 9.0 + n * 4.5) * Math.cos(vt * 8.0 - n * 4.0);
      const ridge = clamp(1 - Math.abs(wave), 0, 1);
      const bright = Math.pow(ridge, 2.4);

      const x = ut * w + wave * minDim * 0.018 * depth;
      const y = vt * h + Math.cos(ut * 7 + n * 3) * minDim * 0.02 * depth;
      const dotR = Math.max(0.75, s.scale * (1.1 + bright * 2.8) * lineScale);

      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fillStyle = rgb01ToCss(
        bright > 0.65 ? palette.highlight : palette.accent,
        clamp((0.2 + bright * 0.78) * (0.5 + glow * 0.6), 0.1, 1)
      );
      ctx.fill();
    }
  }
  ctx.restore();
}

// 4F. Light Rays (Image 5 bottom-right: Radial golden starburst dot tunnel with luminous core)
function renderLightRays(s: DrawState) {
  const { ctx, w, h, minDim, palette, density, glow, compMult, lineScale, geoScale } = s;
  const cx = w * s.comp.focalPoint[0];
  const cy = h * s.comp.focalPoint[1];
  const spokes = Math.round((44 + density * 44) * compMult);
  const rings = Math.round(20 + density * 18);
  const maxR = Math.max(w, h) * 0.78 * geoScale;

  ctx.save();
  ctx.globalCompositeOperation = palette.isLight ? 'source-over' : 'screen';

  // Core radial glow
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.45);
  core.addColorStop(0, rgb01ToCss(palette.highlight, 0.75 * glow + 0.15));
  core.addColorStop(0.35, rgb01ToCss(palette.accent, 0.38 * glow));
  core.addColorStop(1, rgb01ToCss(palette.accent, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR * 0.45, 0, Math.PI * 2);
  ctx.fill();

  for (let rIdx = 1; rIdx <= rings; rIdx++) {
    const rt = rIdx / rings;
    const radius = Math.pow(rt, 1.35) * maxR;
    const dotR = Math.max(0.8, s.scale * (1.2 + rt * 3.8) * lineScale);
    const alpha = clamp((1 - rt * 0.65) * (0.4 + glow * 0.6), 0.08, 0.95);

    for (let sp = 0; sp < spokes; sp++) {
      const ang = (sp / spokes) * Math.PI * 2 + s.comp.lightAngle * 0.25;
      const px = cx + Math.cos(ang) * radius;
      const py = cy + Math.sin(ang) * radius;

      ctx.beginPath();
      ctx.arc(px, py, dotR, 0, Math.PI * 2);
      ctx.fillStyle = rgb01ToCss(rt < 0.35 ? palette.highlight : palette.accent, alpha);
      ctx.fill();
    }
  }
  ctx.restore();
}

// 5A. Flow Waves (Image 5 bottom-left: Smooth layered silk contour wave ribbons)
function renderFlowWaves(s: DrawState) {
  const { ctx, w, h, minDim, palette, density, glow, depth, compMult, lineScale, geoScale } = s;
  const bands = Math.round((32 + density * 48) * compMult);
  const cols = 110;
  const amp = minDim * (0.14 + depth * 0.18) * geoScale;

  ctx.save();
  if (!s.transparent) {
    ctx.fillStyle = rgb01ToCss(palette.base, 1);
    ctx.fillRect(0, 0, w, h);
  }

  for (let b = 0; b < bands; b++) {
    const bt = b / Math.max(1, bands - 1);
    const yBase = -h * 0.15 + bt * h * 1.3;
    const isAccent = b % 5 === 0;
    const isHighlight = b % 9 === 0;

    ctx.strokeStyle = rgb01ToCss(
      isHighlight ? palette.highlight : isAccent ? palette.accent : palette.secondary,
      (isHighlight ? 0.72 : isAccent ? 0.58 : 0.26) * (0.55 + glow * 0.45)
    );
    ctx.lineWidth = Math.max(0.9, s.scale * (isHighlight ? 2.6 : 1.5) * lineScale);
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      const xt = c / cols;
      const x = xt * w;
      const n = fbm2D(xt * 2.4, bt * 1.8, s.seedFloat, 3);
      const y = yBase + Math.sin(xt * 4.5 + n * 4.2 + bt * 2.0) * amp;
      if (c === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// 5B. Light Trails (Image 5 top-right: Sweeping diagonal curved optical fiber streams + spark bokeh)
function renderLightTrails(s: DrawState) {
  const { ctx, w, h, minDim, rng, palette, density, glow, compMult, lineScale, geoScale } = s;
  const count = Math.round((22 + density * 36) * compMult);
  const fx = w * s.comp.focalPoint[0];
  const fy = h * s.comp.focalPoint[1];

  ctx.save();
  ctx.globalCompositeOperation = palette.isLight ? 'source-over' : 'screen';
  ctx.lineCap = 'round';

  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const sx = -w * 0.08;
    const sy = h * (0.2 + t * 0.75 + (rng() - 0.5) * 0.1);
    const ex = w * 1.08;
    const ey = h * (0.05 + (1 - t) * 0.55 + (rng() - 0.5) * 0.12);

    const cp1x = fx - w * 0.18 + (rng() - 0.5) * w * 0.2 * geoScale;
    const cp1y = fy + (rng() - 0.5) * h * 0.35;
    const cp2x = fx + w * 0.18 + (rng() - 0.5) * w * 0.2 * geoScale;
    const cp2y = fy - h * 0.15 + (rng() - 0.5) * h * 0.25;

    const hot = i % 4 === 0;
    if (glow > 0.2) {
      ctx.strokeStyle = rgb01ToCss(i % 2 === 0 ? palette.accent : palette.secondary, 0.12 + glow * 0.2);
      ctx.lineWidth = Math.max(2, s.scale * 7.5 * lineScale);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
      ctx.stroke();
    }

    ctx.strokeStyle = rgb01ToCss(hot ? palette.highlight : palette.accent, 0.38 + glow * 0.52);
    ctx.lineWidth = Math.max(0.8, s.scale * (hot ? 2.2 : 1.15) * lineScale);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
    ctx.stroke();

    // Sparkling fiber dots
    for (let k = 0; k < 2; k++) {
      const u = 0.2 + rng() * 0.65;
      const mu = 1 - u;
      const px = mu * mu * mu * sx + 3 * mu * mu * u * cp1x + 3 * mu * u * u * cp2x + u * u * u * ex;
      const py = mu * mu * mu * sy + 3 * mu * mu * u * cp1y + 3 * mu * u * u * cp2y + u * u * u * ey;
      const pr = minDim * (0.005 + glow * 0.012) * lineScale;
      const g = ctx.createRadialGradient(px, py, 0, px, py, pr * 2.2);
      g.addColorStop(0, rgb01ToCss(palette.highlight, 0.95));
      g.addColorStop(1, rgb01ToCss(palette.accent, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, pr * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// 5C. Topographic Elevation Lines
function renderTopographicElevation(s: DrawState) {
  const { ctx, w, h, palette, density, glow, compMult, lineScale, geoScale } = s;
  const cols = Math.round(52 + density * 24);
  const rows = Math.max(24, Math.round((cols * h) / w));
  const cw = w / cols;
  const ch = h / rows;

  const field: number[][] = [];
  const scaleFreq = (2.2 + density * 2.0) / geoScale;
  for (let r = 0; r <= rows; r++) {
    const row: number[] = [];
    for (let c = 0; c <= cols; c++) {
      row.push(fbm2D((c / cols) * scaleFreq, (r / cols) * scaleFreq, s.seedFloat, 3));
    }
    field.push(row);
  }

  const levels = Math.round((8 + density * 10) * compMult);
  ctx.save();
  ctx.globalCompositeOperation = palette.isLight ? 'multiply' : 'screen';

  for (let l = 1; l < levels; l++) {
    const thresh = 0.22 + (l / levels) * 0.56;
    const major = l % 3 === 0;
    ctx.strokeStyle = rgb01ToCss(
      major ? palette.highlight : palette.accent,
      (major ? 0.42 : 0.18) * (0.5 + glow * 0.5)
    );
    ctx.lineWidth = Math.max(0.75, s.scale * (major ? 1.8 : 0.95) * lineScale);
    ctx.beginPath();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v0 = field[r][c];
        const v1 = field[r][c + 1];
        const v2 = field[r + 1][c + 1];
        const v3 = field[r + 1][c];

        const pts: Array<[number, number]> = [];
        const interp = (va: number, vb: number) =>
          Math.abs(vb - va) < 1e-6 ? 0.5 : (thresh - va) / (vb - va);

        if ((v0 < thresh) !== (v1 < thresh)) pts.push([(c + interp(v0, v1)) * cw, r * ch]);
        if ((v1 < thresh) !== (v2 < thresh)) pts.push([(c + 1) * cw, (r + interp(v1, v2)) * ch]);
        if ((v2 < thresh) !== (v3 < thresh)) pts.push([(c + interp(v3, v2)) * cw, (r + 1) * ch]);
        if ((v3 < thresh) !== (v0 < thresh)) pts.push([c * cw, (r + interp(v0, v3)) * ch]);

        if (pts.length >= 2) {
          ctx.moveTo(pts[0][0], pts[0][1]);
          ctx.lineTo(pts[1][0], pts[1][1]);
        }
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

// 5D. Halftone Matrix
function renderHalftoneMatrix(s: DrawState) {
  const { ctx, w, h, minDim, palette, density, glow, lineScale, geoScale } = s;
  const step = (minDim / Math.round(14 + density * 24)) * geoScale;
  const lx = Math.cos(s.comp.lightAngle);
  const ly = Math.sin(s.comp.lightAngle);

  ctx.save();
  ctx.globalCompositeOperation = palette.isLight ? 'multiply' : 'screen';

  for (let y = step * 0.5; y < h; y += step) {
    for (let x = step * 0.5; x < w; x += step) {
      const nx = x / w - s.comp.focalPoint[0];
      const ny = y / h - s.comp.focalPoint[1];
      const d = clamp(1 - Math.hypot(nx, ny) * 1.2 + (nx * lx + ny * ly) * 0.5, 0.08, 1);
      const r = step * 0.4 * d * clamp(lineScale, 0.5, 1.4);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = rgb01ToCss(palette.accent, (0.16 + d * 0.5) * (0.5 + glow * 0.5));
      ctx.fill();
    }
  }
  ctx.restore();
}

// 5E. Isometric Architecture Pattern
function renderIsometricArchitecture(s: DrawState) {
  const { ctx, w, h, minDim, rng, palette, density, glow, lineScale, geoScale } = s;
  const size = (minDim / Math.round(7 + density * 9)) * geoScale;
  const dx = size * 1.732;
  const dy = size * 1.5;
  const cos30 = 0.8660254;
  const sin30 = 0.5;

  ctx.save();
  const cols = Math.ceil(w / dx) + 2;
  const rows = Math.ceil(h / dy) + 2;

  for (let row = -1; row < rows; row++) {
    for (let col = -1; col < cols; col++) {
      const x = col * dx + (row % 2 === 0 ? 0 : dx * 0.5);
      const y = row * dy;
      const shade = 0.25 + rng() * 0.55;
      const alpha = shade * (0.3 + glow * 0.45);

      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size * cos30, y - size * sin30);
      ctx.lineTo(x, y);
      ctx.lineTo(x - size * cos30, y - size * sin30);
      ctx.closePath();
      ctx.fillStyle = rgb01ToCss(palette.accent, alpha * 0.72);
      ctx.fill();
      ctx.strokeStyle = rgb01ToCss(palette.highlight, alpha);
      ctx.lineWidth = Math.max(0.7, s.scale * 0.9 * lineScale);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x - size * cos30, y - size * sin30);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size * cos30, y + size * sin30);
      ctx.closePath();
      ctx.fillStyle = rgb01ToCss(palette.primary, alpha * 0.55);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + size * cos30, y - size * sin30);
      ctx.lineTo(x + size * cos30, y + size * sin30);
      ctx.lineTo(x, y + size);
      ctx.closePath();
      ctx.fillStyle = rgb01ToCss(palette.secondary, alpha * 0.38);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

let cachedGrainCanvas: HTMLCanvasElement | null = null;
let cachedGrainSeed = -1;

function getGrainPatternCanvas(seedInt: number): HTMLCanvasElement {
  if (cachedGrainCanvas && cachedGrainSeed === seedInt) {
    return cachedGrainCanvas;
  }
  const size = 192;
  const gc = document.createElement('canvas');
  gc.width = size;
  gc.height = size;
  const gctx = gc.getContext('2d');
  if (gctx) {
    const imgData = gctx.createImageData(size, size);
    const d = imgData.data;
    const prng = mulberry32(seedInt ^ 0x9e3779b9);
    for (let i = 0; i < d.length; i += 4) {
      const n = Math.floor((prng() + prng()) * 0.5 * 255);
      d[i] = n;
      d[i + 1] = n;
      d[i + 2] = n;
      d[i + 3] = 255;
    }
    gctx.putImageData(imgData, 0, 0);
  }
  cachedGrainCanvas = gc;
  cachedGrainSeed = seedInt;
  return gc;
}

function applyStudioPostProcessing(
  sourceCanvas: HTMLCanvasElement,
  params: TechBgParams,
  seedInt: number,
  isLight: boolean,
  isTransparent: boolean
): HTMLCanvasElement {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const sym = params.symmetry || 'none';
  const sat = params.saturation ?? 100;
  const hue = params.hueShift ?? 0;
  const bri = params.brightness ?? 100;
  const con = params.contrast ?? 100;
  const grain = clamp(params.grain ?? 0, 0, 100);
  const vignette = isTransparent ? 0 : clamp(params.vignette ?? 0, 0, 100);

  const needsSymmetry = sym !== 'none';
  const needsFilter =
    Math.abs(bri - 100) >= 1 ||
    Math.abs(con - 100) >= 1 ||
    Math.abs(sat - 100) >= 1 ||
    Math.abs(hue) >= 1;
  const needsVignette = vignette >= 1;
  const needsGrain = grain >= 1;

  if (!needsSymmetry && !needsFilter && !needsVignette && !needsGrain) {
    return sourceCanvas;
  }

  // Step 1: Symmetry transform if active
  let working = sourceCanvas;
  if (needsSymmetry) {
    const symCanvas = document.createElement('canvas');
    symCanvas.width = w;
    symCanvas.height = h;
    const sctx = symCanvas.getContext('2d');
    if (sctx) {
      const hw = Math.ceil(w / 2);
      const hh = Math.ceil(h / 2);
      if (sym === 'mirror-x') {
        sctx.drawImage(sourceCanvas, 0, 0, hw, h, 0, 0, hw, h);
        sctx.save();
        sctx.translate(w, 0);
        sctx.scale(-1, 1);
        sctx.drawImage(sourceCanvas, 0, 0, hw, h, 0, 0, hw, h);
        sctx.restore();
      } else if (sym === 'mirror-y') {
        sctx.drawImage(sourceCanvas, 0, 0, w, hh, 0, 0, w, hh);
        sctx.save();
        sctx.translate(0, h);
        sctx.scale(1, -1);
        sctx.drawImage(sourceCanvas, 0, 0, w, hh, 0, 0, w, hh);
        sctx.restore();
      } else if (sym === 'kaleido-4') {
        // Top-left quadrant mirrored into all 4 quadrants cleanly
        sctx.drawImage(sourceCanvas, 0, 0, hw, hh, 0, 0, hw, hh);
        sctx.save();
        sctx.translate(w, 0);
        sctx.scale(-1, 1);
        sctx.drawImage(sourceCanvas, 0, 0, hw, hh, 0, 0, hw, hh);
        sctx.restore();
        sctx.save();
        sctx.translate(0, h);
        sctx.scale(1, -1);
        sctx.drawImage(sourceCanvas, 0, 0, hw, hh, 0, 0, hw, hh);
        sctx.restore();
        sctx.save();
        sctx.translate(w, h);
        sctx.scale(-1, -1);
        sctx.drawImage(sourceCanvas, 0, 0, hw, hh, 0, 0, hw, hh);
        sctx.restore();
      }
      working = symCanvas;
    }
  }

  // Step 2: Color filter, vignette, and film grain
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return working;

  if (needsFilter) {
    ctx.filter = `brightness(${bri}%) contrast(${con}%) saturate(${sat}%) hue-rotate(${hue}deg)`;
  }
  ctx.drawImage(working, 0, 0);
  ctx.filter = 'none';

  if (needsVignette) {
    const strength = (vignette / 100) * 0.72;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const innerR = Math.min(w, h) * 0.25;
    const outerR = Math.hypot(w, h) * 0.54;
    const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    if (isLight) {
      grad.addColorStop(0, 'rgba(15,23,42,0)');
      grad.addColorStop(0.65, `rgba(15,23,42,${(strength * 0.25).toFixed(3)})`);
      grad.addColorStop(1, `rgba(15,23,42,${(strength * 0.65).toFixed(3)})`);
    } else {
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.62, `rgba(0,0,0,${(strength * 0.35).toFixed(3)})`);
      grad.addColorStop(1, `rgba(0,0,0,${strength.toFixed(3)})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  if (needsGrain) {
    const tile = getGrainPatternCanvas(seedInt);
    const pattern = ctx.createPattern(tile, 'repeat');
    if (pattern) {
      ctx.save();
      ctx.globalAlpha = clamp((grain / 100) * 0.2, 0.01, 0.22);
      ctx.globalCompositeOperation = isTransparent ? 'source-atop' : 'overlay';
      const tileScale = Math.max(1, Math.min(w, h) / 1100);
      if (typeof DOMMatrix !== 'undefined' && pattern.setTransform) {
        pattern.setTransform(new DOMMatrix().scale(tileScale, tileScale));
      }
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  return out;
}

// ============================================================================
// Main Render Entry Point
// ============================================================================

export interface RenderResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  aspectLabel: string;
  resolvedCategory: CoreBgCategory;
  styleName: string;
  algorithmId: BgAlgorithmId;
  conceptTitle: string;
  marketDemandInsight?: string;
  creativeRationale?: string;
  renderModeLabel: 'AI GLSL' | 'AI Canvas' | 'AI Hybrid' | 'Procedural';
  supportsTransparency: boolean;
  renderWarning?: string;
  repairedGlslCode?: string;
  repairedCanvasCode?: string;
}

export async function renderBackgroundToCanvas(
  params: TechBgParams,
  options?: {
    previewMaxEdge?: number;
    apiKey?: string;
    apiKeys?: Array<AiKeyCandidate | string>;
    activeKeyId?: string | null;
    signal?: AbortSignal;
  }
): Promise<RenderResult> {
  const { width: targetW, height: targetH, aspectLabel } = resolveTargetDimensions(params);
  let renderW = targetW;
  let renderH = targetH;

  if (options?.previewMaxEdge && Math.max(targetW, targetH) > options.previewMaxEdge) {
    const factor = options.previewMaxEdge / Math.max(targetW, targetH);
    renderW = Math.max(160, Math.round(targetW * factor));
    renderH = Math.max(160, Math.round(targetH * factor));
  }

  const seedInt = hashSeed(params.seed || 'BG-DEFAULT');
  const rng = mulberry32(seedInt);
  const seedFloat = (seedInt % 10000) / 100;

  const comp = resolveComposition(params, rng);
  const palette = resolvePalette(params, rng, params.aiBlueprint);

  const canvas = document.createElement('canvas');
  canvas.width = renderW;
  canvas.height = renderH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to acquire 2D canvas context');

  const density = clamp(params.density / 100, 0.05, 1);
  const glow = clamp(params.glowIntensity / 100, 0, 1);
  const depth = clamp(params.depth / 100, 0, 1);
  const warpVal = clamp(((params.warp ?? 45) / 100) * 1.4, 0, 1.5);
  const grainVal = clamp((params.grain ?? 0) / 100, 0, 1);
  const offsetXNorm = clamp((params.offsetX ?? 0) / 100, -1, 1);
  const offsetYNorm = clamp((params.offsetY ?? 0) / 100, -1, 1);
  const lineScale = clamp(params.lineWeight / 100, 0.4, 2.2);
  const compMult = COMPLEXITY_MULT[params.complexity];
  const useTransparent = params.transparentBackground && comp.supportsTransparency;

  const bp = params.aiBlueprint;
  const hasGlsl = Boolean(
    bp && (bp.renderMode === 'glsl' || bp.renderMode === 'hybrid') && bp.glslCode?.trim()
  );
  const hasCanvas = Boolean(
    bp && (bp.renderMode === 'canvas' || bp.renderMode === 'hybrid') && bp.canvasCode?.trim()
  );

  let dynamicRendered = false;
  let renderModeLabel: RenderResult['renderModeLabel'] = 'Procedural';
  let renderWarning: string | undefined;
  let repairedGlslCode: string | undefined;
  let repairedCanvasCode: string | undefined;

  if (bp && (hasGlsl || hasCanvas)) {
    let glslOk = !hasGlsl;
    let canvasOk = !hasCanvas;

    if (hasGlsl && bp.glslCode) {
      const uniforms = {
        seedFloat,
        baseRgb: palette.base,
        primaryRgb: palette.primary,
        secondaryRgb: palette.secondary,
        accentRgb: palette.accent,
        highlightRgb: palette.highlight,
        density,
        geometryScale: comp.geometryScale,
        rotationRad: comp.lightAngle,
        offset: [offsetXNorm, offsetYNorm] as [number, number],
        warp: warpVal,
        grain: grainVal,
        lineWeight: lineScale,
        glow,
        depth,
        isLightTheme: palette.isLight,
        transparentBackground: useTransparent,
      };

      let glslAttempt = await renderDynamicGlslToCanvas(
        ctx,
        renderW,
        renderH,
        bp.glslCode,
        uniforms,
        options?.signal
      );

      if (glslAttempt.ok === false && !options?.signal?.aborted) {
        const originalErr = glslAttempt.errorLog;
        for (let repairPass = 0; repairPass < 2 && glslAttempt.ok === false && !options?.signal?.aborted; repairPass++) {
          const currentErr = glslAttempt.errorLog;
          try {
            const repaired = await requestAiRepair({
              glslCode: bp.glslCode,
              errorLog: currentErr,
              conceptTitle: bp.conceptTitle,
              apiKey: options?.apiKey,
              apiKeys: options?.apiKeys,
              activeKeyId: options?.activeKeyId,
              signal: options?.signal,
            });
            if (repaired.glslCode?.trim()) {
              bp.glslCode = repaired.glslCode;
              glslAttempt = await renderDynamicGlslToCanvas(
                ctx,
                renderW,
                renderH,
                bp.glslCode,
                uniforms,
                options?.signal
              );
              if (glslAttempt.ok) {
                repairedGlslCode = bp.glslCode;
              }
            } else {
              break;
            }
          } catch {
            // Repair failed; try next pass or surface via renderWarning
            break;
          }
        }
        if (glslAttempt.ok === false) {
          renderWarning = `AI GLSL shader fell back to procedural (${glslAttempt.errorLog.split('\n')[0] || originalErr}).`;
        }
      }
      glslOk = glslAttempt.ok;
    }

    if (options?.signal?.aborted) {
      throw new DOMException('Render aborted', 'AbortError');
    }

    if (glslOk && hasCanvas && bp.canvasCode) {
      if (!hasGlsl) {
        if (useTransparent) {
          ctx.clearRect(0, 0, renderW, renderH);
        } else {
          ctx.fillStyle = rgb01ToCss(palette.base, 1);
          ctx.fillRect(0, 0, renderW, renderH);
        }
      }

      const hexPalette = {
        base: rgb01ToHex(palette.base),
        primary: rgb01ToHex(palette.primary),
        secondary: rgb01ToHex(palette.secondary),
        accent: rgb01ToHex(palette.accent),
        highlight: rgb01ToHex(palette.highlight),
        isLight: palette.isLight,
      };
      const rotDeg = (((Number(bp.lightAngleDeg) || 0) + params.rotation) % 360 + 360) % 360;
      const canvasInput = {
        ctx,
        w: renderW,
        h: renderH,
        seedFloat,
        rng,
        density,
        scale: comp.geometryScale,
        rotationDeg: rotDeg,
        rotationRad: comp.lightAngle,
        offsetX: offsetXNorm,
        offsetY: offsetYNorm,
        warp: warpVal,
        grain: grainVal,
        lineWeight: lineScale,
        glow,
        depth,
        transparent: useTransparent,
        palette: hexPalette,
      };

      let canvasAttempt = executeDynamicCanvasCode(bp.canvasCode, canvasInput);

      if (canvasAttempt.ok === false && !options?.signal?.aborted) {
        const originalErr = canvasAttempt.errorMsg;
        try {
          const repaired = await requestAiRepair({
            canvasCode: bp.canvasCode,
            errorLog: originalErr,
            conceptTitle: bp.conceptTitle,
            apiKey: options?.apiKey,
            apiKeys: options?.apiKeys,
            activeKeyId: options?.activeKeyId,
            signal: options?.signal,
          });
          if (repaired.canvasCode?.trim()) {
            bp.canvasCode = repaired.canvasCode;
            if (hasGlsl && bp.glslCode) {
              ctx.clearRect(0, 0, renderW, renderH);
              await renderDynamicGlslToCanvas(
                ctx,
                renderW,
                renderH,
                bp.glslCode,
                {
                  seedFloat,
                  baseRgb: palette.base,
                  primaryRgb: palette.primary,
                  secondaryRgb: palette.secondary,
                  accentRgb: palette.accent,
                  highlightRgb: palette.highlight,
                  density,
                  geometryScale: comp.geometryScale,
                  rotationRad: comp.lightAngle,
                  offset: [offsetXNorm, offsetYNorm],
                  warp: warpVal,
                  grain: grainVal,
                  lineWeight: lineScale,
                  glow,
                  depth,
                  isLightTheme: palette.isLight,
                  transparentBackground: useTransparent,
                },
                options?.signal
              );
            } else {
              if (useTransparent) ctx.clearRect(0, 0, renderW, renderH);
              else {
                ctx.fillStyle = rgb01ToCss(palette.base, 1);
                ctx.fillRect(0, 0, renderW, renderH);
              }
            }
            canvasAttempt = executeDynamicCanvasCode(bp.canvasCode, canvasInput);
            if (canvasAttempt.ok) {
              repairedCanvasCode = bp.canvasCode;
            }
          }
        } catch {
          // Repair failed; surfaced via renderWarning below
        }
        if (canvasAttempt.ok === false) {
          renderWarning = `AI Canvas script fell back to procedural (${canvasAttempt.errorMsg}).`;
        }
      }
      canvasOk = canvasAttempt.ok;
    }

    if (glslOk && canvasOk) {
      dynamicRendered = true;
      renderModeLabel =
        hasGlsl && hasCanvas ? 'AI Hybrid' : hasGlsl ? 'AI GLSL' : 'AI Canvas';
    }
  }

  if (!dynamicRendered) {
    // Fallback procedural renderer (when AI Director is off or custom shader failed)
    ctx.clearRect(0, 0, renderW, renderH);
    await renderWebGLFieldToCanvas(
      ctx,
      renderW,
      renderH,
      {
        style: comp.shaderStyle,
        seedFloat,
        baseRgb: palette.base,
        primaryRgb: palette.primary,
        secondaryRgb: palette.secondary,
        accentRgb: palette.accent,
        highlightRgb: palette.highlight,
        focalPoint: comp.focalPoint,
        lightAngle: comp.lightAngle,
        density,
        glow,
        depth,
        lineWeight: lineScale,
        isLightTheme: palette.isLight,
        transparentBackground: useTransparent,
        geometryScale: comp.geometryScale,
      },
      options?.signal
    );

    if (options?.signal?.aborted) {
      throw new DOMException('Render aborted', 'AbortError');
    }

    const minDim = Math.min(renderW, renderH);
    const state: DrawState = {
      ctx,
      w: renderW,
      h: renderH,
      minDim,
      scale: minDim / 1000,
      lineScale,
      geoScale: comp.geometryScale,
      rng,
      palette,
      comp,
      density,
      glow,
      depth,
      compMult,
      seedFloat,
      transparent: useTransparent,
    };

    switch (comp.algorithmId) {
      case 'circuit-board':
        renderCircuitBoard(state);
        break;
      case 'network-nodes':
        renderNetworkNodes(state);
        break;
      case 'digital-grid':
        renderDigitalGrid(state);
        break;
      case 'data-matrix':
        renderDataMatrix(state);
        break;
      case 'geometric-patterns':
        renderTriangulatedMesh(state, false);
        break;
      case 'low-poly':
        renderTriangulatedMesh(state, true);
        break;
      case 'voronoi-patterns':
        break;
      case 'concentric-patterns':
        renderConcentricPatterns(state);
        break;
      case '3d-spheres':
      case '3d-torus':
      case 'liquid-chrome':
        break;
      case '3d-structures':
        render3DStructures(state);
        break;
      case 'fractal-art':
      case 'noise-patterns':
        break;
      case 'parametric-curves':
        renderParametricCurves(state);
        break;
      case 'moire-patterns':
        renderMoirePatterns(state);
        break;
      case 'particle-field':
        renderParticleField(state);
        break;
      case 'light-rays':
        renderLightRays(state);
        break;
      case 'flow-waves':
        renderFlowWaves(state);
        break;
      case 'light-trails':
        renderLightTrails(state);
        break;
      case 'topographic-elevation':
        renderTopographicElevation(state);
        break;
      case 'halftone-matrix':
        renderHalftoneMatrix(state);
        break;
      case 'isometric-architecture':
        renderIsometricArchitecture(state);
        break;
    }
  }

  if (Math.max(renderW, renderH) > 2000) {
    await yieldFrame();
  }

  const finalCanvas = applyStudioPostProcessing(
    canvas,
    params,
    seedInt,
    palette.isLight,
    useTransparent
  );

  return {
    canvas: finalCanvas,
    width: targetW,
    height: targetH,
    aspectLabel,
    resolvedCategory: comp.resolvedCategory,
    styleName: comp.styleName,
    algorithmId: comp.algorithmId,
    conceptTitle: comp.conceptTitle,
    marketDemandInsight: comp.marketDemandInsight,
    creativeRationale: comp.creativeRationale,
    renderModeLabel,
    supportsTransparency: comp.supportsTransparency,
    renderWarning,
    repairedGlslCode,
    repairedCanvasCode,
  };
}

export async function canvasToBlobAsync(
  canvas: HTMLCanvasElement,
  format: 'png' | 'jpeg' | 'webp',
  qualityPct: number
): Promise<Blob> {
  const mime =
    format === 'png'
      ? 'image/png'
      : format === 'webp'
        ? 'image/webp'
        : 'image/jpeg';
  const q = format === 'png' ? undefined : clamp(qualityPct / 100, 0.1, 1);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Failed to encode ${format.toUpperCase()} file.`));
      },
      mime,
      q
    );
  });
}

export function createRandomParamVariation(current: TechBgParams): TechBgParams {
  const colorChoices: ColorStyleOption[] = [
    'Random / AI-Curated',
    'Blue & Cyan',
    'Purple & Violet',
    'Black & Gold',
    'Neon',
    'Monochrome',
    'Dark',
    'Light',
  ];
  const complexities: ComplexityLevel[] = ['Minimal', 'Balanced', 'Detailed', 'Ultra Detailed'];

  return {
    ...current,
    colorStyle: colorChoices[Math.floor(Math.random() * colorChoices.length)],
    complexity: complexities[Math.floor(Math.random() * complexities.length)],
    seed: current.seedLocked ? current.seed : generateRandomSeed(),
    density: Math.round(35 + Math.random() * 55),
    scale: Math.round(75 + Math.random() * 55),
    rotation: Math.round(Math.random() * 360),
    offsetX: 0,
    offsetY: 0,
    warp: Math.round(25 + Math.random() * 60),
    lineWeight: Math.round(75 + Math.random() * 60),
    symmetry: 'none',
    glowIntensity: Math.round(35 + Math.random() * 55),
    depth: Math.round(45 + Math.random() * 50),
    saturation: 105,
    hueShift: 0,
    contrast: Math.round(98 + Math.random() * 18),
    brightness: Math.round(96 + Math.random() * 10),
    grain: Math.round(6 + Math.random() * 18),
    vignette: Math.round(12 + Math.random() * 25),
    useCustomBaseColor: false,
    aiBlueprint: undefined,
  };
}
