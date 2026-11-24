export interface BgStyleDefinition {
  id: string;
  name: string;
  description: string;
  preferredRenderMode: 'glsl' | 'canvas' | 'hybrid';
  supportsTransparency: boolean;
}

export interface BgCategoryDefinition {
  id: string;
  name: string;
  marketFocus: string;
  styles: BgStyleDefinition[];
}

export const BG_TAXONOMY: BgCategoryDefinition[] = [
  {
    id: 'tech-digital-cyber',
    name: 'Technology, Digital & Cyber',
    marketFocus: 'SaaS landing pages, AI/ML startups, cybersecurity decks, fintech hero sections',
    styles: [
      {
        id: 'circuit-board-microchip',
        name: 'Circuit Board & Microchip Patterns',
        description: 'Circuit traces, vias, pads, and microchip architecture',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'digital-networks-nodes',
        name: 'Digital Networks & Connected Nodes',
        description: 'Network graphs, constellation node connections, and data routes',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'futuristic-grids-horizons',
        name: 'Futuristic Grids & Perspective Horizons',
        description: 'Vanishing-point grids, horizon lines, and digital spatial depth',
        preferredRenderMode: 'hybrid',
        supportsTransparency: true,
      },
      {
        id: 'data-flows-particle-streams',
        name: 'Data Flows & Particle Streams',
        description: 'High-speed data streams, glowing flow lines, and particle movement',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'wireframes-holographic',
        name: 'Wireframes & Holographic Layouts',
        description: 'Wireframe meshes, telemetry scanlines, and holographic grids',
        preferredRenderMode: 'hybrid',
        supportsTransparency: true,
      },
      {
        id: 'cyber-security-matrix',
        name: 'Cyber Security & Matrix Streams',
        description: 'Code matrices, cryptographic shield structures, and digital signals',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'ai-neural-topology',
        name: 'AI & Neural Topology',
        description: 'Neural layer topologies, synaptic pulses, and computational graphs',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
    ],
  },
  {
    id: '3d-procedural-shader',
    name: '3D Procedural & Shader Art',
    marketFocus: 'Luxury branding, product launch visuals, modern UI backdrops, poster art',
    styles: [
      {
        id: 'liquid-chrome-metallic',
        name: 'Liquid Chrome & Metallic Surfaces',
        description: 'Liquid metal ripples, studio chrome reflections, and high-contrast highlights',
        preferredRenderMode: 'glsl',
        supportsTransparency: false,
      },
      {
        id: '3d-spheres-torus-forms',
        name: '3D Spheres, Torus & Geometric Forms',
        description: 'Sculptural metallic spheres, ribbed torus rings, and geometric volumes',
        preferredRenderMode: 'glsl',
        supportsTransparency: true,
      },
      {
        id: 'frosted-glass-refraction',
        name: 'Frosted Glass & Refraction Effects',
        description: 'Frosted fluted glass panels, optical refraction, dispersion, and soft shadows',
        preferredRenderMode: 'glsl',
        supportsTransparency: false,
      },
      {
        id: '3d-isometric-architectural',
        name: '3D Isometric & Architectural Blocks',
        description: 'Isometric cubes, extruded block clusters, and sunlit architectural monoliths',
        preferredRenderMode: 'canvas',
        supportsTransparency: false,
      },
      {
        id: 'volumetric-lighting-rays',
        name: 'Volumetric Lighting & Light Rays',
        description: 'God-rays, volumetric beams, prism shafts, and atmospheric light scattering',
        preferredRenderMode: 'glsl',
        supportsTransparency: true,
      },
      {
        id: '3d-terrain-elevation-mesh',
        name: '3D Terrain & Elevation Mesh',
        description: 'Perspective topographical terrain wireframes and shaded ridge landscapes',
        preferredRenderMode: 'hybrid',
        supportsTransparency: true,
      },
    ],
  },
  {
    id: 'abstract-geometric',
    name: 'Abstract & Geometric Art',
    marketFocus: 'Editorial covers, conference banners, modern corporate packaging, posters',
    styles: [
      {
        id: 'low-poly-polygon',
        name: 'Low-Poly & Polygon Compositions',
        description: 'Triangulated faceted meshes, crystalline planes, and angular geometry',
        preferredRenderMode: 'canvas',
        supportsTransparency: false,
      },
      {
        id: 'voronoi-cellular',
        name: 'Voronoi & Cellular Patterns',
        description: 'Crisp Voronoi tessellations, organic cells, stained glass, and crystal fissures',
        preferredRenderMode: 'glsl',
        supportsTransparency: true,
      },
      {
        id: 'tessellations-repeating',
        name: 'Tessellations & Repeating Geometry',
        description: 'Interlocking hexagons, Penrose/diamond tiles, and rhythmic symmetry',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'moire-interference',
        name: 'Moiré Interference & Optical Illusions',
        description: 'Overlapping wave interference lattices and hypnotic optical depth',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'minimalist-bauhaus',
        name: 'Minimalist Bauhaus & Modern Shapes',
        description: 'Crisp geometric arcs, balanced blocks, primary balance, and negative space',
        preferredRenderMode: 'canvas',
        supportsTransparency: false,
      },
      {
        id: 'abstract-ribbons-swirls',
        name: 'Abstract Ribbons & Layered Swirls',
        description: 'Sculpted flowing ribbons, layered silk folds, and overlapping curves',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
    ],
  },
  {
    id: 'mathematical-algorithmic',
    name: 'Mathematical & Algorithmic Generative Art',
    marketFocus: 'Fine art prints, creative tech branding, album covers, generative exhibitions',
    styles: [
      {
        id: 'fractals-self-similar',
        name: 'Fractals & Self-Similar Structures',
        description: 'Julia/Mandelbrot zooms, Sierpinski recursion, and self-similar spirals',
        preferredRenderMode: 'glsl',
        supportsTransparency: false,
      },
      {
        id: 'perlin-simplex-noise',
        name: 'Perlin & Simplex Noise Fields',
        description: 'Smooth harmonic noise fields, ridge turbulence, and organic flow strata',
        preferredRenderMode: 'glsl',
        supportsTransparency: false,
      },
      {
        id: 'domain-warping-marble',
        name: 'Domain Warping & Fluid Marble',
        description: 'Iterative noise-within-noise marble veining, silk smoke, and fluid currents',
        preferredRenderMode: 'glsl',
        supportsTransparency: false,
      },
      {
        id: 'parametric-harmonic-curves',
        name: 'Parametric & Harmonic Curves',
        description: 'Lissajous figures, harmonic sweeps, and mathematical curve families',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'strange-attractors',
        name: 'Strange Attractors & Chaotic Systems',
        description: 'Clifford, de Jong, Lorenz, and Halvorsen chaotic trajectory clouds',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'phyllotaxis-sacred-geometry',
        name: 'Phyllotaxis & Sacred Geometry',
        description: 'Fibonacci golden-angle spirals, polar mandalas, and harmonic symmetry',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'sine-soundwaves-equalizers',
        name: 'Sine Waves, Soundwaves & Equalizers',
        description: 'Acoustic frequency waveforms, phase ribbons, and harmonic spectrum bars',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
    ],
  },
  {
    id: 'patterns-textures',
    name: 'Patterns, Textures & Surface Overlays',
    marketFocus: 'UI backgrounds, stationery mockups, print overlays, packaging textures',
    styles: [
      {
        id: 'mesh-gradients-aurora',
        name: 'Mesh Gradients & Aurora Blends',
        description: 'Multi-pole luminous color meshes and silky northern aurora blends',
        preferredRenderMode: 'glsl',
        supportsTransparency: false,
      },
      {
        id: 'topographic-contour-lines',
        name: 'Topographic Contour Lines',
        description: 'Precision cartographic elevation isolines and minimal ridge contours',
        preferredRenderMode: 'glsl',
        supportsTransparency: true,
      },
      {
        id: 'halftone-dots-print',
        name: 'Halftone Dots & Print Patterns',
        description: 'Modulated dot screens, stochastic print gradients, and graphic matrices',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'film-grain-paper-texture',
        name: 'Film Grain, Noise & Paper Texture',
        description: 'Organic cotton paper fibers, archival tactile grain, and tonal gradients',
        preferredRenderMode: 'glsl',
        supportsTransparency: false,
      },
      {
        id: 'stripes-chevrons-rhythms',
        name: 'Stripes, Chevrons & Linear Rhythms',
        description: 'Architectural fluted stripes, crisp chevrons, and kinetic line rhythms',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'organic-botanical-patterns',
        name: 'Organic & Botanical-Inspired Patterns',
        description: 'Venation curves, cellular foliage rhythms, and algorithmic growth motifs',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
    ],
  },
  {
    id: 'commercial-minimal-editorial',
    name: 'Commercial, Minimal & Editorial Backgrounds',
    marketFocus: 'Keynote decks, SaaS hero banners, luxury cosmetics, lifestyle web headers',
    styles: [
      {
        id: 'minimal-corporate-backdrops',
        name: 'Minimal Corporate & Presentation Backdrops',
        description: 'Clean executive surfaces, subtle architectural depth, generous copy space',
        preferredRenderMode: 'hybrid',
        supportsTransparency: false,
      },
      {
        id: 'pastel-soft-calm',
        name: 'Pastel, Soft & Calm Aesthetic Backgrounds',
        description: 'Airy diffused pastel blends, serene soft shapes, wellness editorial feel',
        preferredRenderMode: 'glsl',
        supportsTransparency: false,
      },
      {
        id: 'luxury-dark-gold-editorial',
        name: 'Luxury, Dark & Gold Editorial Backgrounds',
        description: 'Obsidian velvet depth, brushed champagne gold accents, dramatic key light',
        preferredRenderMode: 'hybrid',
        supportsTransparency: false,
      },
      {
        id: 'retro-synthwave-vintage',
        name: 'Retro, Synthwave & Vintage Backgrounds',
        description: '80s solar horizons, analog scanlines, mid-century palettes, vintage grain',
        preferredRenderMode: 'hybrid',
        supportsTransparency: false,
      },
      {
        id: 'nature-sky-water-abstracts',
        name: 'Nature, Sky, Water & Atmospheric Abstracts',
        description: 'Procedural cloudscapes, calm ocean horizons, warm sunbeams, horizon haze',
        preferredRenderMode: 'glsl',
        supportsTransparency: false,
      },
    ],
  },
  {
    id: 'typography-graphic-editorial',
    name: 'Typography, Graphic & Editorial Systems',
    marketFocus: 'Design agency portfolios, art book covers, exhibition posters, print templates',
    styles: [
      {
        id: 'swiss-grid-editorial',
        name: 'Swiss Grid & Editorial Posters',
        description: 'International typographic style grids, asymmetric balance, crisp rules & blocks',
        preferredRenderMode: 'canvas',
        supportsTransparency: false,
      },
      {
        id: 'minimalist-line-art-posters',
        name: 'Minimalist Line Art & Contour Posters',
        description: 'Continuous single-line contour rhythms and high-contrast gallery composition',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'halftone-pop-graphic',
        name: 'Halftone Pop & Graphic Halftone',
        description: 'Bold graphic dot screens, duotone contrast planes, and pop poster rhythm',
        preferredRenderMode: 'canvas',
        supportsTransparency: false,
      },
    ],
  },
  {
    id: 'atmospheric-light-optical',
    name: 'Atmospheric, Light & Optical Phenomena',
    marketFocus: 'Beauty/skincare campaigns, audio brands, futuristic UX, stage backdrops',
    styles: [
      {
        id: 'caustics-water-light',
        name: 'Caustics & Water Light Patterns',
        description: 'Refracted underwater caustic networks and shimmering focal filaments',
        preferredRenderMode: 'glsl',
        supportsTransparency: false,
      },
      {
        id: 'bokeh-light-orbs',
        name: 'Bokeh, Light Orbs & Depth Blur',
        description: 'Optical aperture bokeh discs, layered depth blur, warm ambient glow',
        preferredRenderMode: 'glsl',
        supportsTransparency: true,
      },
      {
        id: 'prism-dispersion-iridescent',
        name: 'Prism, Dispersion & Iridescent Sheen',
        description: 'Spectral glass dispersion, thin-film iridescence, holographic foil sheen',
        preferredRenderMode: 'glsl',
        supportsTransparency: false,
      },
    ],
  },
  {
    id: 'abstract-flow-fluids',
    name: 'Abstract Flow, Fluids & Physical Dynamics',
    marketFocus: 'Creative studio reels, music artwork, kinetic branding, wellness visuals',
    styles: [
      {
        id: 'curl-noise-smoke-ink',
        name: 'Curl Noise & Smoke/Ink Diffusion',
        description: 'Divergence-free curl velocity trails, ink-in-water wisps, silky diffusion',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'reaction-diffusion-turing',
        name: 'Reaction-Diffusion & Turing Patterns',
        description: 'Organic labyrinthine ridges, coral spots, and biological morphogenesis',
        preferredRenderMode: 'glsl',
        supportsTransparency: false,
      },
      {
        id: 'pendulum-spirograph-harmonograph',
        name: 'Pendulum, Spirograph & Harmonograph',
        description: 'Damped multi-axis pendulum orbits and precision guilloché rosettes',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'cloth-wave-mesh-deformation',
        name: 'Cloth, Wave & Mesh Deformation',
        description: 'Draped silk wave lattices, ripple displacement surfaces, kinetic folds',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
    ],
  },
  {
    id: 'architectural-structural-spatial',
    name: 'Architectural, Structural & Spatial Layouts',
    marketFocus: 'Real estate tech, industrial design, SaaS enterprise, editorial minimalism',
    styles: [
      {
        id: 'brutalist-concrete-monolithic',
        name: 'Brutalist Concrete & Monolithic Blocks',
        description: 'Cast concrete shadow geometry, sunlit brutalist planes, stone grain',
        preferredRenderMode: 'glsl',
        supportsTransparency: false,
      },
      {
        id: 'grid-systems-blueprints-cad',
        name: 'Grid Systems, Blueprints & Technical CAD',
        description: 'Precision drafting hairlines, crosshairs, dimension callouts, orthographic plans',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
      {
        id: 'perspective-tunnels-portals',
        name: 'Perspective Tunnels, Portals & Corridors',
        description: 'Infinite recursive architectural portals, vanishing light corridors',
        preferredRenderMode: 'canvas',
        supportsTransparency: true,
      },
    ],
  },
];

export const CORE_BG_CATEGORIES = BG_TAXONOMY.map((c) => c.name);
export type CoreBgCategory = string;

export const CATEGORY_OPTIONS = [
  'Auto / Market Trend (AI Choice)',
  ...CORE_BG_CATEGORIES,
] as const;

export type BgCategoryOption = string;

// Legacy manual fallback algorithm IDs (used only when AI Director is disabled)
export type BgAlgorithmId =
  | 'circuit-board'
  | 'network-nodes'
  | 'digital-grid'
  | 'data-matrix'
  | 'geometric-patterns'
  | 'low-poly'
  | 'voronoi-patterns'
  | 'concentric-patterns'
  | '3d-spheres'
  | '3d-torus'
  | 'liquid-chrome'
  | '3d-structures'
  | 'fractal-art'
  | 'parametric-curves'
  | 'noise-patterns'
  | 'moire-patterns'
  | 'particle-field'
  | 'light-rays'
  | 'flow-waves'
  | 'light-trails'
  | 'topographic-elevation'
  | 'halftone-matrix'
  | 'isometric-architecture';

export const ALL_ALGORITHMS: BgAlgorithmId[] = [
  'circuit-board',
  'network-nodes',
  'digital-grid',
  'data-matrix',
  'geometric-patterns',
  'low-poly',
  'voronoi-patterns',
  'concentric-patterns',
  '3d-spheres',
  '3d-torus',
  'liquid-chrome',
  '3d-structures',
  'fractal-art',
  'parametric-curves',
  'noise-patterns',
  'moire-patterns',
  'particle-field',
  'light-rays',
  'flow-waves',
  'light-trails',
  'topographic-elevation',
  'halftone-matrix',
  'isometric-architecture',
];

export type BgShaderStyle =
  | 'mesh-atmospheric'
  | 'raymarch-spheres'
  | 'raymarch-chrome'
  | 'raymarch-torus'
  | 'voronoi-caustic'
  | 'fractal-julia'
  | 'noise-ridge'
  | 'studio-minimal';

export type SymmetryMode = 'none' | 'mirror-x' | 'mirror-y' | 'kaleido-4';

export interface ReferenceImagePayload {
  mimeType: string;
  data: string; // raw base64 without data URL prefix
  previewUrl?: string;
}

export interface AiBlueprint {
  visualAnalysis?: string;
  mathematicalSystem?: string;
  rarityRationale?: string;
  conceptTitle: string;
  marketDemandInsight: string;
  creativeRationale: string;
  resolvedCategory: string;
  styleName: string;
  renderMode: 'glsl' | 'canvas' | 'hybrid';
  glslCode?: string;
  canvasCode?: string;
  supportsTransparency: boolean;
  // Legacy / fallback hints
  algorithmId?: BgAlgorithmId;
  shaderStyle?: BgShaderStyle;
  negativeSpaceZone: 'left' | 'right' | 'top' | 'bottom' | 'center-halo' | 'corners';
  focalX: number;
  focalY: number;
  lightAngleDeg: number;
  geometryScale: number;
  densityFactor: number;
  glowFactor: number;
  depthFactor: number;
  paletteBase: string;
  palettePrimary: string;
  paletteSecondary: string;
  paletteAccent: string;
  paletteHighlight: string;
}

export const ASPECT_RATIOS = [
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '3:2',
  '2:3',
  '21:9',
  'Custom',
] as const;

export type AspectRatioOption = (typeof ASPECT_RATIOS)[number];

export type ResolutionPreset = '4K' | '8K' | 'Custom';

export const COLOR_STYLES = [
  'Random / AI-Curated',
  'Blue & Cyan',
  'Purple & Violet',
  'Black & Gold',
  'Neon',
  'Monochrome',
  'Dark',
  'Light',
  'Custom Palette',
] as const;

export type ColorStyleOption = (typeof COLOR_STYLES)[number];

export const COMPLEXITY_LEVELS = [
  'Minimal',
  'Balanced',
  'Detailed',
  'Ultra Detailed',
] as const;

export type ComplexityLevel = (typeof COMPLEXITY_LEVELS)[number];

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface CustomColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  highlight: string;
}

export interface TechBgParams {
  category: BgCategoryOption;
  styleSelection: 'ai-invention' | string;
  algorithmOverride: 'auto' | BgAlgorithmId;
  prompt: string;
  useAiDirector: boolean;
  aspectRatio: AspectRatioOption;
  customRatioW: number;
  customRatioH: number;
  resolutionPreset: ResolutionPreset;
  customWidth: number;
  customHeight: number;
  colorStyle: ColorStyleOption;
  customPalette: CustomColorPalette;
  baseColor: string;
  useCustomBaseColor: boolean;
  complexity: ComplexityLevel;
  seed: string;
  seedLocked: boolean;
  density: number;       // 10 - 100
  scale: number;         // 40 - 200 (%)
  rotation: number;      // 0 - 360 (deg)
  offsetX: number;       // -100 - +100 (%)
  offsetY: number;       // -100 - +100 (%)
  warp: number;          // 0 - 100 (%)
  lineWeight: number;    // 40 - 220 (%)
  symmetry: SymmetryMode;
  glowIntensity: number; // 0 - 100
  depth: number;         // 0 - 100
  saturation: number;    // 0 - 200 (%)
  hueShift: number;      // -180 - +180 (deg)
  contrast: number;      // 50 - 160 (%)
  brightness: number;    // 60 - 140 (%)
  grain: number;         // 0 - 100 (%)
  vignette: number;      // 0 - 100 (%)
  transparentBackground: boolean;
  aiBlueprint?: AiBlueprint;
}

export interface ExportSettings {
  format: ExportFormat;
  quality: number;
  filenamePrefix: string;
  colorProfile: 'sRGB';
}

export interface StockQualityCheckItem {
  id: string;
  label: string;
  status: 'pass' | 'review' | 'warn';
  value: string;
  guidance: string;
}

export interface StockQualityReport {
  overallTier: 'Strong Technical Fit' | 'Good with Minor Adjustments' | 'Needs Review';
  checkedAt: number;
  dimensionsLabel: string;
  megapixels: number;
  checks: StockQualityCheckItem[];
  disclaimer: string;
}

export interface GeneratedBackground {
  id: string;
  createdAt: number;
  previewUrl: string;
  params: TechBgParams;
  width: number;
  height: number;
  aspectLabel: string;
  favorite: boolean;
  resolvedCategory: string;
  styleName?: string;
  conceptTitle: string;
  marketDemandInsight?: string;
  creativeRationale?: string;
  qualityReport?: StockQualityReport;
}

export const STANDARD_RESOLUTION_TABLE: Record<
  Exclude<AspectRatioOption, 'Custom'>,
  { '4K': [number, number]; '8K': [number, number] }
> = {
  '16:9': { '4K': [3840, 2160], '8K': [7680, 4320] },
  '9:16': { '4K': [2160, 3840], '8K': [4320, 7680] },
  '1:1': { '4K': [3840, 3840], '8K': [7680, 7680] },
  '4:3': { '4K': [3840, 2880], '8K': [7680, 5760] },
  '3:2': { '4K': [3840, 2560], '8K': [7680, 5120] },
  '2:3': { '4K': [2560, 3840], '8K': [5120, 7680] },
  '21:9': { '4K': [5040, 2160], '8K': [10080, 4320] },
};

export function resolveTargetDimensions(params: TechBgParams): {
  width: number;
  height: number;
  aspectLabel: string;
} {
  if (params.resolutionPreset === 'Custom') {
    const w = Math.max(320, Math.min(12000, Math.round(params.customWidth || 3840)));
    const h = Math.max(320, Math.min(12000, Math.round(params.customHeight || 2160)));
    const aspectLabel =
      params.aspectRatio === 'Custom'
        ? `${Math.max(1, Math.round(params.customRatioW))}:${Math.max(1, Math.round(params.customRatioH))}`
        : params.aspectRatio;
    return { width: w, height: h, aspectLabel };
  }

  if (params.aspectRatio !== 'Custom') {
    const [width, height] = STANDARD_RESOLUTION_TABLE[params.aspectRatio][params.resolutionPreset];
    return { width, height, aspectLabel: params.aspectRatio };
  }

  const rw = Math.max(1, params.customRatioW || 16);
  const rh = Math.max(1, params.customRatioH || 9);
  const longEdge = params.resolutionPreset === '8K' ? 7680 : 3840;
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

export function findStyleById(styleId: string): { category: BgCategoryDefinition; style: BgStyleDefinition } | null {
  for (const cat of BG_TAXONOMY) {
    const found = cat.styles.find((s) => s.id === styleId);
    if (found) return { category: cat, style: found };
  }
  return null;
}

export const DEFAULT_TECH_BG_PARAMS: TechBgParams = {
  category: 'Auto / Market Trend (AI Choice)',
  styleSelection: 'ai-invention',
  algorithmOverride: 'auto',
  prompt: '',
  useAiDirector: true,
  aspectRatio: '16:9',
  customRatioW: 16,
  customRatioH: 9,
  resolutionPreset: '4K',
  customWidth: 3840,
  customHeight: 2160,
  colorStyle: 'Random / AI-Curated',
  customPalette: {
    primary: '#0f3460',
    secondary: '#1d6fa5',
    accent: '#00d2ff',
    highlight: '#e6f9ff',
  },
  baseColor: '#040812',
  useCustomBaseColor: false,
  complexity: 'Balanced',
  seed: 'BG-749102-K9',
  seedLocked: false,
  density: 58,
  scale: 100,
  rotation: 35,
  offsetX: 0,
  offsetY: 0,
  warp: 45,
  lineWeight: 100,
  symmetry: 'none',
  glowIntensity: 60,
  depth: 70,
  saturation: 105,
  hueShift: 0,
  contrast: 105,
  brightness: 100,
  grain: 12,
  vignette: 22,
  transparentBackground: false,
};
