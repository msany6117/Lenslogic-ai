import type { ApiKeyEntry } from '../types';
import {
  AiBlueprint,
  AspectRatioOption,
  DEFAULT_TECH_BG_PARAMS,
  ExportFormat,
  ReferenceImagePayload,
  ResolutionPreset,
  StockQualityReport,
  SymmetryMode,
  TechBgParams,
} from './techBgTypes';
import {
  canvasToBlobAsync,
  generateRandomSeed,
  renderBackgroundToCanvas,
  requestAiRepair,
} from './techBgEngine';
import { validateDynamicGlslCompile } from './techBgDynamicShaders';
import { analyzeStockQuality } from './techBgQuality';

export type ForgeFidelityMode = 'exact-elevated' | 'fusion' | 'rare-evolution';

export interface ForgeBlueprint extends AiBlueprint {
  referenceForensics?: string;
  rareTechnique?: string;
  uniquenessNote?: string;
}

export interface ForgeMeta {
  model: string;
  keyIndexUsed: number;
  userKeyCount: number;
  poolSize: number;
}

export interface ForgeVaultItem {
  id: string;
  createdAt: number;
  previewUrl: string;
  blueprint: ForgeBlueprint;
  params: TechBgParams;
  width: number;
  height: number;
  aspectLabel: string;
  favorite: boolean;
  qualityReport?: StockQualityReport;
}

export interface LiveTuningValues {
  density: number;
  scale: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  warp: number;
  lineWeight: number;
  symmetry: SymmetryMode;
  glowIntensity: number;
  depth: number;
  contrast: number;
  brightness: number;
  saturation: number;
  hueShift: number;
  grain: number;
  vignette: number;
  transparentBackground: boolean;
}

const LEDGER_STORAGE_KEY = 'ai_bg_forge_rarity_ledger_v1';
let sessionRotationCounter = 0;

export function getOrderedUserGeminiKeys(
  apiKeys: ApiKeyEntry[] | undefined,
  activeKeyId: string | null | undefined
): { keys: string[]; labels: string[] } {
  const valid = (apiKeys || []).filter(
    (k) => k.provider === 'Gemini' && typeof k.key === 'string' && k.key.trim().length > 8
  );
  if (valid.length === 0) return { keys: [], labels: [] };

  const activeIdx = activeKeyId ? valid.findIndex((k) => k.id === activeKeyId) : -1;
  const ordered =
    activeIdx > 0
      ? [valid[activeIdx], ...valid.slice(0, activeIdx), ...valid.slice(activeIdx + 1)]
      : valid;

  const seen = new Set<string>();
  const keys: string[] = [];
  const labels: string[] = [];
  for (const entry of ordered) {
    const trimmed = entry.key.trim();
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      keys.push(trimmed);
      labels.push(entry.label || 'Gemini Key');
    }
  }
  return { keys, labels };
}

