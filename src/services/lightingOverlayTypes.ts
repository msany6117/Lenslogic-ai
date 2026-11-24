export type OverlayLayerType =
  | 'radial-glow'
  | 'sunburst-rays'
  | 'anamorphic-flare'
  | 'god-rays'
  | 'light-leak'
  | 'prism-spectrum'
  | 'lightning-arc'
  | 'bokeh-field'
  | 'spark-swirl'
  | 'laser-beams';

export type OverlayCategory =
  | 'all-random'
  | 'anamorphic-flare'
  | 'god-rays'
  | 'sunburst-rays'
  | 'light-leak'
  | 'prism-spectrum'
  | 'lightning-arc'
  | 'bokeh-field'
  | 'spark-swirl'
  | 'laser-beams'
  | 'radial-glow';

export type OverlayAspectRatio =
  | '16:9'
  | '9:16'
  | '1:1'
  | '4:3'
  | '3:2'
  | '2:3'
  | '4:5'
  | '21:9'
  | 'Custom';

export type OverlayResolutionPreset = '4K' | '6K' | '8K' | 'Custom';
export type OverlayExportFormat = 'png' | 'jpeg' | 'webp';
export type OverlayBackgroundMode = 'black' | 'transparent';
export type OverlayPreviewBackdrop = 'auto' | 'checkerboard' | 'black' | 'charcoal';

export interface OverlayLayerConfig {
  id: string;
  type: OverlayLayerType;
  name: string;
  enabled: boolean;
  blendMode: 'lighter' | 'screen' | 'normal';
  opacity: number; // 0..100
  x: number; // -0.25..1.25 normalized
  y: number; // -0.25..1.25 normalized
  angle: number; // 0..360 deg
  scale: number; // 15..300 %
  stretchX: number; // 25..400 %
  stretchY: number; // 25..400 %
  spread: number; // 5..100 %
  count: number; // 1..120 (rays, ghosts, bolts, bokeh, particles)
  sharpness: number; // 0..100 %
  chaos: number; // 0..100 % (forking, organic noise, irregularity)
  dispersion: number; // 0..100 % (rainbow prism / chromatic split)
  softness: number; // 5..100 %
  apertureBlades: 0 | 5 | 6 | 8; // 0 = circle, 5/6/8 = polygon bokeh/ghosts
  colorPrimary: string;
  colorSecondary: string;
  colorCore: string;
  seed: number;
}

export interface LightingOverlayDoc {
  title: string;
  category: OverlayCategory;
  backgroundMode: OverlayBackgroundMode;
  previewBackdrop: OverlayPreviewBackdrop;
  aspectRatio: OverlayAspectRatio;
  customRatioW: number;
  customRatioH: number;
  resolutionPreset: OverlayResolutionPreset;
  customWidth: number;
  customHeight: number;
  masterExposure: number; // 40..200 %
  masterContrast: number; // 60..160 %
  masterSaturation: number; // 0..200 %
  temperature: number; // -100..+100 (cool..warm)
  chromaticAberration: number; // 0..100 %
  edgeFade: number; // 0..100 %
  grain: number; // 0..60 %
  globalSeed: string;
  layers: OverlayLayerConfig[];
}

export interface SavedOverlayItem {
  id: string;
  createdAt: number;
  previewUrl: string;
  doc: LightingOverlayDoc;
  width: number;
  height: number;
  favorite: boolean;
}

export const OVERLAY_CATEGORY_OPTIONS: Array<{ id: OverlayCategory; label: string }> = [
  { id: 'all-random', label: 'Surprise Mix' },
  { id: 'anamorphic-flare', label: 'Lens Flare' },
  { id: 'god-rays', label: 'God Rays' },
  { id: 'sunburst-rays', label: 'Sunburst' },
  { id: 'light-leak', label: 'Light Leaks' },
  { id: 'prism-spectrum', label: 'Prism Rainbow' },
  { id: 'lightning-arc', label: 'Lightning' },
  { id: 'bokeh-field', label: 'Bokeh & Dust' },
  { id: 'spark-swirl', label: 'Spark Swirl' },
  { id: 'laser-beams', label: 'Laser Beams' },
  { id: 'radial-glow', label: 'Soft Glow' },
];

