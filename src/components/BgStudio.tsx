import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import {
  RefreshCw,
  Shuffle,
  Download,
  Heart,
  Trash2,
  Maximize2,
  X,
  Check,
  Copy,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Package,
  Plus,
  Square,
  CheckSquare,
  Dices,
  Lock,
  Unlock,
  RotateCcw,
  ChevronDown,
} from 'lucide-react';
import {
  ASPECT_RATIOS,
  BG_TAXONOMY,
  CATEGORY_OPTIONS,
  COLOR_STYLES,
  COMPLEXITY_LEVELS,
  CoreBgCategory,
  DEFAULT_TECH_BG_PARAMS,
  ExportFormat,
  ExportSettings,
  GeneratedBackground,
  ResolutionPreset,
  StockQualityReport,
  SymmetryMode,
  TechBgParams,
  findStyleById,
  resolveTargetDimensions,
} from '../services/techBgTypes';
import {
  canvasToBlobAsync,
  createRandomParamVariation,
  generateGenerationId,
  generateRandomSeed,
  renderBackgroundToCanvas,
  resolvePaletteHexPreview,
} from '../services/techBgEngine';
import { analyzeStockQuality } from '../services/techBgQuality';
import { cn } from '../lib/utils';

const PREVIEW_MAX_EDGE = 1120;

function cloneTechBgParams(p: TechBgParams): TechBgParams {
  return {
    ...p,
    customPalette: { ...p.customPalette },
    aiBlueprint: undefined,
  };
}

interface BgStudioProps {
  geminiApiKey?: string;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function sanitizeFilenamePart(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
}

function clampNum(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export default function BgStudio(_props: BgStudioProps) {
  const [params, setParams] = useState<TechBgParams>(() => ({
    ...DEFAULT_TECH_BG_PARAMS,
    useAiDirector: false,
    aiBlueprint: undefined,
  }));
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    format: 'png',
    quality: 94,
    filenamePrefix: 'bg-studio',
    colorProfile: 'sRGB',
  });