export function loadRarityLedger(): string[] {
  try {
    const raw = localStorage.getItem(LEDGER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function recordToRarityLedger(blueprints: ForgeBlueprint[]): string[] {
  const current = loadRarityLedger();
  const additions = blueprints
    .map((bp) => {
      const tech = bp.rareTechnique?.trim();
      const title = bp.conceptTitle?.trim();
      return tech && title ? `${title} (${tech})` : tech || title || '';
    })
    .filter(Boolean);

  const merged = Array.from(new Set([...current, ...additions])).slice(-24);
  try {
    localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Ignore storage quota errors
  }
  return merged;
}

export async function fileToForgeReference(file: File): Promise<ReferenceImagePayload> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not read reference image file.'));
      el.src = objectUrl;
    });
    const maxEdge = 896;
    const scale = Math.min(1, maxEdge / Math.max(1, img.width, img.height));
    const w = Math.max(64, Math.round(img.width * scale));
    const h = Math.max(64, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable for reference image.');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    const commaIdx = dataUrl.indexOf(',');
    const data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    return {
      mimeType: 'image/jpeg',
      data,
      previewUrl: dataUrl,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function forgeRareBackgrounds(options: {
  prompt: string;
  referenceImage?: ReferenceImagePayload | null;
  fidelityMode: ForgeFidelityMode;
  aspectLabel: string;
  count: number;
  apiKeys: string[];
  previousBlueprint?: ForgeBlueprint;
  refineInstruction?: string;
  signal?: AbortSignal;
}): Promise<{ blueprints: ForgeBlueprint[]; meta?: ForgeMeta }> {
  const avoidTechniques = loadRarityLedger();
  const keyOffset =
    options.apiKeys.length > 0 ? sessionRotationCounter++ % options.apiKeys.length : 0;

  const response = await fetch('/api/ai-bg/forge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      prompt: options.prompt,
      referenceImage: options.referenceImage
        ? {
            mimeType: options.referenceImage.mimeType,
            data: options.referenceImage.data,
          }
        : undefined,
      fidelityMode: options.fidelityMode,
      aspectLabel: options.aspectLabel,
      count: options.count,
      avoidTechniques,
      previousBlueprint: options.previousBlueprint,
      refineInstruction: options.refineInstruction,
      apiKeys: options.apiKeys,
      keyStartOffset: keyOffset,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Generation failed (${response.status})`);
  }

  const list = Array.isArray(data?.blueprints) ? (data.blueprints as ForgeBlueprint[]) : [];
  if (list.length === 0) {
    throw new Error('No procedural background was returned.');
  }

  // Automatic pre-stage WebGL2 compile check + /api/bg/repair loop across user's key pool
  if (typeof document !== 'undefined') {
    for (const bp of list) {
      if (
        (bp.renderMode === 'glsl' || bp.renderMode === 'hybrid') &&
        bp.glslCode?.trim() &&
        !options.signal?.aborted
      ) {
        let check = validateDynamicGlslCompile(bp.glslCode);
        for (
          let attempt = 0;
          attempt < 2 && check.ok === false && !options.signal?.aborted;
          attempt++
        ) {
          if (check.errorLog.includes('WebGL2 is unavailable')) break;
          try {
            const repaired = await requestAiRepair({
              glslCode: bp.glslCode,
              errorLog: check.errorLog,
              conceptTitle: bp.conceptTitle,
              apiKey: options.apiKeys[0],
              apiKeys: options.apiKeys,
              signal: options.signal,
            });
            if (repaired.glslCode?.trim()) {
              bp.glslCode = repaired.glslCode;
              check = validateDynamicGlslCompile(bp.glslCode);
            } else {
              break;
            }
          } catch {
            break;
          }
        }
      }
    }
  }

  recordToRarityLedger(list);
  return { blueprints: list, meta: data?.meta as ForgeMeta | undefined };
}

export function forgeBlueprintToRenderParams(
  blueprint: ForgeBlueprint,
  options: LiveTuningValues & {
    aspectRatio: AspectRatioOption;
    resolutionPreset: ResolutionPreset;
    seed: string;
    customBaseColor?: string;
    customPalette?: {
      primary: string;
      secondary: string;
      accent: string;
      highlight: string;
    };
  }
): TechBgParams {
  const validHex = (h: unknown, fallback: string) =>
    typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h.trim()) ? h.trim() : fallback;

  const resolvedBase = validHex(options.customBaseColor, validHex(blueprint.paletteBase, '#070b14'));
  const resolvedPalette = options.customPalette
    ? { ...options.customPalette }
    : {
        primary: validHex(blueprint.palettePrimary, '#1e3a8a'),
        secondary: validHex(blueprint.paletteSecondary, '#0284c7'),
        accent: validHex(blueprint.paletteAccent, '#38bdf8'),
        highlight: validHex(blueprint.paletteHighlight, '#f0f9ff'),
      };

  return {
    ...DEFAULT_TECH_BG_PARAMS,
    category: blueprint.resolvedCategory || 'Background Generator',
    styleSelection: 'ai-invention',
    useAiDirector: true,
    aspectRatio: options.aspectRatio,
    resolutionPreset: options.resolutionPreset,
    colorStyle: 'Custom Palette',
    baseColor: resolvedBase,
    useCustomBaseColor: true,
    customPalette: resolvedPalette,
    seed: options.seed || generateRandomSeed(),
    seedLocked: false,
    density: options.density,
    scale: options.scale,
    rotation: options.rotation,
    offsetX: options.offsetX,
    offsetY: options.offsetY,
    warp: options.warp,
    lineWeight: options.lineWeight,
    symmetry: options.symmetry,
    glowIntensity: options.glowIntensity,
    depth: options.depth,
    saturation: options.saturation,
    hueShift: options.hueShift,
    contrast: options.contrast,
    brightness: options.brightness,
    grain: options.grain,
    vignette: options.vignette,
    transparentBackground: Boolean(options.transparentBackground && blueprint.supportsTransparency),
    aiBlueprint: blueprint,
  };
}

export async function renderForgeStage(
  blueprint: ForgeBlueprint,
  params: TechBgParams,
  previewMaxEdge: number,
  apiKeys?: string | string[],
  signal?: AbortSignal,
  skipQualityCheck = false
): Promise<{
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  aspectLabel: string;
  renderModeLabel: string;
  renderWarning?: string;
  repairedGlslCode?: string;
  repairedCanvasCode?: string;
  qualityReport?: StockQualityReport;
}> {
  const keyList = Array.isArray(apiKeys) ? apiKeys : apiKeys ? [apiKeys] : [];
  const res = await renderBackgroundToCanvas(
    { ...params, aiBlueprint: blueprint },
    {
      previewMaxEdge,
      apiKey: keyList[0],
      apiKeys: keyList,
      signal,
    }
  );

  const qualityReport = skipQualityCheck
    ? undefined
    : analyzeStockQuality(res.canvas, res.width, res.height, params.transparentBackground);

  return {
    canvas: res.canvas,
    width: res.width,
    height: res.height,
    aspectLabel: res.aspectLabel,
    renderModeLabel: res.renderModeLabel,
    renderWarning: res.renderWarning,
    repairedGlslCode: res.repairedGlslCode,
    repairedCanvasCode: res.repairedCanvasCode,
    qualityReport,
  };
}

export async function exportForgeFullResolution(
  params: TechBgParams,
  format: ExportFormat,
  quality: number,
  apiKeys?: string | string[],
  signal?: AbortSignal
): Promise<{ blob: Blob; width: number; height: number; aspectLabel: string }> {
  const keyList = Array.isArray(apiKeys) ? apiKeys : apiKeys ? [apiKeys] : [];
  const res = await renderBackgroundToCanvas(params, {
    apiKey: keyList[0],
    apiKeys: keyList,
    signal,
  });
  const blob = await canvasToBlobAsync(res.canvas, format, quality);
  return { blob, width: res.width, height: res.height, aspectLabel: res.aspectLabel };
}
