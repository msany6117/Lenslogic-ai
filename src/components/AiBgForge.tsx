import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import {
  Sparkles,
  ImagePlus,
  X,
  Download,
  RefreshCw,
  Dices,
  Sliders,
  Heart,
  Trash2,
  Maximize2,
  Check,
  Key,
  Layers,
  Package,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Type as TypeIcon,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import type { ApiKeyEntry } from '../types';
import {
  ASPECT_RATIOS,
  AspectRatioOption,
  ExportFormat,
  ReferenceImagePayload,
  ResolutionPreset,
  StockQualityReport,
  SymmetryMode,
  TechBgParams,
  resolveTargetDimensions,
} from '../services/techBgTypes';
import { generateRandomSeed } from '../services/techBgEngine';
import {
  ForgeBlueprint,
  ForgeFidelityMode,
  ForgeVaultItem,
  LiveTuningValues,
  exportForgeFullResolution,
  fileToForgeReference,
  forgeBlueprintToRenderParams,
  forgeRareBackgrounds,
  getOrderedUserGeminiKeys,
  renderForgeStage,
} from '../services/aiBgForgeService';
import { cn } from '../lib/utils';

interface AiBgForgeProps {
  apiKeys: ApiKeyEntry[];
  activeKeyId: string | null;
  serverGeminiReady: boolean | null;
  onOpenSettings: () => void;
}

type InputMode = 'prompt' | 'reference';

const FAST_PREVIEW_EDGE = 720;
const CRISP_PREVIEW_EDGE = 1240;

const DEFAULT_TUNE: LiveTuningValues = {
  density: 60,
  scale: 100,
  rotation: 35,
  offsetX: 0,
  offsetY: 0,
  warp: 45,
  lineWeight: 100,
  symmetry: 'none',
  glowIntensity: 62,
  depth: 72,
  contrast: 106,
  brightness: 100,
  saturation: 105,
  hueShift: 0,
  grain: 10,
  vignette: 18,
  transparentBackground: false,
};

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function slugify(str: string): string {
  return (
    str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 42) || 'background'
  );
}