export const OVERLAY_LAYER_TYPE_OPTIONS: Array<{ id: OverlayLayerType; label: string }> = [
  { id: 'anamorphic-flare', label: 'Anamorphic Lens Flare' },
  { id: 'sunburst-rays', label: 'Sunburst & Star Rays' },
  { id: 'god-rays', label: 'Volumetric God Rays' },
  { id: 'light-leak', label: 'Film Light Leak' },
  { id: 'prism-spectrum', label: 'Prism Rainbow Dispersion' },
  { id: 'lightning-arc', label: 'Lightning & Plasma Arc' },
  { id: 'bokeh-field', label: 'Bokeh Orbs & Dust' },
  { id: 'spark-swirl', label: 'Golden Spark Swirl' },
  { id: 'laser-beams', label: 'Stage Laser Beams' },
  { id: 'radial-glow', label: 'Soft Radial Ambient Glow' },
];

export const OVERLAY_ASPECT_RATIOS: OverlayAspectRatio[] = [
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '3:2',
  '2:3',
  '4:5',
  '21:9',
  'Custom',
];

export const OVERLAY_RESOLUTION_TABLE: Record<
  Exclude<OverlayAspectRatio, 'Custom'>,
  { '4K': [number, number]; '6K': [number, number]; '8K': [number, number] }
> = {
  '16:9': { '4K': [3840, 2160], '6K': [6144, 3456], '8K': [7680, 4320] },
  '9:16': { '4K': [2160, 3840], '6K': [3456, 6144], '8K': [4320, 7680] },
  '1:1': { '4K': [3840, 3840], '6K': [6144, 6144], '8K': [7680, 7680] },
  '4:3': { '4K': [3840, 2880], '6K': [6144, 4608], '8K': [7680, 5760] },
  '3:2': { '4K': [3840, 2560], '6K': [6144, 4096], '8K': [7680, 5120] },
  '2:3': { '4K': [2560, 3840], '6K': [4096, 6144], '8K': [5120, 7680] },
  '4:5': { '4K': [3072, 3840], '6K': [4915, 6144], '8K': [6144, 7680] },
  '21:9': { '4K': [5040, 2160], '6K': [6720, 2880], '8K': [10080, 4320] },
};

export function resolveOverlayDimensions(doc: LightingOverlayDoc): {
  width: number;
  height: number;
  aspectLabel: string;
} {
  if (doc.resolutionPreset === 'Custom') {
    const w = Math.max(320, Math.min(12000, Math.round(doc.customWidth || 3840)));
    const h = Math.max(320, Math.min(12000, Math.round(doc.customHeight || 2160)));
    const aspectLabel =
      doc.aspectRatio === 'Custom'
        ? `${Math.max(1, Math.round(doc.customRatioW))}:${Math.max(1, Math.round(doc.customRatioH))}`
        : doc.aspectRatio;
    return { width: w, height: h, aspectLabel };
  }

  if (doc.aspectRatio !== 'Custom') {
    const [width, height] = OVERLAY_RESOLUTION_TABLE[doc.aspectRatio][doc.resolutionPreset];
    return { width, height, aspectLabel: doc.aspectRatio };
  }

  const rw = Math.max(1, doc.customRatioW || 16);
  const rh = Math.max(1, doc.customRatioH || 9);
  const longEdge =
    doc.resolutionPreset === '8K' ? 7680 : doc.resolutionPreset === '6K' ? 6144 : 3840;
  let width: number;
  let height: number;
  if (rw >= rh) {
    width = longEdge;
    height = Math.max(320, Math.round((longEdge * rh) / rw));
  } else {
    height = longEdge;
    width = Math.max(320, Math.round((longEdge * rw) / rh));
  }
  return {
    width: Math.min(12000, width),
    height: Math.min(12000, height),
    aspectLabel: `${Math.round(rw)}:${Math.round(rh)}`,
  };
}