  // Live Stage State
  const stageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stagePreviewUrl, setStagePreviewUrl] = useState<string>('');
  const [stageMeta, setStageMeta] = useState<{
    resolvedCategory: CoreBgCategory;
    styleName: string;
    conceptTitle: string;
    marketDemandInsight?: string;
    creativeRationale?: string;
    renderModeLabel: string;
    supportsTransparency: boolean;
  }>({
    resolvedCategory: 'Technology, Digital & Cyber',
    styleName: 'Circuit Board & Microchip Patterns',
    conceptTitle: 'PCB Architecture',
    renderModeLabel: 'Procedural',
    supportsTransparency: true,
  });

  const [isRenderingStage, setIsRenderingStage] = useState(false);
  const [isSavingToGallery, setIsSavingToGallery] = useState(false);
  const [justSavedGallery, setJustSavedGallery] = useState(false);
  const [stageQualityReport, setStageQualityReport] = useState<StockQualityReport | null>(null);
  const [showQualityDrawer, setShowQualityDrawer] = useState(false);
  const gallerySectionRef = useRef<HTMLElement | null>(null);
  const [copiedSeed, setCopiedSeed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Batch & Gallery State
  const [gallery, setGallery] = useState<GeneratedBackground[]>([]);
  const galleryRef = useRef<GeneratedBackground[]>(gallery);
  galleryRef.current = gallery;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'favorites'>('all');
  const [customBatchQty, setCustomBatchQty] = useState<number>(10);

  const [batchProgress, setBatchProgress] = useState<{
    active: boolean;
    total: number;
    completed: number;
    label: string;
  } | null>(null);

  const [exportProgress, setExportProgress] = useState<{
    active: boolean;
    total: number;
    completed: number;
    label: string;
  } | null>(null);

  const [lightboxItem, setLightboxItem] = useState<{
    previewUrl: string;
    params: TechBgParams;
    width: number;
    height: number;
    aspectLabel: string;
    resolvedCategory: CoreBgCategory;
    styleName?: string;
    conceptTitle: string;
    marketDemandInsight?: string;
    creativeRationale?: string;
    id: string;
    qualityReport?: StockQualityReport;
  } | null>(null);

  const [showBatchMenu, setShowBatchMenu] = useState(false);
  const [showSlidersBar, setShowSlidersBar] = useState(true);
  const batchMenuRef = useRef<HTMLDivElement | null>(null);

  const stageAbortRef = useRef<AbortController | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const stageUrlRef = useRef<string>('');

  const targetDims = useMemo(() => resolveTargetDimensions(params), [params]);
  const livePalette = useMemo(() => resolvePaletteHexPreview(params), [params]);

  useEffect(() => {
    if (!showBatchMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (batchMenuRef.current && !batchMenuRef.current.contains(e.target as Node)) {
        setShowBatchMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showBatchMenu]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stageAbortRef.current?.abort();
      batchAbortRef.current?.abort();
      exportAbortRef.current?.abort();
      if (stageUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(stageUrlRef.current);
      }
      for (const item of galleryRef.current) {
        if (item.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
    };
  }, []);

  // Debounced live stage render whenever parameters change
  useEffect(() => {
    stageAbortRef.current?.abort();
    const controller = new AbortController();
    stageAbortRef.current = controller;

    const timer = setTimeout(async () => {
      setIsRenderingStage(true);
      try {
        const res = await renderBackgroundToCanvas(params, {
          previewMaxEdge: PREVIEW_MAX_EDGE,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        stageCanvasRef.current = res.canvas;
        setStageMeta({
          resolvedCategory: res.resolvedCategory,
          styleName: res.styleName,
          conceptTitle: res.conceptTitle,
          marketDemandInsight: res.marketDemandInsight,
          creativeRationale: res.creativeRationale,
          renderModeLabel: res.renderModeLabel,
          supportsTransparency: res.supportsTransparency,
        });

        if (res.renderWarning) {
          setErrorMsg(res.renderWarning);
        }

        const blob = await canvasToBlobAsync(res.canvas, 'png', 100);
        if (controller.signal.aborted) return;

        const nextUrl = URL.createObjectURL(blob);
        if (stageUrlRef.current.startsWith('blob:')) {
          URL.revokeObjectURL(stageUrlRef.current);
        }
        stageUrlRef.current = nextUrl;
        setStagePreviewUrl(nextUrl);

        if (showQualityDrawer) {
          setStageQualityReport(
            analyzeStockQuality(
              res.canvas,
              res.width,
              res.height,
              params.transparentBackground && res.supportsTransparency
            )
          );
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setErrorMsg(err?.message || 'Unable to render procedural background.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsRenderingStage(false);
        }
      }
    }, 45);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [params, showQualityDrawer]);

  const updateParam = useCallback(<K extends keyof TechBgParams>(key: K, value: TechBgParams[K]) => {
    setParams((prev) => {
      if (key === 'category') {
        const nextCat = value as TechBgParams['category'];
        const isAutoCat = !nextCat || nextCat.startsWith('Auto');
        const currentStyleMatch =
          prev.styleSelection !== 'ai-invention' ? findStyleById(prev.styleSelection) : null;
        const keepStyle =
          prev.styleSelection === 'ai-invention' ||
          isAutoCat ||
          currentStyleMatch?.category.name === nextCat;
        const keepBlueprint =
          isAutoCat ||
          !prev.aiBlueprint ||
          prev.aiBlueprint.resolvedCategory === nextCat;
        return {
          ...prev,
          category: nextCat,
          styleSelection: keepStyle ? prev.styleSelection : 'ai-invention',
          algorithmOverride: 'auto',
          aiBlueprint: keepBlueprint ? prev.aiBlueprint : undefined,
        };
      }
      if (key === 'styleSelection') {
        const nextStyle = value as string;
        const styleInfo = nextStyle !== 'ai-invention' ? findStyleById(nextStyle) : null;
        const keepBlueprint =
          nextStyle === 'ai-invention' ||
          (styleInfo && prev.aiBlueprint?.styleName === styleInfo.style.name);
        return {
          ...prev,
          styleSelection: nextStyle,
          algorithmOverride: 'auto',
          aiBlueprint: keepBlueprint ? prev.aiBlueprint : undefined,
        };
      }
      return { ...prev, [key]: value };
    });
  }, []);

  const handleRegenerateProcedural = useCallback(() => {
    setErrorMsg(null);
    setParams((prev) => ({
      ...prev,
      seed: prev.seedLocked ? prev.seed : generateRandomSeed(),
      useAiDirector: false,
      aiBlueprint: undefined,
    }));
  }, []);

  const handleSwatchChange = useCallback(
    (slot: 'base' | 'primary' | 'secondary' | 'accent' | 'highlight', hex: string) => {
      setParams((prev) => {
        if (slot === 'base') {
          return {
            ...prev,
            baseColor: hex,
            useCustomBaseColor: true,
          };
        }
        const currentPreview = resolvePaletteHexPreview(prev);
        return {
          ...prev,
          colorStyle: 'Custom Palette',
          baseColor: prev.useCustomBaseColor ? prev.baseColor : currentPreview.base,
          customPalette: {
            primary: slot === 'primary' ? hex : currentPreview.primary,
            secondary: slot === 'secondary' ? hex : currentPreview.secondary,
            accent: slot === 'accent' ? hex : currentPreview.accent,
            highlight: slot === 'highlight' ? hex : currentPreview.highlight,
          },
        };
      });
    },
    []
  );

  const handleRandomizeAll = useCallback(() => {
    setErrorMsg(null);
    setParams((prev) => createRandomParamVariation(prev));
  }, []);

  const handleResetDefaults = useCallback(() => {
    setErrorMsg(null);
    setParams((prev) => ({
      ...prev,
      styleSelection: DEFAULT_TECH_BG_PARAMS.styleSelection,
      algorithmOverride: DEFAULT_TECH_BG_PARAMS.algorithmOverride,
      colorStyle: prev.colorStyle === 'Custom Palette' ? 'Random / AI-Curated' : prev.colorStyle,
      seed: DEFAULT_TECH_BG_PARAMS.seed,
      seedLocked: DEFAULT_TECH_BG_PARAMS.seedLocked,
      density: DEFAULT_TECH_BG_PARAMS.density,
      scale: DEFAULT_TECH_BG_PARAMS.scale,
      rotation: DEFAULT_TECH_BG_PARAMS.rotation,
      offsetX: DEFAULT_TECH_BG_PARAMS.offsetX,
      offsetY: DEFAULT_TECH_BG_PARAMS.offsetY,
      warp: DEFAULT_TECH_BG_PARAMS.warp,
      lineWeight: DEFAULT_TECH_BG_PARAMS.lineWeight,
      symmetry: DEFAULT_TECH_BG_PARAMS.symmetry,
      glowIntensity: DEFAULT_TECH_BG_PARAMS.glowIntensity,
      depth: DEFAULT_TECH_BG_PARAMS.depth,
      saturation: DEFAULT_TECH_BG_PARAMS.saturation,
      hueShift: DEFAULT_TECH_BG_PARAMS.hueShift,
      contrast: DEFAULT_TECH_BG_PARAMS.contrast,
      brightness: DEFAULT_TECH_BG_PARAMS.brightness,
      grain: DEFAULT_TECH_BG_PARAMS.grain,
      vignette: DEFAULT_TECH_BG_PARAMS.vignette,
      useCustomBaseColor: DEFAULT_TECH_BG_PARAMS.useCustomBaseColor,
      baseColor: DEFAULT_TECH_BG_PARAMS.baseColor,
      customPalette: { ...DEFAULT_TECH_BG_PARAMS.customPalette },
      transparentBackground: DEFAULT_TECH_BG_PARAMS.transparentBackground,
      aiBlueprint: undefined,
    }));
  }, []);

  const handleCopySeed = useCallback(() => {
    navigator.clipboard?.writeText(params.seed).catch(() => {});
    setCopiedSeed(true);
    setTimeout(() => setCopiedSeed(false), 1400);
  }, [params.seed]);

  const handleRunStageQualityCheck = useCallback(() => {
    if (!stageCanvasRef.current) return;
    const report = analyzeStockQuality(
      stageCanvasRef.current,
      targetDims.width,
      targetDims.height,
      params.transparentBackground && stageMeta.supportsTransparency
    );
    setStageQualityReport(report);
    setShowQualityDrawer(true);
  }, [params.transparentBackground, stageMeta.supportsTransparency, targetDims.height, targetDims.width]);

  const handleSaveCurrentToGallery = useCallback(async () => {
    if (isSavingToGallery) return;
    setIsSavingToGallery(true);
    setErrorMsg(null);
    try {
      let thumbCanvas: HTMLCanvasElement;
      let width = targetDims.width;
      let height = targetDims.height;
      let aspectLabel = targetDims.aspectLabel;
      let resolvedCategory = stageMeta.resolvedCategory;
      let styleName = stageMeta.styleName;
      let conceptTitle = stageMeta.conceptTitle;
      let marketDemandInsight = stageMeta.marketDemandInsight;
      let creativeRationale = stageMeta.creativeRationale;
      let supportsTransparency = stageMeta.supportsTransparency;

      if (stageCanvasRef.current && stageCanvasRef.current.width > 0) {
        const src = stageCanvasRef.current;
        const maxEdge = 960;
        const factor = Math.min(1, maxEdge / Math.max(1, src.width, src.height));
        const tw = Math.max(120, Math.round(src.width * factor));
        const th = Math.max(120, Math.round(src.height * factor));
        thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = tw;
        thumbCanvas.height = th;
        const tctx = thumbCanvas.getContext('2d');
        if (tctx) {
          tctx.drawImage(src, 0, 0, tw, th);
        }
      } else {
        const res = await renderBackgroundToCanvas(params, {
          previewMaxEdge: 960,
        });
        thumbCanvas = res.canvas;
        width = res.width;
        height = res.height;
        aspectLabel = res.aspectLabel;
        resolvedCategory = res.resolvedCategory;
        styleName = res.styleName;
        conceptTitle = res.conceptTitle;
        marketDemandInsight = res.marketDemandInsight;
        creativeRationale = res.creativeRationale;
        supportsTransparency = res.supportsTransparency;
      }

      const isAlpha = params.transparentBackground && supportsTransparency;
      const blob = await canvasToBlobAsync(thumbCanvas, isAlpha ? 'png' : 'jpeg', 90);
      const url = URL.createObjectURL(blob);

      const item: GeneratedBackground = {
        id: generateGenerationId(),
        createdAt: Date.now(),
        previewUrl: url,
        params: cloneTechBgParams(params),
        width,
        height,
        aspectLabel,
        favorite: false,
        resolvedCategory,
        styleName,
        conceptTitle,
        marketDemandInsight,
        creativeRationale,
      };
      setGallery((prev) => [item, ...prev]);
      setJustSavedGallery(true);
      setTimeout(() => setJustSavedGallery(false), 1600);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to save to gallery.');
    } finally {
      setIsSavingToGallery(false);
    }
  }, [
    isSavingToGallery,
    params,
    stageMeta.conceptTitle,
    stageMeta.creativeRationale,
    stageMeta.marketDemandInsight,
    stageMeta.resolvedCategory,
    stageMeta.styleName,
    stageMeta.supportsTransparency,
    targetDims.aspectLabel,
    targetDims.height,
    targetDims.width,
  ]);

  // Queue-based Procedural Batch Generation
  const handleRunBatch = useCallback(
    async (count: number) => {
      const qty = clampNum(Math.round(count), 1, 200);
      if (batchProgress?.active) return;

      batchAbortRef.current?.abort();
      const controller = new AbortController();
      batchAbortRef.current = controller;

      setErrorMsg(null);
      setBatchProgress({
        active: true,
        total: qty,
        completed: 0,
        label: 'Starting procedural batch...',
      });

      try {
        let generatedSoFar = 0;

        while (generatedSoFar < qty) {
          if (controller.signal.aborted) break;
          const chunkCount = Math.min(8, qty - generatedSoFar);

          for (let i = 0; i < chunkCount; i++) {
            if (controller.signal.aborted) break;
            const itemParams: TechBgParams = {
              ...params,
              seed: params.seedLocked ? params.seed : generateRandomSeed(),
              density: clampNum(params.density + Math.round((Math.random() - 0.5) * 20), 15, 95),
              scale: clampNum(params.scale + Math.round((Math.random() - 0.5) * 24), 55, 160),
              rotation: (params.rotation + Math.round(Math.random() * 120)) % 360,
              glowIntensity: clampNum(
                params.glowIntensity + Math.round((Math.random() - 0.5) * 18),
                10,
                95
              ),
              useAiDirector: false,
              aiBlueprint: undefined,
            };

            setBatchProgress({
              active: true,
              total: qty,
              completed: generatedSoFar,
              label: `Rendering ${generatedSoFar + 1}/${qty}: ${itemParams.seed}`,
            });

            const res = await renderBackgroundToCanvas(itemParams, {
              previewMaxEdge: 880,
              signal: controller.signal,
            });
            if (controller.signal.aborted) break;

            const isAlpha = itemParams.transparentBackground && res.supportsTransparency;
            const blob = await canvasToBlobAsync(res.canvas, isAlpha ? 'png' : 'jpeg', 86);
            const url = URL.createObjectURL(blob);

            const item: GeneratedBackground = {
              id: generateGenerationId(),
              createdAt: Date.now(),
              previewUrl: url,
              params: cloneTechBgParams(itemParams),
              width: res.width,
              height: res.height,
              aspectLabel: res.aspectLabel,
              favorite: false,
              resolvedCategory: res.resolvedCategory,
              styleName: res.styleName,
              conceptTitle: res.conceptTitle,
              marketDemandInsight: res.marketDemandInsight,
              creativeRationale: res.creativeRationale,
            };

            setGallery((prev) => [item, ...prev]);
            generatedSoFar++;

            if (generatedSoFar === qty) {
              setParams(cloneTechBgParams(itemParams));
            }

            await new Promise((r) => setTimeout(r, 15));
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setErrorMsg(err?.message || 'Batch generation stopped.');
        }
      } finally {
        setBatchProgress(null);
      }
    },
    [batchProgress?.active, params]
  );

  // Full-resolution direct export (renders directly at target 4K/8K/Custom pixel size)
  const exportSingleFullRes = useCallback(
    async (itemParams: TechBgParams, itemId?: string) => {
      if (exportProgress?.active) return;

      exportAbortRef.current?.abort();
      const controller = new AbortController();
      exportAbortRef.current = controller;

      const dims = resolveTargetDimensions(itemParams);
      setExportProgress({
        active: true,
        total: 1,
        completed: 0,
        label: `Rendering ${dims.width}×${dims.height}px (${exportSettings.format.toUpperCase()})...`,
      });
      setErrorMsg(null);

      try {
        const res = await renderBackgroundToCanvas(itemParams, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        const isAlpha = itemParams.transparentBackground && res.supportsTransparency;
        const effectiveFormat: ExportFormat =
          isAlpha && exportSettings.format === 'jpeg' ? 'png' : exportSettings.format;

        const blob = await canvasToBlobAsync(res.canvas, effectiveFormat, exportSettings.quality);
        const prefix = sanitizeFilenamePart(exportSettings.filenamePrefix || 'bg-studio') || 'bg-studio';
        const catSlug = sanitizeFilenamePart(res.resolvedCategory);
        const idTag = itemId ? `-${itemId.toLowerCase()}` : '';
        const ext = effectiveFormat === 'jpeg' ? 'jpg' : effectiveFormat;
        const filename = `${prefix}-${catSlug}-${dims.width}x${dims.height}-${itemParams.seed.toLowerCase()}${idTag}.${ext}`;

        triggerDownload(blob, filename);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setErrorMsg(err?.message || 'Full-resolution export failed.');
        }
      } finally {
        setExportProgress(null);
      }
    },
    [exportProgress?.active, exportSettings]
  );

  // Batch ZIP export at true target pixel resolution
  const handleBatchZipExport = useCallback(async () => {
    const items = gallery.filter((g) => selectedIds.has(g.id));
    if (items.length === 0 || exportProgress?.active) return;

    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;

    setExportProgress({
      active: true,
      total: items.length,
      completed: 0,
      label: `Preparing ${items.length} full-resolution files...`,
    });
    setErrorMsg(null);

    try {
      const zip = new JSZip();
      const prefix = sanitizeFilenamePart(exportSettings.filenamePrefix || 'bg-studio') || 'bg-studio';

      for (let i = 0; i < items.length; i++) {
        if (controller.signal.aborted) break;
        const item = items[i];
        setExportProgress({
          active: true,
          total: items.length,
          completed: i,
          label: `Rendering ${i + 1}/${items.length} (${item.width}×${item.height}px)...`,
        });

        const res = await renderBackgroundToCanvas(item.params, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) break;

        const isAlpha = item.params.transparentBackground && res.supportsTransparency;
        const effectiveFormat: ExportFormat =
          isAlpha && exportSettings.format === 'jpeg' ? 'png' : exportSettings.format;

        const blob = await canvasToBlobAsync(res.canvas, effectiveFormat, exportSettings.quality);
        const ext = effectiveFormat === 'jpeg' ? 'jpg' : effectiveFormat;
        const catSlug = sanitizeFilenamePart(res.resolvedCategory);
        const fname = `${String(i + 1).padStart(2, '0')}-${prefix}-${catSlug}-${item.width}x${item.height}-${item.params.seed.toLowerCase()}.${ext}`;
        zip.file(fname, blob);
      }

      if (!controller.signal.aborted) {
        setExportProgress({
          active: true,
          total: items.length,
          completed: items.length,
          label: 'Packaging ZIP archive...',
        });
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        triggerDownload(zipBlob, `${prefix}-batch-${items.length}.zip`);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorMsg(err?.message || 'Batch ZIP export failed.');
      }
    } finally {
      setExportProgress(null);
    }
  }, [exportProgress?.active, exportSettings, gallery, selectedIds]);

  const handleRegenerateGalleryItem = useCallback(async (id: string) => {
    const existing = galleryRef.current.find((g) => g.id === id);
    if (!existing) return;
    setErrorMsg(null);

    try {
      const nextParams: TechBgParams = {
        ...existing.params,
        seed: existing.params.seedLocked ? existing.params.seed : generateRandomSeed(),
        useAiDirector: false,
        aiBlueprint: undefined,
      };

      const res = await renderBackgroundToCanvas(nextParams, {
        previewMaxEdge: 880,
      });
      const isAlpha = nextParams.transparentBackground && res.supportsTransparency;
      const blob = await canvasToBlobAsync(res.canvas, isAlpha ? 'png' : 'jpeg', 86);
      const nextUrl = URL.createObjectURL(blob);

      setGallery((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
          return {
            ...item,
            previewUrl: nextUrl,
            params: cloneTechBgParams(nextParams),
            resolvedCategory: res.resolvedCategory,
            styleName: res.styleName,
            conceptTitle: res.conceptTitle,
            marketDemandInsight: res.marketDemandInsight,
            creativeRationale: res.creativeRationale,
            qualityReport: undefined,
          };
        })
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to regenerate background.');
    }
  }, []);

  const handleRunItemQualityCheck = useCallback(async (item: GeneratedBackground) => {
    try {
      const res = await renderBackgroundToCanvas(item.params, {
        previewMaxEdge: 960,
      });
      const report = analyzeStockQuality(
        res.canvas,
        item.width,
        item.height,
        item.params.transparentBackground && res.supportsTransparency
      );
      setGallery((prev) =>
        prev.map((g) => (g.id === item.id ? { ...g, qualityReport: report } : g))
      );
      setLightboxItem((prev) =>
        prev && prev.id === item.id ? { ...prev, qualityReport: report } : prev
      );
    } catch {
      // ignore transient error
    }
  }, []);

  const handleDeleteGalleryItem = useCallback((id: string) => {
    setGallery((prev) => {
      const found = prev.find((g) => g.id === id);
      if (found?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((g) => g.id !== id);
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleClearGallery = useCallback(() => {
    for (const item of galleryRef.current) {
      if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
    }
    setGallery([]);
    setSelectedIds(new Set());
  }, []);

  const handleToggleFavorite = useCallback((id: string) => {
    setGallery((prev) =>
      prev.map((item) => (item.id === id ? { ...item, favorite: !item.favorite } : item))
    );
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filteredGallery = useMemo(() => {
    if (galleryFilter === 'favorites') return gallery.filter((g) => g.favorite);
    return gallery;
  }, [gallery, galleryFilter]);

  const handleSelectAllFiltered = useCallback(() => {
    if (filteredGallery.length === 0) return;
    const allSelected = filteredGallery.every((g) => selectedIds.has(g.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredGallery.map((g) => g.id)));
    }
  }, [filteredGallery, selectedIds]);

  const stageAspectStyle = useMemo(() => {
    return { aspectRatio: `${targetDims.width / Math.max(1, targetDims.height)}` };
  }, [targetDims.height, targetDims.width]);

  return (
    <div className="space-y-3 pb-10">
      {/* Compact Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            BG Studio
          </h2>
          <p className="text-xs text-slate-500 truncate">
            Procedural generator for commercial 4K &amp; 8K backgrounds.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            onClick={handleRandomizeAll}
            className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Shuffle className="w-3.5 h-3.5 text-slate-600" />
            Randomize
          </button>
          <button
            onClick={handleRegenerateProcedural}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isRenderingStage && 'animate-spin')} />
            Regenerate
          </button>
          <button
            disabled={isSavingToGallery}
            onClick={handleSaveCurrentToGallery}
            className={cn(
              'px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-60',
              justSavedGallery
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-900 hover:bg-slate-800 text-white'
            )}
          >
            {justSavedGallery ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            {isSavingToGallery
              ? 'Saving...'
              : justSavedGallery
                ? 'Added!'
                : gallery.length > 0
                  ? `Add to Gallery (${gallery.length})`
                  : 'Add to Gallery'}
          </button>
        </div>
      </div>

      {/* Honest API / Render Error Alert */}
      {errorMsg && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
          <span className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {errorMsg}
          </span>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-rose-500 hover:text-rose-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TOP STUDIO CONTROL DECK (Sleek Console + Live Parameters Above Stage) */}
      <section className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2.5">
        {/* Row 1: Compact Core Dropdowns */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          <div className="space-y-0.5">
            <label className="text-[10px] font-semibold text-slate-500 block">Category</label>
            <select
              value={params.category}
              onChange={(e) => updateParam('category', e.target.value as any)}
              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-medium text-slate-800 focus:outline-none focus:border-indigo-500"
            >
              {CATEGORY_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-0.5">
            <label className="text-[10px] font-semibold text-slate-500 block">Pattern / Style</label>
            <select
              value={params.styleSelection}
              onChange={(e) => updateParam('styleSelection', e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-medium text-slate-800 focus:outline-none focus:border-indigo-500"
            >
              <option value="ai-invention">Procedural Auto (Unique)</option>
              {params.category.startsWith('Auto')
                ? BG_TAXONOMY.map((cat) => (
                    <optgroup key={cat.id} label={cat.name}>
                      {cat.styles.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name}
                        </option>
                      ))}
                    </optgroup>
                  ))
                : (BG_TAXONOMY.find((c) => c.name === params.category)?.styles || []).map(
                    (st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    )
                  )}
            </select>
          </div>

          <div className="space-y-0.5">
            <label className="text-[10px] font-semibold text-slate-500 block">Color Direction</label>
            <select
              value={params.colorStyle}
              onChange={(e) => updateParam('colorStyle', e.target.value as any)}
              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-medium text-slate-800 focus:outline-none focus:border-indigo-500"
            >
              {COLOR_STYLES.map((cs) => (
                <option key={cs} value={cs}>
                  {cs}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-0.5">
            <label className="text-[10px] font-semibold text-slate-500 block">Complexity</label>
            <select
              value={params.complexity}
              onChange={(e) => updateParam('complexity', e.target.value as any)}
              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-medium text-slate-800 focus:outline-none focus:border-indigo-500"
            >
              {COMPLEXITY_LEVELS.map((lvl) => (
                <option key={lvl} value={lvl}>
                  {lvl}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-0.5">
            <label className="text-[10px] font-semibold text-slate-500 block">Aspect Ratio</label>
            <select
              value={params.aspectRatio}
              onChange={(e) => updateParam('aspectRatio', e.target.value as any)}
              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-mono font-medium text-slate-800 focus:outline-none focus:border-indigo-500"
            >
              {ASPECT_RATIOS.map((ratio) => (
                <option key={ratio} value={ratio}>
                  {ratio}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-0.5">
            <div className="flex items-center justify-between gap-1">
              <label className="text-[10px] font-semibold text-slate-500">Resolution</label>
              <span className="text-[10px] font-mono tabular-nums text-indigo-600 font-semibold">
                {targetDims.width}×{targetDims.height}
              </span>
            </div>
            <select
              value={params.resolutionPreset}
              onChange={(e) => updateParam('resolutionPreset', e.target.value as ResolutionPreset)}
              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-medium text-slate-800 focus:outline-none focus:border-indigo-500"
            >
              {(['4K', '8K', 'Custom'] as ResolutionPreset[]).map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-0.5">
            <div className="flex items-center justify-between gap-1">
              <label className="text-[10px] font-semibold text-slate-500">Format</label>
              <span className="text-[10px] font-mono text-slate-400">sRGB</span>
            </div>
            <select
              value={exportSettings.format}
              onChange={(e) =>
                setExportSettings((s) => ({ ...s, format: e.target.value as ExportFormat }))
              }
              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-semibold uppercase text-slate-800 focus:outline-none focus:border-indigo-500"
            >
              <option value="png">PNG (Lossless)</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </div>
        </div>

        {/* Conditional Custom Dimension / Custom Palette Inline Row */}
        {(params.aspectRatio === 'Custom' ||
          params.resolutionPreset === 'Custom' ||
          params.colorStyle === 'Custom Palette') && (
          <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-100">
            {params.aspectRatio === 'Custom' && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-500">Custom Ratio:</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={params.customRatioW}
                  onChange={(e) =>
                    updateParam('customRatioW', Math.max(1, Number(e.target.value) || 1))
                  }
                  className="w-16 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono tabular-nums"
                  title="Ratio width"
                />
                <span className="text-xs text-slate-400">:</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={params.customRatioH}
                  onChange={(e) =>
                    updateParam('customRatioH', Math.max(1, Number(e.target.value) || 1))
                  }
                  className="w-16 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono tabular-nums"
                  title="Ratio height"
                />
              </div>
            )}

            {params.resolutionPreset === 'Custom' && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-500">Pixels:</span>
                <input
                  type="number"
                  min={320}
                  max={12000}
                  value={params.customWidth}
                  onChange={(e) =>
                    updateParam('customWidth', clampNum(Number(e.target.value) || 3840, 320, 12000))
                  }
                  className="w-20 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono tabular-nums"
                  title="Width (px)"
                />
                <span className="text-xs text-slate-400">×</span>
                <input
                  type="number"
                  min={320}
                  max={12000}
                  value={params.customHeight}
                  onChange={(e) =>
                    updateParam('customHeight', clampNum(Number(e.target.value) || 2160, 320, 12000))
                  }
                  className="w-20 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono tabular-nums"
                  title="Height (px)"
                />
              </div>
            )}

            {params.colorStyle === 'Custom Palette' && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[11px] font-semibold text-slate-500">Palette:</span>
                {(['primary', 'secondary', 'accent', 'highlight'] as const).map((slot) => (
                  <label key={slot} className="flex items-center gap-1.5 cursor-pointer">
                    <span className="text-[11px] font-medium text-slate-600 capitalize">
                      {slot}
                    </span>
                    <input
                      type="color"
                      value={params.customPalette[slot]}
                      onChange={(e) =>
                        updateParam('customPalette', {
                          ...params.customPalette,
                          [slot]: e.target.value,
                        })
                      }
                      className="w-7 h-6 rounded-md border border-slate-200 cursor-pointer"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Row 2: Alpha/Base Toggles, Seed Box & Batch/Export Dropdown */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 shrink-0">

            <label
              className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer whitespace-nowrap"
              title={
                stageMeta.supportsTransparency
                  ? 'Active method supports clean PNG/WebP alpha transparency.'
                  : 'Active opaque mesh/surface fills frame; switch structure for alpha overlay.'
              }
            >
              <input
                type="checkbox"
                checked={params.transparentBackground}
                onChange={(e) => updateParam('transparentBackground', e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Transparent BG
            </label>

            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={params.useCustomBaseColor}
                  onChange={(e) => updateParam('useCustomBaseColor', e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Base Color
              </label>
              <input
                type="color"
                value={params.baseColor}
                disabled={!params.useCustomBaseColor && params.colorStyle !== 'Custom Palette'}
                onChange={(e) => updateParam('baseColor', e.target.value)}
                className="w-6 h-5 rounded border border-slate-200 cursor-pointer disabled:opacity-40"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={params.seed}
                onChange={(e) => updateParam('seed', e.target.value)}
                placeholder="BG-749102-K9"
                aria-label="Seed"
                className="w-28 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-mono text-slate-800 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleCopySeed}
                title="Copy seed"
                className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-600 cursor-pointer"
              >
                {copiedSeed ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => updateParam('seedLocked', !params.seedLocked)}
                aria-pressed={params.seedLocked}
                title={params.seedLocked ? 'Unlock seed' : 'Lock seed across generations'}
                className={cn(
                  'p-1.5 border rounded-lg transition-colors cursor-pointer',
                  params.seedLocked
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600'
                )}
              >
                {params.seedLocked ? (
                  <Lock className="w-3.5 h-3.5" />
                ) : (
                  <Unlock className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => updateParam('seed', generateRandomSeed())}
                title="Roll new seed"
                className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-600 cursor-pointer"
              >
                <Dices className="w-3.5 h-3.5 text-indigo-600" />
              </button>
            </div>

            {/* Batch & Export Settings Dropdown */}
            <div className="relative" ref={batchMenuRef}>
              <button
                type="button"
                onClick={() => setShowBatchMenu((v) => !v)}
                className={cn(
                  'px-3 py-1.5 border rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap',
                  showBatchMenu
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                )}
              >
                <Package className="w-3.5 h-3.5" />
                Batch &amp; Export
                <ChevronDown
                  className={cn(
                    'w-3.5 h-3.5 transition-transform duration-150',
                    showBatchMenu && 'rotate-180'
                  )}
                />
              </button>

              {showBatchMenu && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 space-y-3.5 z-30">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Batch Generation
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowBatchMenu(false)}
                      className="text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    {[5, 10, 20, 50].map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        disabled={Boolean(batchProgress?.active)}
                        onClick={() => {
                          setShowBatchMenu(false);
                          handleRunBatch(qty);
                        }}
                        className="py-1.5 rounded-lg bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 text-xs font-semibold font-mono tabular-nums text-slate-700 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        +{qty}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={customBatchQty}
                      onChange={(e) =>
                        setCustomBatchQty(clampNum(Number(e.target.value) || 1, 1, 200))
                      }
                      className="w-20 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono tabular-nums"
                    />
                    <button
                      type="button"
                      disabled={Boolean(batchProgress?.active)}
                      onClick={() => {
                        setShowBatchMenu(false);
                        handleRunBatch(customBatchQty);
                      }}
                      className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      Generate Batch ({customBatchQty})
                    </button>
                  </div>

                  <div className="pt-3 border-t border-slate-100 space-y-2.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                      Export Options
                    </span>

                    {exportSettings.format !== 'png' && (
                      <SliderControl
                        label={`${exportSettings.format.toUpperCase()} Quality`}
                        value={exportSettings.quality}
                        min={60}
                        max={100}
                        unit="%"
                        onChange={(v) => setExportSettings((s) => ({ ...s, quality: v }))}
                      />
                    )}

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-slate-600 block">
                        Filename Prefix
                      </label>
                      <input
                        type="text"
                        value={exportSettings.filenamePrefix}
                        onChange={(e) =>
                          setExportSettings((s) => ({ ...s, filenamePrefix: e.target.value }))
                        }
                        placeholder="Custom filename prefix"
                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 3: Live Visual Parameters (16 real-time controls + Live 5-Color Swatch Strip) */}
        <div className="pt-2 border-t border-slate-100 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowSlidersBar((v) => !v)}
              className="text-[10px] font-bold uppercase tracking-wider text-slate-600 hover:text-slate-900 flex items-center gap-1.5 cursor-pointer"
            >
              <Sliders className="w-3 h-3 text-indigo-600" />
              Live Parameters &amp; Palette (16 Controls)
              <ChevronDown
                className={cn(
                  'w-3 h-3 text-slate-400 transition-transform duration-150',
                  showSlidersBar && 'rotate-180'
                )}
              />
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetDefaults}
                title="Reset all 16 parameters, custom palette, and seed to defaults"
                className="px-2 py-0.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md text-[10px] font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                Reset Defaults
              </button>
            </div>
          </div>

          {showSlidersBar && (
            <div className="space-y-2.5">
              {/* Row A: Geometry & Spatial Composition */}
              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-x-3.5 gap-y-2">
                <SliderControl
                  label="Density"
                  value={params.density}
                  min={10}
                  max={100}
                  unit="%"
                  onChange={(v) => updateParam('density', v)}
                />
                <SliderControl
                  label="Scale"
                  value={params.scale}
                  min={40}
                  max={200}
                  unit="%"
                  onChange={(v) => updateParam('scale', v)}
                />
                <SliderControl
                  label="Rotation"
                  value={params.rotation}
                  min={0}
                  max={360}
                  unit="°"
                  onChange={(v) => updateParam('rotation', v)}
                />
                <SliderControl
                  label="Offset X"
                  value={params.offsetX}
                  min={-100}
                  max={100}
                  unit="%"
                  onChange={(v) => updateParam('offsetX', v)}
                />
                <SliderControl
                  label="Offset Y"
                  value={params.offsetY}
                  min={-100}
                  max={100}
                  unit="%"
                  onChange={(v) => updateParam('offsetY', v)}
                />
                <SliderControl
                  label="Warp / Flow"
                  value={params.warp}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(v) => updateParam('warp', v)}
                />
                <SliderControl
                  label="Line Weight"
                  value={params.lineWeight}
                  min={40}
                  max={220}
                  unit="%"
                  onChange={(v) => updateParam('lineWeight', v)}
                />
                <div className="space-y-0.5 min-w-0">
                  <label className="text-[11px] font-medium text-slate-600 block truncate">
                    Symmetry
                  </label>
                  <select
                    value={params.symmetry}
                    onChange={(e) => updateParam('symmetry', e.target.value as SymmetryMode)}
                    className="w-full px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded-md text-[11px] font-semibold text-slate-800 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="none">None</option>
                    <option value="mirror-x">Mirror X</option>
                    <option value="mirror-y">Mirror Y</option>
                    <option value="kaleido-4">Kaleido 4</option>
                  </select>
                </div>
              </div>

              {/* Row B: Lighting, Tone & Surface Optics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-x-3.5 gap-y-2">
                <SliderControl
                  label="Lighting"
                  value={params.glowIntensity}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(v) => updateParam('glowIntensity', v)}
                />
                <SliderControl
                  label="Depth"
                  value={params.depth}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(v) => updateParam('depth', v)}
                />
                <SliderControl
                  label="Saturation"
                  value={params.saturation}
                  min={0}
                  max={200}
                  unit="%"
                  onChange={(v) => updateParam('saturation', v)}
                />
                <SliderControl
                  label="Hue Shift"
                  value={params.hueShift}
                  min={-180}
                  max={180}
                  unit="°"
                  onChange={(v) => updateParam('hueShift', v)}
                />
                <SliderControl
                  label="Contrast"
                  value={params.contrast}
                  min={50}
                  max={160}
                  unit="%"
                  onChange={(v) => updateParam('contrast', v)}
                />
                <SliderControl
                  label="Brightness"
                  value={params.brightness}
                  min={60}
                  max={140}
                  unit="%"
                  onChange={(v) => updateParam('brightness', v)}
                />
                <SliderControl
                  label="Film Grain"
                  value={params.grain}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(v) => updateParam('grain', v)}
                />
                <SliderControl
                  label="Vignette"
                  value={params.vignette}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(v) => updateParam('vignette', v)}
                />
              </div>

              {/* Row C: Live 5-Color Swatch Customizer */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Active Colors:
                  </span>
                  {(
                    [
                      ['base', 'Base'],
                      ['primary', 'Primary'],
                      ['secondary', 'Secondary'],
                      ['accent', 'Accent'],
                      ['highlight', 'Highlight'],
                    ] as const
                  ).map(([slot, label]) => (
                    <label
                      key={slot}
                      className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer"
                    >
                      <input
                        type="color"
                        value={livePalette[slot]}
                        onChange={(e) => handleSwatchChange(slot, e.target.value)}
                        className="w-5 h-5 rounded border border-slate-300 cursor-pointer bg-transparent p-0"
                        title={`Customize ${label} color`}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>

                {(params.colorStyle === 'Custom Palette' || params.useCustomBaseColor) && (
                  <button
                    type="button"
                    onClick={() =>
                      setParams((prev) => ({
                        ...prev,
                        colorStyle: 'Random / AI-Curated',
                        useCustomBaseColor: false,
                      }))
                    }
                    className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                  >
                    Restore Auto Colors
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* BOTTOM IMAGE PANEL: Live Preview Stage & Full-Width Gallery */}
      <div className="space-y-4">
        {batchProgress?.active && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1 flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                <span className="truncate">{batchProgress.label}</span>
                <span className="font-mono tabular-nums ml-2 text-indigo-600">
                  {batchProgress.completed}/{batchProgress.total}
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all duration-150"
                  style={{
                    width: `${Math.max(4, Math.round((batchProgress.completed / Math.max(1, batchProgress.total)) * 100))}%`,
                  }}
                />
              </div>
            </div>
            <button
              onClick={() => batchAbortRef.current?.abort()}
              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-lg text-xs font-semibold cursor-pointer shrink-0 whitespace-nowrap"
            >
              Cancel Batch
            </button>
          </div>
        )}

        {exportProgress?.active && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1 flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs font-semibold text-indigo-950">
                <span className="truncate">{exportProgress.label}</span>
                <span className="font-mono tabular-nums ml-2">
                  {exportProgress.completed}/{exportProgress.total}
                </span>
              </div>
              <div className="w-full h-1.5 bg-indigo-200/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all duration-150"
                  style={{
                    width: `${Math.max(8, Math.round((exportProgress.completed / Math.max(1, exportProgress.total)) * 100))}%`,
                  }}
                />
              </div>
            </div>
            <button
              onClick={() => exportAbortRef.current?.abort()}
              className="px-3 py-1.5 bg-white border border-indigo-200 text-indigo-700 rounded-lg text-xs font-semibold hover:bg-indigo-100 cursor-pointer shrink-0"
            >
              Cancel Export
            </button>
          </div>
        )}

        {/* Live Stage Card */}
          <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-3.5 py-2 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
                <span className="font-bold text-slate-900">{stageMeta.resolvedCategory}</span>
                <span className="text-slate-300">·</span>
                <span className="font-medium text-slate-700">{stageMeta.styleName}</span>
                <span className="text-slate-300">·</span>
                <span className="font-medium text-indigo-700">{stageMeta.conceptTitle}</span>
                <span className="text-slate-300">·</span>
                <span className="font-mono tabular-nums text-slate-500">
                  {targetDims.width} × {targetDims.height} px ({targetDims.aspectLabel})
                </span>
                <span className="text-slate-300">·</span>
                <span className="font-mono text-slate-500">{params.seed}</span>
                <span className="text-slate-300">·</span>
                <span className="font-mono text-[11px] font-semibold text-indigo-600">
                  {stageMeta.renderModeLabel}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={handleRunStageQualityCheck}
                  className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  Quality Check
                </button>
                <button
                  onClick={() => {
                    if (!stagePreviewUrl) return;
                    setLightboxItem({
                      previewUrl: stagePreviewUrl,
                      params: cloneTechBgParams(params),
                      width: targetDims.width,
                      height: targetDims.height,
                      aspectLabel: targetDims.aspectLabel,
                      resolvedCategory: stageMeta.resolvedCategory,
                      styleName: stageMeta.styleName,
                      conceptTitle: stageMeta.conceptTitle,
                      marketDemandInsight: stageMeta.marketDemandInsight,
                      creativeRationale: stageMeta.creativeRationale,
                      id: 'STAGE',
                      qualityReport: stageQualityReport || undefined,
                    });
                  }}
                  className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 cursor-pointer"
                  title="Fullscreen preview"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                <button
                  disabled={Boolean(exportProgress?.active)}
                  onClick={() => exportSingleFullRes(params)}
                  className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export {params.resolutionPreset === 'Custom' ? `${targetDims.width}px` : params.resolutionPreset}
                </button>
              </div>
            </div>

            <div
              className="p-3 bg-slate-100/80 flex items-center justify-center"
              style={
                params.transparentBackground && stageMeta.supportsTransparency
                  ? {
                      backgroundImage:
                        'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
                      backgroundSize: '20px 20px',
                      backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                    }
                  : undefined
              }
            >
              <div
                style={{
                  ...stageAspectStyle,
                  width: `min(100%, calc(min(430px, 46vh) * ${(targetDims.width / Math.max(1, targetDims.height)).toFixed(4)}))`,
                }}
                className="relative max-w-full rounded-xl overflow-hidden border border-slate-300/70 shadow-sm flex items-center justify-center"
              >
                {stagePreviewUrl ? (
                  <img
                    src={stagePreviewUrl}
                    alt={stageMeta.conceptTitle}
                    className="w-full h-full object-contain block select-none"
                  />
                ) : (
                  <div className="w-full h-full min-h-[240px] bg-slate-900 animate-pulse" />
                )}
              </div>
            </div>

            {showQualityDrawer && stageQualityReport && (
              <div className="border-t border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-indigo-600" />
                    <span className="text-xs font-bold text-slate-900">
                      Technical Stock Quality Guidance — {stageQualityReport.overallTier}
                    </span>
                  </div>
                  <button
                    onClick={() => setShowQualityDrawer(false)}
                    className="text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {stageQualityReport.checks.map((c) => (
                    <div
                      key={c.id}
                      className="bg-white border border-slate-200 rounded-xl p-3 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-800">{c.label}</span>
                        {c.status === 'pass' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : c.status === 'review' ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        )}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-indigo-600 font-semibold">
                        {c.value}
                      </div>
                      <p className="text-[11px] text-slate-500 leading-snug">{c.guidance}</p>
                    </div>
                  ))}
                </div>

                <p className="text-[11px] text-slate-500 italic">{stageQualityReport.disclaimer}</p>
              </div>
            )}
          </section>

          {/* Gallery */}
          <section
            ref={gallerySectionRef}
            className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-slate-900">
                  Generated Gallery ({gallery.length})
                </h3>
                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
                  <button
                    onClick={() => setGalleryFilter('all')}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer',
                      galleryFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    )}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setGalleryFilter('favorites')}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer',
                      galleryFilter === 'favorites'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    )}
                  >
                    Favorites ({gallery.filter((g) => g.favorite).length})
                  </button>
                </div>
              </div>

              {gallery.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleSelectAllFiltered}
                    className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer"
                  >
                    {filteredGallery.length > 0 &&
                    filteredGallery.every((g) => selectedIds.has(g.id)) ? (
                      <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-slate-400" />
                    )}
                    Select All
                  </button>

                  {selectedIds.size > 0 && (
                    <button
                      disabled={Boolean(exportProgress?.active)}
                      onClick={handleBatchZipExport}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Package className="w-3.5 h-3.5" />
                      Download ZIP ({selectedIds.size})
                    </button>
                  )}

                  <button
                    onClick={handleClearGallery}
                    className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {filteredGallery.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <p className="text-sm font-semibold text-slate-700">
                  {gallery.length === 0
                    ? 'No generated backgrounds in your gallery yet'
                    : 'No favorites marked yet'}
                </p>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Click Regenerate or Randomize to craft a new composition, click Add to Gallery, or run a Batch Queue (+5, +10, +20, +50).
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
                {filteredGallery.map((item) => {
                  const selected = selectedIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'border rounded-xl overflow-hidden bg-slate-50/40 transition-colors flex flex-col',
                        selected ? 'border-indigo-500 ring-1 ring-indigo-500/30' : 'border-slate-200'
                      )}
                    >
                      <div
                        className="relative aspect-video bg-slate-900 overflow-hidden cursor-pointer group"
                        style={
                          item.params.transparentBackground
                            ? {
                                backgroundColor: '#f1f5f9',
                                backgroundImage:
                                  'linear-gradient(45deg, #cbd5e1 25%, transparent 25%), linear-gradient(-45deg, #cbd5e1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #cbd5e1 75%), linear-gradient(-45deg, transparent 75%, #cbd5e1 75%)',
                                backgroundSize: '16px 16px',
                                backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                              }
                            : undefined
                        }
                        onClick={() =>
                          setLightboxItem({
                            previewUrl: item.previewUrl,
                            params: cloneTechBgParams(item.params),
                            width: item.width,
                            height: item.height,
                            aspectLabel: item.aspectLabel,
                            resolvedCategory: item.resolvedCategory,
                            styleName: item.styleName,
                            conceptTitle: item.conceptTitle,
                            marketDemandInsight: item.marketDemandInsight,
                            creativeRationale: item.creativeRationale,
                            id: item.id,
                            qualityReport: item.qualityReport,
                          })
                        }
                      >
                        <img
                          src={item.previewUrl}
                          alt={item.conceptTitle}
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSelect(item.id);
                          }}
                          className="absolute top-2.5 left-2.5 p-1 rounded-md bg-white/90 hover:bg-white text-slate-800 border border-slate-200 cursor-pointer"
                          title="Select for ZIP download"
                        >
                          {selected ? (
                            <CheckSquare className="w-4 h-4 text-indigo-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500" />
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleFavorite(item.id);
                          }}
                          className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-white/90 hover:bg-white border border-slate-200 cursor-pointer"
                          title="Favorite"
                        >
                          <Heart
                            className={cn(
                              'w-3.5 h-3.5',
                              item.favorite ? 'fill-rose-500 text-rose-500' : 'text-slate-600'
                            )}
                          />
                        </button>
                      </div>

                      <div className="p-3 space-y-2.5 flex-1 flex flex-col justify-between bg-white">
                        <div>
                          <div className="text-xs font-bold text-slate-900 truncate">
                            {item.conceptTitle}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            {item.resolvedCategory}
                            {item.styleName ? ` · ${item.styleName}` : ''}
                          </div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1 flex flex-wrap items-center gap-x-1.5">
                            <span>{item.width}×{item.height}</span>
                            <span>·</span>
                            <span>{item.aspectLabel}</span>
                            <span>·</span>
                            <span>{item.id}</span>
                            <span>·</span>
                            <span className="text-slate-700">{item.params.seed}</span>
                          </div>
                          {item.qualityReport && (
                            <div className="text-[11px] text-emerald-700 font-medium mt-1">
                              Quality: {item.qualityReport.overallTier}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-100">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleRegenerateGalleryItem(item.id)}
                              title="Regenerate concept"
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleRunItemQualityCheck(item)}
                              title="Stock Quality Check"
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setParams(cloneTechBgParams(item.params))}
                              title="Load into stage"
                              className="px-2 py-1 rounded-lg hover:bg-slate-100 text-[11px] font-semibold text-slate-600 cursor-pointer"
                            >
                              Load
                            </button>
                            <button
                              onClick={() => handleDeleteGalleryItem(item.id)}
                              title="Delete"
                              className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-500 hover:text-rose-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <button
                            disabled={Boolean(exportProgress?.active)}
                            onClick={() => exportSingleFullRes(item.params, item.id)}
                            className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <Download className="w-3 h-3" />
                            Full-Res
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

      {/* Fullscreen Lightbox */}
      {lightboxItem && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex flex-col p-4 sm:p-6"
          onClick={() => setLightboxItem(null)}
        >
          <div
            className="flex flex-wrap items-center justify-between gap-3 text-white pb-3 border-b border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-sm font-bold">
                {lightboxItem.conceptTitle} · {lightboxItem.resolvedCategory}
                {lightboxItem.styleName ? ` · ${lightboxItem.styleName}` : ''}
              </div>
              <div className="text-xs text-slate-300 font-mono tabular-nums mt-0.5">
                {lightboxItem.width} × {lightboxItem.height} px · {lightboxItem.aspectLabel} ·{' '}
                {lightboxItem.params.seed}
              </div>
              {lightboxItem.marketDemandInsight && (
                <div className="text-xs text-emerald-300 mt-1">
                  {lightboxItem.marketDemandInsight}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={Boolean(exportProgress?.active)}
                onClick={() =>
                  exportSingleFullRes(
                    lightboxItem.params,
                    lightboxItem.id === 'STAGE' ? undefined : lightboxItem.id
                  )
                }
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                Download {lightboxItem.width}×{lightboxItem.height}
              </button>
              <button
                onClick={() => setLightboxItem(null)}
                className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            className="flex-1 min-h-0 flex items-center justify-center py-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightboxItem.previewUrl}
              alt={lightboxItem.conceptTitle}
              className="max-w-full max-h-full object-contain rounded-xl border border-white/15"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (val: number) => void;
}) {
  return (
    <div className="space-y-0.5 min-w-0">
      <div className="flex items-center justify-between gap-1 text-[11px]">
        <span className="font-medium text-slate-600 truncate">{label}</span>
        <span className="font-mono tabular-nums text-slate-800 font-semibold shrink-0">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
      />
    </div>
  );
}