export default function AiBgForge({
  apiKeys,
  activeKeyId,
  serverGeminiReady,
  onOpenSettings,
}: AiBgForgeProps) {
  const { keys: userGeminiKeys } = useMemo(
    () => getOrderedUserGeminiKeys(apiKeys, activeKeyId),
    [apiKeys, activeKeyId]
  );

  // Clear Dual-Mode Switcher: Prompt vs Reference Image
  const [inputMode, setInputMode] = useState<InputMode>('prompt');
  const [prompt, setPrompt] = useState('');
  const [refNote, setRefNote] = useState('');
  const [referenceImage, setReferenceImage] = useState<ReferenceImagePayload | null>(null);
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const refInputRef = useRef<HTMLInputElement | null>(null);

  // Clean Output Settings
  const [fidelityMode, setFidelityMode] = useState<ForgeFidelityMode>('exact-elevated');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('16:9');
  const [resolutionPreset, setResolutionPreset] = useState<ResolutionPreset>('4K');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [conceptCount, setConceptCount] = useState<number>(1);
  const [seed, setSeed] = useState<string>(() => generateRandomSeed());

  // Full Live Shader & Geometry Tuning
  const [tune, setTune] = useState<LiveTuningValues>(DEFAULT_TUNE);
  const [paletteColors, setPaletteColors] = useState<{
    base: string;
    primary: string;
    secondary: string;
    accent: string;
    highlight: string;
  } | null>(null);

  // Generated Candidates
  const [candidates, setCandidates] = useState<
    Array<{ blueprint: ForgeBlueprint; seed: string }>
  >([]);
  const [activeCandidateIdx, setActiveCandidateIdx] = useState<number>(0);

  const activeCandidate = candidates[activeCandidateIdx] || null;
  const activeBlueprint = activeCandidate?.blueprint || null;

  // Stage Canvas & Zoom/Pan State
  const stageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestRenderedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasRenderedFrame, setHasRenderedFrame] = useState(false);
  const [renderWarning, setRenderWarning] = useState<string | null>(null);
  const [qualityReport, setQualityReport] = useState<StockQualityReport | null>(null);
  const [showQualityPanel, setShowQualityPanel] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refineText, setRefineText] = useState('');

  // Inline Preview Zoom & Fullscreen Modal Zoom/Pan
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const hasRenderedFrameRef = useRef(false);
  hasRenderedFrameRef.current = hasRenderedFrame;

  const [isFullView, setIsFullView] = useState(false);
  const [fullViewUrl, setFullViewUrl] = useState<string>('');
  const [fullZoom, setFullZoom] = useState<number>(1);
  const [fullPan, setFullPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullPanning, setIsFullPanning] = useState(false);
  const fullPanStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const fullViewportRef = useRef<HTMLDivElement | null>(null);

  // Saved Gallery
  const [gallery, setGallery] = useState<ForgeVaultItem[]>([]);
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'favorites'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isZipExporting, setIsZipExporting] = useState(false);

  const genAbortRef = useRef<AbortController | null>(null);
  const renderAbortRef = useRef<AbortController | null>(null);
  const crispTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentRenderParams = useMemo<TechBgParams | null>(() => {
    if (!activeBlueprint) return null;
    return forgeBlueprintToRenderParams(activeBlueprint, {
      ...tune,
      aspectRatio: aspectRatio === 'Custom' ? '16:9' : aspectRatio,
      resolutionPreset: resolutionPreset === 'Custom' ? '4K' : resolutionPreset,
      seed,
      customBaseColor: paletteColors?.base,
      customPalette: paletteColors
        ? {
            primary: paletteColors.primary,
            secondary: paletteColors.secondary,
            accent: paletteColors.accent,
            highlight: paletteColors.highlight,
          }
        : undefined,
    });
  }, [activeBlueprint, aspectRatio, resolutionPreset, seed, tune, paletteColors]);

  const targetDims = useMemo(() => {
    if (currentRenderParams) return resolveTargetDimensions(currentRenderParams);
    return resolveTargetDimensions(
      forgeBlueprintToRenderParams(
        {
          conceptTitle: 'Background',
          marketDemandInsight: '',
          creativeRationale: '',
          resolvedCategory: 'Background Generator',
          styleName: 'Custom',
          renderMode: 'glsl',
          supportsTransparency: false,
          negativeSpaceZone: 'center-halo',
          focalX: 0.5,
          focalY: 0.5,
          lightAngleDeg: 35,
          geometryScale: 1,
          densityFactor: 0.6,
          glowFactor: 0.6,
          depthFactor: 0.7,
          paletteBase: '#070b14',
          palettePrimary: '#1e3a8a',
          paletteSecondary: '#0284c7',
          paletteAccent: '#38bdf8',
          paletteHighlight: '#f0f9ff',
        },
        {
          ...tune,
          aspectRatio,
          resolutionPreset,
          seed,
        }
      )
    );
  }, [currentRenderParams, aspectRatio, resolutionPreset, seed, tune]);

  // Global clipboard paste automatically switches to Reference Image mode & loads pasted image
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            try {
              const payload = await fileToForgeReference(file);
              setReferenceImage(payload);
              setInputMode('reference');
              setErrorMsg(null);
            } catch (err: any) {
              setErrorMsg(err?.message || 'Could not paste reference image.');
            }
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // Close Full View modal on Escape
  useEffect(() => {
    if (!isFullView) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullView(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullView]);

  // Non-passive wheel listener for inline preview zoom
  useEffect(() => {
    const el = stageViewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!hasRenderedFrameRef.current) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      setZoom((z) => {
        const next = Math.min(4, Math.max(0.5, Number((z + delta).toFixed(2))));
        if (next <= 1) setPan({ x: 0, y: 0 });
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [activeBlueprint, isGenerating]);

  // Non-passive wheel listener for fullscreen preview zoom
  useEffect(() => {
    if (!isFullView || !fullViewUrl) return;
    const el = fullViewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.2 : -0.2;
      setFullZoom((z) => {
        const next = Math.min(5, Math.max(0.25, Number((z + delta).toFixed(2))));
        if (next <= 1) setFullPan({ x: 0, y: 0 });
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isFullView, fullViewUrl]);

  // Window-level drag tracking for inline & fullscreen pan so leaving viewport never drops capture
  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      if (!panStartRef.current) return;
      setPan({
        x: panStartRef.current.px + (e.clientX - panStartRef.current.x),
        y: panStartRef.current.py + (e.clientY - panStartRef.current.y),
      });
    };
    const onUp = () => {
      setIsPanning(false);
      panStartRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isPanning]);

  useEffect(() => {
    if (!isFullPanning) return;
    const onMove = (e: MouseEvent) => {
      if (!fullPanStartRef.current) return;
      setFullPan({
        x: fullPanStartRef.current.px + (e.clientX - fullPanStartRef.current.x),
        y: fullPanStartRef.current.py + (e.clientY - fullPanStartRef.current.y),
      });
    };
    const onUp = () => {
      setIsFullPanning(false);
      fullPanStartRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isFullPanning]);

  const drawCanvasToStage = useCallback((sourceCanvas: HTMLCanvasElement) => {
    latestRenderedCanvasRef.current = sourceCanvas;
    const target = stageCanvasRef.current;
    if (!target) return;
    if (target.width !== sourceCanvas.width) target.width = sourceCanvas.width;
    if (target.height !== sourceCanvas.height) target.height = sourceCanvas.height;
    const ctx = target.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.drawImage(sourceCanvas, 0, 0);
    }
    setHasRenderedFrame(true);
  }, []);

  // Two-pass ultra-smooth live rendering:
  // Immediate fast pass (720px) on parameter drag + automatic crisp pass (1240px) once settled
  useEffect(() => {
    if (!activeBlueprint || !currentRenderParams) return;

    renderAbortRef.current?.abort();
    if (crispTimerRef.current) clearTimeout(crispTimerRef.current);

    const controller = new AbortController();
    renderAbortRef.current = controller;

    const runRender = async () => {
      setRenderWarning(null);
      try {
        const fastRes = await renderForgeStage(
          activeBlueprint,
          currentRenderParams,
          FAST_PREVIEW_EDGE,
          userGeminiKeys,
          controller.signal,
          true
        );
        if (controller.signal.aborted) return;
        drawCanvasToStage(fastRes.canvas);
        setRenderWarning(fastRes.renderWarning || null);
        if (fastRes.repairedGlslCode) activeBlueprint.glslCode = fastRes.repairedGlslCode;
        if (fastRes.repairedCanvasCode) activeBlueprint.canvasCode = fastRes.repairedCanvasCode;

        crispTimerRef.current = setTimeout(async () => {
          if (controller.signal.aborted) return;
          try {
            const crispRes = await renderForgeStage(
              activeBlueprint,
              currentRenderParams,
              CRISP_PREVIEW_EDGE,
              userGeminiKeys,
              controller.signal,
              false
            );
            if (controller.signal.aborted) return;
            drawCanvasToStage(crispRes.canvas);
            setRenderWarning(crispRes.renderWarning || null);
            if (crispRes.repairedGlslCode) activeBlueprint.glslCode = crispRes.repairedGlslCode;
            if (crispRes.repairedCanvasCode) activeBlueprint.canvasCode = crispRes.repairedCanvasCode;
            if (crispRes.qualityReport) setQualityReport(crispRes.qualityReport);
          } catch (err: any) {
            if (err?.name !== 'AbortError') {
              setRenderWarning(err?.message || 'High-detail preview update failed.');
            }
          }
        }, 160);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setRenderWarning(err?.message || 'Preview render failed.');
        }
      }
    };

    const rafId = requestAnimationFrame(() => {
      runRender();
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (crispTimerRef.current) clearTimeout(crispTimerRef.current);
      controller.abort();
    };
  }, [activeBlueprint, currentRenderParams, userGeminiKeys, drawCanvasToStage]);

  const applyBlueprintSelection = useCallback((bp: ForgeBlueprint, nextSeed?: string) => {
    setSeed(nextSeed || generateRandomSeed());
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setTune({
      ...DEFAULT_TUNE,
      density: Math.round((bp.densityFactor ?? 0.6) * 100),
      scale: Math.round((bp.geometryScale ?? 1.0) * 100),
      rotation: Math.round(bp.lightAngleDeg ?? 35) % 360,
      glowIntensity: Math.round((bp.glowFactor ?? 0.6) * 100),
      depth: Math.round((bp.depthFactor ?? 0.7) * 100),
    });
    setPaletteColors({
      base: bp.paletteBase || '#070b14',
      primary: bp.palettePrimary || '#1e3a8a',
      secondary: bp.paletteSecondary || '#0284c7',
      accent: bp.paletteAccent || '#38bdf8',
      highlight: bp.paletteHighlight || '#f0f9ff',
    });
  }, []);

  const handleReferenceFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please choose a valid image file (PNG, JPG, WebP, or SVG).');
      return;
    }
    try {
      const payload = await fileToForgeReference(file);
      setReferenceImage(payload);
      setErrorMsg(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to read reference image.');
    }
  }, []);

  const handleGenerate = async () => {
    if (inputMode === 'prompt' && !prompt.trim()) {
      setErrorMsg('Describe the background you want to create.');
      return;
    }
    if (inputMode === 'reference' && !referenceImage) {
      setErrorMsg('Upload or paste a reference image first.');
      return;
    }

    genAbortRef.current?.abort();
    const controller = new AbortController();
    genAbortRef.current = controller;

    setIsGenerating(true);
    setErrorMsg(null);

    try {
      const { blueprints } = await forgeRareBackgrounds({
        prompt: inputMode === 'prompt' ? prompt : refNote,
        referenceImage: inputMode === 'reference' ? referenceImage : undefined,
        fidelityMode: inputMode === 'reference' ? fidelityMode : 'exact-elevated',
        aspectLabel: aspectRatio,
        count: conceptCount,
        apiKeys: userGeminiKeys,
        signal: controller.signal,
      });

      const items = blueprints.map((bp) => ({
        blueprint: bp,
        seed: generateRandomSeed(),
      }));

      setCandidates(items);
      setActiveCandidateIdx(0);
      applyBlueprintSelection(items[0].blueprint, items[0].seed);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorMsg(err?.message || 'Generation failed.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsGenerating(false);
      }
    }
  };

  const handleRefine = async (customInstruction?: string) => {
    if (!activeBlueprint) return;
    const instruction = (customInstruction ?? refineText).trim();
    if (!instruction) return;

    genAbortRef.current?.abort();
    const controller = new AbortController();
    genAbortRef.current = controller;

    setIsRefining(true);
    setErrorMsg(null);

    try {
      const { blueprints } = await forgeRareBackgrounds({
        prompt: inputMode === 'prompt' ? prompt : refNote,
        referenceImage: inputMode === 'reference' ? referenceImage : undefined,
        fidelityMode,
        aspectLabel: aspectRatio,
        count: 1,
        apiKeys: userGeminiKeys,
        previousBlueprint: activeBlueprint,
        refineInstruction: instruction,
        signal: controller.signal,
      });

      const updatedBp = blueprints[0];
      const nextSeed = generateRandomSeed();
      setCandidates((prev) =>
        prev.map((item, idx) =>
          idx === activeCandidateIdx ? { blueprint: updatedBp, seed: nextSeed } : item
        )
      );
      applyBlueprintSelection(updatedBp, nextSeed);
      if (!customInstruction) setRefineText('');
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorMsg(err?.message || 'Refinement failed.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsRefining(false);
      }
    }
  };

  const openFullPreview = () => {
    const canvas = latestRenderedCanvasRef.current || stageCanvasRef.current;
    if (!canvas) return;
    setFullViewUrl(canvas.toDataURL('image/png'));
    setFullZoom(1);
    setFullPan({ x: 0, y: 0 });
    setIsFullView(true);
  };

  const handleDownloadFullRes = async () => {
    if (!currentRenderParams || !activeBlueprint) return;
    setIsExporting(true);
    setErrorMsg(null);
    try {
      const { blob, width, height } = await exportForgeFullResolution(
        currentRenderParams,
        exportFormat,
        exportFormat === 'png' ? 100 : 94,
        userGeminiKeys
      );
      const ext = exportFormat === 'jpeg' ? 'jpg' : exportFormat;
      triggerBlobDownload(
        blob,
        `${slugify(activeBlueprint.conceptTitle)}_${width}x${height}.${ext}`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveToGallery = () => {
    const canvas = latestRenderedCanvasRef.current || stageCanvasRef.current;
    if (!activeBlueprint || !currentRenderParams || !canvas) return;
    const item: ForgeVaultItem = {
      id: `bg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      previewUrl: canvas.toDataURL('image/png'),
      blueprint: { ...activeBlueprint },
      params: { ...currentRenderParams, customPalette: { ...currentRenderParams.customPalette } },
      width: targetDims.width,
      height: targetDims.height,
      aspectLabel: targetDims.aspectLabel,
      favorite: false,
      qualityReport: qualityReport || undefined,
    };
    setGallery((prev) => [item, ...prev]);
  };

  const handleBatchZipExport = async () => {
    const targets =
      selectedIds.size > 0 ? gallery.filter((v) => selectedIds.has(v.id)) : gallery;
    if (targets.length === 0) return;

    setIsZipExporting(true);
    setErrorMsg(null);
    try {
      const zip = new JSZip();
      for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        const { blob, width, height } = await exportForgeFullResolution(
          item.params,
          exportFormat,
          exportFormat === 'png' ? 100 : 94,
          userGeminiKeys
        );
        const ext = exportFormat === 'jpeg' ? 'jpg' : exportFormat;
        zip.file(
          `${String(i + 1).padStart(2, '0')}_${slugify(item.blueprint.conceptTitle)}_${width}x${height}.${ext}`,
          blob
        );
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      triggerBlobDownload(zipBlob, `backgrounds-${Date.now().toString(36)}.zip`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'ZIP export failed.');
    } finally {
      setIsZipExporting(false);
    }
  };

  const filteredGallery = useMemo(
    () => (galleryFilter === 'favorites' ? gallery.filter((v) => v.favorite) : gallery),
    [gallery, galleryFilter]
  );

  const hasAnyGeminiKey = userGeminiKeys.length > 0 || serverGeminiReady === true;
  const canGenerate =
    inputMode === 'prompt' ? Boolean(prompt.trim()) : Boolean(referenceImage);

  return (
    <div className="space-y-6">
      {/* Minimal Clean Header */}
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Background Generator
        </h2>

        {!hasAnyGeminiKey && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 rounded-xl text-xs font-bold flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Key className="w-3.5 h-3.5" />
            Add Gemini API Key
          </button>
        )}
      </header>

      {/* Focused Mode-Separated Creation Panel */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
        {/* Clear 2-Mode Toggle */}
        <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200/80">
          <button
            type="button"
            onClick={() => {
              setInputMode('prompt');
              setErrorMsg(null);
            }}
            className={cn(
              'px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap shrink-0 cursor-pointer',
              inputMode === 'prompt'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <TypeIcon className="w-3.5 h-3.5 text-indigo-600" />
            Prompt
          </button>

          <button
            type="button"
            onClick={() => {
              setInputMode('reference');
              setErrorMsg(null);
            }}
            className={cn(
              'px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap shrink-0 cursor-pointer',
              inputMode === 'reference'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <ImagePlus className="w-3.5 h-3.5 text-indigo-600" />
            Reference Image
          </button>
        </div>

        {/* Mode 1: Pure Prompt Input */}
        {inputMode === 'prompt' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700">
                Describe your background
              </label>
              {prompt && (
                <button
                  type="button"
                  onClick={() => setPrompt('')}
                  className="text-xs font-medium text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Dark obsidian fluted glass waves with warm gold rim lighting and clean left space for headlines"
              rows={3}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white transition-colors resize-none leading-relaxed"
            />
          </div>
        ) : (
          /* Mode 2: Dedicated Reference Image Input */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            <input
              ref={refInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleReferenceFile(e.target.files?.[0])}
              className="hidden"
            />

            <div className="lg:col-span-7">
              {referenceImage ? (
                <div className="h-full border border-slate-200 rounded-xl bg-slate-50 p-3 flex items-center gap-4">
                  <div className="w-36 h-24 rounded-lg overflow-hidden border border-slate-200 bg-slate-900 shrink-0">
                    <img
                      src={referenceImage.previewUrl}
                      alt="Reference"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-xs font-bold text-slate-800">Reference image loaded</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => refInputRef.current?.click()}
                        className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
                      >
                        Change Image
                      </button>
                      <button
                        type="button"
                        onClick={() => setReferenceImage(null)}
                        className="px-3 py-1.5 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg text-xs font-semibold text-rose-600 cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => refInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') refInputRef.current?.click();
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingRef(true);
                  }}
                  onDragLeave={() => setIsDraggingRef(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingRef(false);
                    handleReferenceFile(e.dataTransfer.files?.[0]);
                  }}
                  className={cn(
                    'h-full min-h-[116px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-4 text-center transition-colors cursor-pointer',
                    isDraggingRef
                      ? 'border-indigo-500 bg-indigo-50/40'
                      : 'border-slate-300 bg-slate-50 hover:border-indigo-400'
                  )}
                >
                  <ImagePlus className="w-5 h-5 text-indigo-600 mb-1.5" />
                  <p className="text-xs font-bold text-slate-800">
                    Drop reference image, browse, or press Ctrl+V
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Creates a similar-style unique background with code
                  </p>
                </div>
              )}
            </div>

            <div className="lg:col-span-5 flex flex-col justify-between gap-2.5">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 block">
                  Variation Style
                </label>
                <select
                  value={fidelityMode}
                  onChange={(e) => setFidelityMode(e.target.value as ForgeFidelityMode)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="exact-elevated">Similar Style + Unique Variation</option>
                  <option value="fusion">Blend Reference + Custom Note</option>
                  <option value="rare-evolution">Creative Evolution</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 block">
                  Optional Note
                </label>
                <input
                  type="text"
                  value={refNote}
                  onChange={(e) => setRefNote(e.target.value)}
                  placeholder="e.g. brighter highlights, calmer center"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Minimal Output Controls & Generate Button */}
        <div className="pt-4 border-t border-slate-100 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Aspect Ratio
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as AspectRatioOption)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {ASPECT_RATIOS.filter((r) => r !== 'Custom').map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ratio}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Resolution
              </label>
              <select
                value={resolutionPreset}
                onChange={(e) => setResolutionPreset(e.target.value as ResolutionPreset)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="4K">4K Ultra HD</option>
                <option value="8K">8K Master</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Format
              </label>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="png">PNG Lossless</option>
                <option value="jpeg">JPEG 94%</option>
                <option value="webp">WebP</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Outputs
              </label>
              <select
                value={conceptCount}
                onChange={(e) => setConceptCount(Number(e.target.value))}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value={1}>1 Design</option>
                <option value={2}>2 Variations</option>
                <option value={3}>3 Variations</option>
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating || !canGenerate}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate
              </>
            )}
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-rose-500 hover:text-rose-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </section>

      {/* Main Stage + Full Live Tuning Workspace */}
      {!activeBlueprint && !isGenerating ? (
        <section className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-2">
          <p className="text-sm font-bold text-slate-800">
            {inputMode === 'prompt'
              ? 'Write a prompt above and click Generate'
              : 'Upload or paste a reference image above and click Generate'}
          </p>
          <p className="text-xs text-slate-500">
            Every background renders dynamically at full 4K or 8K resolution with live color and geometry tuning.
          </p>
        </section>
      ) : (
        <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left: Full Interactive Preview Canvas with Zoom In / Out + Fullscreen */}
          <div className="xl:col-span-7 bg-white border border-slate-200 rounded-2xl p-4 space-y-3.5">
            {candidates.length > 1 && (
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3 overflow-x-auto">
                {candidates.map((cand, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setActiveCandidateIdx(idx);
                      applyBlueprintSelection(cand.blueprint, cand.seed);
                    }}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                      idx === activeCandidateIdx
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    )}
                  >
                    #{idx + 1} {cand.blueprint.conceptTitle}
                  </button>
                ))}
              </div>
            )}

            {/* Preview Toolbar: Title + Zoom Controls + Full View */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 truncate">
                  {activeBlueprint?.conceptTitle || 'Generating...'}
                </h3>
                <p className="text-[11px] font-mono tabular-nums text-slate-500">
                  {targetDims.width.toLocaleString()} × {targetDims.height.toLocaleString()} px
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setZoom((z) => {
                      const next = Math.max(0.5, Number((z - 0.25).toFixed(2)));
                      if (next <= 1) setPan({ x: 0, y: 0 });
                      return next;
                    });
                  }}
                  disabled={!hasRenderedFrame}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  disabled={!hasRenderedFrame}
                  className="px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[11px] font-mono font-bold tabular-nums text-slate-700 disabled:opacity-40 cursor-pointer"
                  title="Reset Zoom to 100%"
                >
                  {Math.round(zoom * 100)}%
                </button>

                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3.5, Number((z + 0.25).toFixed(2))))}
                  disabled={!hasRenderedFrame}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={openFullPreview}
                  disabled={!hasRenderedFrame}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                  title="Open Full View"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  Full View
                </button>
              </div>
            </div>

            {/* Interactive Zoomable & Pannable Canvas Viewport */}
            <div
              ref={stageViewportRef}
              onMouseDown={(e) => {
                if (zoom <= 1) return;
                setIsPanning(true);
                panStartRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
              }}
              className={cn(
                'relative w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-950 flex items-center justify-center min-h-[380px] max-h-[640px] select-none',
                zoom > 1 ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
              )}
            >
              {isGenerating ? (
                <div className="py-24 text-center space-y-3">
                  <RefreshCw className="w-7 h-7 animate-spin text-indigo-400 mx-auto" />
                  <p className="text-xs font-semibold text-slate-200">Creating background...</p>
                </div>
              ) : (
                <canvas
                  ref={stageCanvasRef}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center center',
                  }}
                  className="max-w-full max-h-[620px] w-auto h-auto object-contain block transition-transform duration-75"
                />
              )}

              {isRefining && !isGenerating && (
                <div className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-slate-900/85 text-white text-[11px] font-semibold flex items-center gap-1.5 backdrop-blur-sm">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Updating...
                </div>
              )}
            </div>

            {renderWarning && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                {renderWarning}
              </div>
            )}

            {/* Quick Refine & Export Actions */}
            <div className="pt-1 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-1 min-w-[220px] gap-2">
                <input
                  type="text"
                  value={refineText}
                  onChange={(e) => setRefineText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRefine();
                  }}
                  placeholder="Quick tweak (e.g. softer light, cooler tone)"
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => handleRefine()}
                  disabled={isRefining || !refineText.trim()}
                  className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Refine
                </button>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowQualityPanel((v) => !v)}
                  disabled={!qualityReport}
                  className={cn(
                    'px-3 py-2 border rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer',
                    showQualityPanel
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                  )}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Quality
                </button>

                <button
                  type="button"
                  onClick={handleSaveToGallery}
                  disabled={!hasRenderedFrame || isGenerating}
                  className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 text-indigo-600" />
                  Save
                </button>

                <button
                  type="button"
                  onClick={handleDownloadFullRes}
                  disabled={!currentRenderParams || isExporting || isGenerating}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isExporting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  Download {resolutionPreset}
                </button>
              </div>
            </div>

            {showQualityPanel && qualityReport && (
              <div className="border-t border-slate-100 pt-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span>{qualityReport.overallTier}</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {qualityReport.megapixels} MP
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {qualityReport.checks.map((c) => (
                    <div key={c.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 text-[11px] space-y-0.5">
                      <div className="flex items-center justify-between gap-2 font-semibold text-slate-700">
                        <span className="flex items-center gap-1.5">
                          {c.status === 'pass' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          )}
                          {c.label}
                        </span>
                        <span className="font-mono tabular-nums text-slate-500">{c.value}</span>
                      </div>
                      <p className="text-slate-500">{c.guidance}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Complete Live Shader & Geometry Tuning Panel */}
          <div className="xl:col-span-5 bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Live Shader &amp; Geometry Tuning
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSeed(generateRandomSeed())}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 flex items-center gap-1 cursor-pointer"
                  title="Randomize Seed"
                >
                  <Dices className="w-3.5 h-3.5 text-indigo-600" />
                  Seed
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTune(DEFAULT_TUNE);
                    if (activeBlueprint) {
                      setPaletteColors({
                        base: activeBlueprint.paletteBase || '#070b14',
                        primary: activeBlueprint.palettePrimary || '#1e3a8a',
                        secondary: activeBlueprint.paletteSecondary || '#0284c7',
                        accent: activeBlueprint.paletteAccent || '#38bdf8',
                        highlight: activeBlueprint.paletteHighlight || '#f0f9ff',
                      });
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-700 flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>
            </div>

            {/* Live Palette Colors */}
            {paletteColors && (
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-slate-600 block">Colors</span>
                <div className="grid grid-cols-5 gap-2">
                  {(
                    [
                      ['base', 'Base'],
                      ['primary', 'Primary'],
                      ['secondary', 'Second'],
                      ['accent', 'Accent'],
                      ['highlight', 'Highlight'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="space-y-1 cursor-pointer block">
                      <input
                        type="color"
                        value={paletteColors[key]}
                        onChange={(e) =>
                          setPaletteColors((prev) => (prev ? { ...prev, [key]: e.target.value } : prev))
                        }
                        className="w-full h-8 rounded-lg border border-slate-200 cursor-pointer p-0.5 bg-white"
                      />
                      <span className="block text-[10px] font-semibold text-slate-500 text-center">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Geometry & Position Controls */}
            <div className="space-y-2.5 pt-2 border-t border-slate-100">
              <span className="text-[11px] font-bold text-slate-600 block">Geometry &amp; Framing</span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                {(
                  [
                    ['scale', 'Scale / Zoom', 45, 195, '%'],
                    ['density', 'Density / Detail', 10, 100, '%'],
                    ['rotation', 'Rotation', 0, 360, '°'],
                    ['warp', 'Warp / Flow', 0, 100, '%'],
                    ['offsetX', 'Offset X', -100, 100, '%'],
                    ['offsetY', 'Offset Y', -100, 100, '%'],
                    ['lineWeight', 'Line Weight', 40, 220, '%'],
                    ['depth', 'Depth', 0, 100, '%'],
                  ] as const
                ).map(([field, label, min, max, unit]) => (
                  <div key={field} className="space-y-1">
                    <div className="flex justify-between text-[11px] font-medium text-slate-600">
                      <span>{label}</span>
                      <span className="font-mono tabular-nums text-indigo-600 font-semibold">
                        {tune[field]}
                        {unit}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      value={tune[field]}
                      onChange={(e) =>
                        setTune((prev) => ({ ...prev, [field]: Number(e.target.value) }))
                      }
                      className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                    />
                  </div>
                ))}
              </div>

              {/* Symmetry & Transparency */}
              <div className="grid grid-cols-2 gap-3 pt-1.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-600 block">Symmetry</label>
                  <select
                    value={tune.symmetry}
                    onChange={(e) =>
                      setTune((prev) => ({ ...prev, symmetry: e.target.value as SymmetryMode }))
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="none">None</option>
                    <option value="mirror-x">Mirror X</option>
                    <option value="mirror-y">Mirror Y</option>
                    <option value="kaleido-4">Kaleido 4-Way</option>
                  </select>
                </div>

                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={tune.transparentBackground}
                      disabled={!activeBlueprint?.supportsTransparency}
                      onChange={(e) =>
                        setTune((prev) => ({ ...prev, transparentBackground: e.target.checked }))
                      }
                      className="w-3.5 h-3.5 accent-indigo-600 rounded cursor-pointer disabled:opacity-40"
                    />
                    <span className={!activeBlueprint?.supportsTransparency ? 'text-slate-400' : ''}>
                      Transparent BG
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Lighting, Color & Texture Finish */}
            <div className="space-y-2.5 pt-2 border-t border-slate-100">
              <span className="text-[11px] font-bold text-slate-600 block">Lighting &amp; Finish</span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                {(
                  [
                    ['glowIntensity', 'Lighting / Glow', 0, 100, '%'],
                    ['contrast', 'Contrast', 55, 160, '%'],
                    ['brightness', 'Brightness', 65, 135, '%'],
                    ['saturation', 'Saturation', 0, 190, '%'],
                    ['hueShift', 'Hue Shift', -180, 180, '°'],
                    ['grain', 'Film Grain', 0, 100, '%'],
                    ['vignette', 'Vignette', 0, 100, '%'],
                  ] as const
                ).map(([field, label, min, max, unit]) => (
                  <div key={field} className="space-y-1">
                    <div className="flex justify-between text-[11px] font-medium text-slate-600">
                      <span>{label}</span>
                      <span className="font-mono tabular-nums text-indigo-600 font-semibold">
                        {tune[field]}
                        {unit}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      value={tune[field]}
                      onChange={(e) =>
                        setTune((prev) => ({ ...prev, [field]: Number(e.target.value) }))
                      }
                      className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Saved Creations Gallery */}
      {gallery.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-slate-900">
                Saved Backgrounds <span className="font-mono tabular-nums text-slate-400">({gallery.length})</span>
              </h3>
              <div className="flex items-center gap-1">
                {(['all', 'favorites'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setGalleryFilter(tab)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                      galleryFilter === tab ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                    )}
                  >
                    {tab === 'all' ? 'All' : 'Favorites'}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={handleBatchZipExport}
              disabled={isZipExporting}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isZipExporting ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Package className="w-3.5 h-3.5" />
              )}
              Export {selectedIds.size > 0 ? `${selectedIds.size} Selected` : 'All'} ZIP
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredGallery.map((item) => {
              const isSelected = selectedIds.has(item.id);
              return (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-xl border overflow-hidden bg-slate-50 transition-colors',
                    isSelected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200'
                  )}
                >
                  <div
                    className="relative aspect-video bg-slate-950 cursor-pointer overflow-hidden group"
                    onClick={() => {
                      setFullViewUrl(item.previewUrl);
                      setFullZoom(1);
                      setFullPan({ x: 0, y: 0 });
                      setIsFullView(true);
                    }}
                  >
                    <img
                      src={item.previewUrl}
                      alt={item.blueprint.conceptTitle}
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                    />
                  </div>

                  <div className="p-3 bg-white flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {item.blueprint.conceptTitle}
                      </p>
                      <p className="text-[10px] font-mono tabular-nums text-slate-500">
                        {item.width}×{item.height} px
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setCandidates([{ blueprint: item.blueprint, seed: item.params.seed }]);
                          setActiveCandidateIdx(0);
                          applyBlueprintSelection(item.blueprint, item.params.seed);
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          })
                        }
                        className={cn(
                          'p-1.5 rounded-lg border text-xs cursor-pointer',
                          isSelected
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                        )}
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setGallery((prev) =>
                            prev.map((v) => (v.id === item.id ? { ...v, favorite: !v.favorite } : v))
                          )
                        }
                        className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
                      >
                        <Heart
                          className={cn(
                            'w-3.5 h-3.5',
                            item.favorite ? 'fill-rose-500 text-rose-500' : 'text-slate-400'
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => setGallery((prev) => prev.filter((v) => v.id !== item.id))}
                        className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Full-Screen Inspection Modal with Zoom In / Out & Drag Pan */}
      {isFullView && fullViewUrl && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col"
          onClick={() => setIsFullView(false)}
        >
          <div
            className="px-5 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-4 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-white min-w-0">
              <span className="text-sm font-bold truncate">
                {activeBlueprint?.conceptTitle || 'Full Preview'}
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                {targetDims.width.toLocaleString()} × {targetDims.height.toLocaleString()} px
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setFullZoom((z) => {
                    const next = Math.max(0.25, Number((z - 0.25).toFixed(2)));
                    if (next <= 1) setFullPan({ x: 0, y: 0 });
                    return next;
                  });
                }}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setFullZoom(1);
                  setFullPan({ x: 0, y: 0 });
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono font-bold tabular-nums text-white cursor-pointer"
              >
                {Math.round(fullZoom * 100)}%
              </button>

              <button
                type="button"
                onClick={() => setFullZoom((z) => Math.min(5, Number((z + 0.25).toFixed(2))))}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsFullView(false)}
                className="ml-2 p-2 rounded-lg bg-slate-800 hover:bg-rose-600 text-white cursor-pointer"
                title="Close Full View"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            ref={fullViewportRef}
            className="flex-1 overflow-hidden flex items-center justify-center p-4 select-none"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
              if (fullZoom <= 1) return;
              setIsFullPanning(true);
              fullPanStartRef.current = { x: e.clientX, y: e.clientY, px: fullPan.x, py: fullPan.y };
            }}
          >
            <img
              src={fullViewUrl}
              alt={activeBlueprint?.conceptTitle || 'Full Preview'}
              draggable={false}
              style={{
                transform: `translate(${fullPan.x}px, ${fullPan.y}px) scale(${fullZoom})`,
                transformOrigin: 'center center',
              }}
              className={cn(
                'max-w-full max-h-full object-contain transition-transform duration-75',
                fullZoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}