export function makeOverlayLayerId(): string {
  return `lyr_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultLayer(type: OverlayLayerType, seedNum?: number): OverlayLayerConfig {
  const s = seedNum ?? Math.floor(1000 + Math.random() * 89999);
  const base: OverlayLayerConfig = {
    id: makeOverlayLayerId(),
    type,
    name: OVERLAY_LAYER_TYPE_OPTIONS.find((o) => o.id === type)?.label || 'Light Layer',
    enabled: true,
    blendMode: 'lighter',
    opacity: 92,
    x: 0.5,
    y: 0.5,
    angle: 0,
    scale: 100,
    stretchX: 100,
    stretchY: 100,
    spread: 55,
    count: 18,
    sharpness: 65,
    chaos: 40,
    dispersion: 30,
    softness: 55,
    apertureBlades: 6,
    colorPrimary: '#ff9d2e',
    colorSecondary: '#ff521b',
    colorCore: '#fff6e0',
    seed: s,
  };

  switch (type) {
    case 'anamorphic-flare':
      return {
        ...base,
        name: 'Anamorphic Flare',
        x: 0.36,
        y: 0.44,
        angle: -8,
        scale: 110,
        stretchX: 220,
        stretchY: 85,
        count: 14,
        sharpness: 75,
        dispersion: 35,
        colorPrimary: '#ffb347',
        colorSecondary: '#2d7dff',
        colorCore: '#ffffff',
      };
    case 'god-rays':
      return {
        ...base,
        name: 'Volumetric God Rays',
        x: 0.5,
        y: -0.05,
        angle: 90,
        scale: 145,
        spread: 62,
        count: 26,
        sharpness: 48,
        chaos: 45,
        softness: 72,
        colorPrimary: '#e2ecff',
        colorSecondary: '#7ba7ff',
        colorCore: '#ffffff',
      };
    case 'sunburst-rays':
      return {
        ...base,
        name: 'Sunburst Rays',
        x: 0.5,
        y: 0.5,
        angle: 12,
        scale: 125,
        spread: 60,
        count: 42,
        sharpness: 78,
        chaos: 50,
        colorPrimary: '#ffae2b',
        colorSecondary: '#ff4f0f',
        colorCore: '#fff9e6',
      };
    case 'light-leak':
      return {
        ...base,
        name: 'Film Light Leak',
        x: 0.14,
        y: 0.18,
        angle: 28,
        scale: 165,
        stretchX: 140,
        stretchY: 165,
        spread: 75,
        count: 6,
        chaos: 55,
        softness: 88,
        colorPrimary: '#ff6a1a',
        colorSecondary: '#ff1744',
        colorCore: '#ffd480',
      };
    case 'prism-spectrum':
      return {
        ...base,
        name: 'Prism Rainbow Dispersion',
        x: 0.58,
        y: 0.45,
        angle: -34,
        scale: 135,
        stretchX: 160,
        stretchY: 120,
        spread: 58,
        count: 12,
        dispersion: 95,
        softness: 68,
        colorPrimary: '#00e5ff',
        colorSecondary: '#ff2a85',
        colorCore: '#fff4d2',
      };
    case 'lightning-arc':
      return {
        ...base,
        name: 'Lightning Arc',
        x: 0.52,
        y: 0.04,
        angle: 95,
        scale: 120,
        spread: 52,
        count: 22,
        sharpness: 84,
        chaos: 68,
        softness: 42,
        colorPrimary: '#4fc3ff',
        colorSecondary: '#2962ff',
        colorCore: '#ffffff',
      };
    case 'bokeh-field':
      return {
        ...base,
        name: 'Bokeh Orbs & Dust',
        x: 0.5,
        y: 0.5,
        angle: 15,
        scale: 115,
        spread: 85,
        count: 55,
        sharpness: 52,
        chaos: 65,
        softness: 64,
        apertureBlades: 0,
        colorPrimary: '#ffb84d',
        colorSecondary: '#ff5e57',
        colorCore: '#fff3d6',
      };
    case 'spark-swirl':
      return {
        ...base,
        name: 'Golden Spark Swirl',
        x: 0.5,
        y: 0.5,
        angle: -20,
        scale: 120,
        spread: 68,
        count: 48,
        sharpness: 74,
        chaos: 60,
        softness: 48,
        colorPrimary: '#ffaa2b',
        colorSecondary: '#ff5500',
        colorCore: '#fff6d6',
      };
    case 'laser-beams':
      return {
        ...base,
        name: 'Stage Laser Beams',
        x: 0.5,
        y: 0.1,
        angle: 90,
        scale: 135,
        spread: 70,
        count: 14,
        sharpness: 85,
        chaos: 28,
        softness: 45,
        colorPrimary: '#d500f9',
        colorSecondary: '#00e5ff',
        colorCore: '#ffffff',
      };
    case 'radial-glow':
    default:
      return {
        ...base,
        name: 'Soft Ambient Glow',
        x: 0.5,
        y: 0.5,
        scale: 135,
        spread: 72,
        softness: 92,
        colorPrimary: '#ffe14d',
        colorSecondary: '#ff7b00',
        colorCore: '#ffffff',
      };
  }
}

export function cloneOverlayDoc(doc: LightingOverlayDoc): LightingOverlayDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) => ({ ...l })),
  };
}
