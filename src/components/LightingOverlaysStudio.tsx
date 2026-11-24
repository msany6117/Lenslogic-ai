import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import {
  Sun,
  Sparkles,
  Dices,
  Download,
  Heart,
  Trash2,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Plus,
  Copy,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Layers,
  Sliders,
  Monitor,
  Package,
  Move,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Check,
  X,
  RefreshCw,
} from 'lucide-react';
import {
  LightingOverlayDoc,
  OVERLAY_ASPECT_RATIOS,
  OVERLAY_CATEGORY_OPTIONS,
  OVERLAY_LAYER_TYPE_OPTIONS,
  OverlayAspectRatio,
  OverlayBackgroundMode,
  OverlayCategory,
  OverlayExportFormat,
  OverlayLayerConfig,
  OverlayLayerType,
  OverlayPreviewBackdrop,
  OverlayResolutionPreset,
  SavedOverlayItem,
  cloneOverlayDoc,
  createDefaultLayer,
  makeOverlayLayerId,
  resolveOverlayDimensions,
} from '../services/lightingOverlayTypes';
import {
  exportOverlayBlob,
  generateOverlaySeedCode,
  generateRandomOverlayDoc,
  renderOverlayToCanvas,
} from '../services/lightingOverlayEngine';
import { analyzeStockQuality } from '../services/techBgQuality';
import type { StockQualityReport } from '../services/techBgTypes';
import { cn } from '../lib/utils';

type InspectorTab = 'layers' | 'scene' | 'export';

const FAST_PREVIEW_EDGE = 740;
const CRISP_PREVIEW_EDGE = 1260;

const CHECKERBOARD_STYLE: React.CSSProperties = {
  backgroundColor: '#1e293b',
  backgroundImage:
    'linear-gradient(45deg, #334155 25%, transparent 25%), linear-gradient(-45deg, #334155 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #334155 75%), linear-gradient(-45deg, transparent 75%, #334155 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
};

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

function slugify(str: string): string {
  return (
    str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 42) || 'lighting-overlay'
  );
}

export default function LightingOverlaysStudio() {
  const [doc, setDoc] = useState<LightingOverlayDoc>(() =>
    generateRandomOverlayDoc('anamorphic-flare')
  );
  const [selectedLayerId, setSelectedLayerId] = useState<string>(() => '');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('layers');
  const [exportFormat, setExportFormat] = useState<OverlayExportFormat>('png');
  const [exportQuality, setExportQuality] = useState<number>(96);

  // Stage interaction state
  const [showOriginPins, setShowOriginPins] = useState<boolean>(true);
  const [draggingPinLayerId, setDraggingPinLayerId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const zoomRef = useRef<number>(zoom);
  zoomRef.current = zoom;

  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const stageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestRenderedRef = useRef<HTMLCanvasElement | null>(null);

  // Full view modal
  const [isFullView, setIsFullView] = useState<boolean>(false);
  const [fullViewUrl, setFullViewUrl] = useState<string>('');
  const [fullZoom, setFullZoom] = useState<number>(1);
  const [fullPan, setFullPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullPanning, setIsFullPanning] = useState<boolean>(false);
  const fullPanStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const fullViewportRef = useRef<HTMLDivElement | null>(null);

  // Technical Quality report
  const [qualityReport, setQualityReport] = useState<StockQualityReport | null>(null);
  const [showQualityPanel, setShowQualityPanel] = useState<boolean>(false);

  // Export & Batch status
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState<boolean>(false);
  const [isZipExporting, setIsZipExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [batchMenuOpen, setBatchMenuOpen] = useState<boolean>(false);
  const [addLayerOpen, setAddLayerOpen] = useState<boolean>(false);
  const batchMenuRef = useRef<HTMLDivElement | null>(null);
  const addLayerRef = useRef<HTMLDivElement | null>(null);

  // Saved Overlays Gallery
  const [gallery, setGallery] = useState<SavedOverlayItem[]>([]);
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'favorites'>('all');
  const [selectedGalleryIds, setSelectedGalleryIds] = useState<Set<string>>(new Set());

  // Ensure selectedLayerId stays valid
  useEffect(() => {
    if (!doc.layers.length) return;
    if (!doc.layers.some((l) => l.id === selectedLayerId)) {
      setSelectedLayerId(doc.layers[0].id);
    }
  }, [doc.layers, selectedLayerId]);

  const activeLayer = useMemo(
    () => doc.layers.find((l) => l.id === selectedLayerId) || doc.layers[0] || null,
    [doc.layers, selectedLayerId]
  );

  const dims = useMemo(() => resolveOverlayDimensions(doc), [doc]);
  const megapixels = useMemo(
    () => Number(((dims.width * dims.height) / 1_000_000).toFixed(1)),
    [dims]
  );

  const effectiveBackdrop: 'checkerboard' | 'black' | 'charcoal' = useMemo(() => {
    if (doc.previewBackdrop === 'auto') {
      return doc.backgroundMode === 'transparent' ? 'checkerboard' : 'black';
    }
    return doc.previewBackdrop;
  }, [doc.previewBackdrop, doc.backgroundMode]);

  // Paint rendered canvas cleanly onto visible stage canvas
  const paintToStage = useCallback((rendered: HTMLCanvasElement) => {
    latestRenderedRef.current = rendered;
    const stage = stageCanvasRef.current;
    if (!stage) return;
    if (stage.width !== rendered.width || stage.height !== rendered.height) {
      stage.width = rendered.width;
      stage.height = rendered.height;
    }
    const ctx = stage.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, stage.width, stage.height);
      ctx.drawImage(rendered, 0, 0);
    }
  }, []);

  // Fast interactive preview + debounced crisp pass
  useEffect(() => {
    let cancelled = false;
    const fastTimer = setTimeout(() => {
      if (cancelled) return;
      const fastCanvas = renderOverlayToCanvas(doc, {
        previewMaxEdge: FAST_PREVIEW_EDGE,
        fastMode: true,
      });
      if (!cancelled) {
        paintToStage(fastCanvas);
      }
    }, 10);

    const crispTimer = setTimeout(() => {
      if (cancelled) return;
      const crispCanvas = renderOverlayToCanvas(doc, {
        previewMaxEdge: CRISP_PREVIEW_EDGE,
        fastMode: false,
      });
      if (!cancelled) {
        paintToStage(crispCanvas);
        if (showQualityPanel) {
          setQualityReport(
            analyzeStockQuality(
              crispCanvas,
              dims.width,
              dims.height,
              doc.backgroundMode === 'transparent'
            )
          );
        }
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(fastTimer);
      clearTimeout(crispTimer);
    };
  }, [doc, dims.width, dims.height, paintToStage, showQualityPanel]);

  // ============================================================================
  // Handlers
  // ============================================================================

  const updateLayer = useCallback(
    (layerId: string, patch: Partial<OverlayLayerConfig>) => {
      setDoc((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)),
      }));
    },
    []
  );

  const handleRandomize = useCallback(
    (targetCategory?: OverlayCategory) => {
      const cat = targetCategory ?? doc.category;
      const next = generateRandomOverlayDoc(cat, {
        aspectRatio: doc.aspectRatio,
        customRatioW: doc.customRatioW,
        customRatioH: doc.customRatioH,
        resolutionPreset: doc.resolutionPreset,
        customWidth: doc.customWidth,
        customHeight: doc.customHeight,
        backgroundMode: doc.backgroundMode,
        previewBackdrop: doc.previewBackdrop,
      });
      setDoc(next);
      if (next.layers[0]) setSelectedLayerId(next.layers[0].id);
    },
    [
      doc.category,
      doc.aspectRatio,
      doc.customRatioW,
      doc.customRatioH,
      doc.resolutionPreset,
      doc.customWidth,
      doc.customHeight,
      doc.backgroundMode,
      doc.previewBackdrop,
    ]
  );

  const handleAddLayer = (type: OverlayLayerType) => {
    const newLayer = createDefaultLayer(type);
    setDoc((prev) => ({
      ...prev,
      layers: [...prev.layers, newLayer],
    }));
    setSelectedLayerId(newLayer.id);
    setAddLayerOpen(false);
    setInspectorTab('layers');
  };

  const handleDuplicateLayer = (layer: OverlayLayerConfig) => {
    const copy: OverlayLayerConfig = {
      ...layer,
      id: makeOverlayLayerId(),
      name: `${layer.name} Copy`,
      x: Number(Math.min(0.95, layer.x + 0.05).toFixed(2)),
      y: Number(Math.min(0.95, layer.y + 0.05).toFixed(2)),
      seed: Math.floor(1000 + Math.random() * 99999),
    };
    setDoc((prev) => ({
      ...prev,
      layers: [...prev.layers, copy],
    }));
    setSelectedLayerId(copy.id);
  };

  const handleDeleteLayer = (layerId: string) => {
    setDoc((prev) => {
      if (prev.layers.length <= 1) return prev;
      return {
        ...prev,
        layers: prev.layers.filter((l) => l.id !== layerId),
      };
    });
  };

  const handleMoveLayer = (layerId: string, dir: -1 | 1) => {
    setDoc((prev) => {
      const idx = prev.layers.findIndex((l) => l.id === layerId);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.layers.length) return prev;
      const next = [...prev.layers];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return { ...prev, layers: next };
    });
  };

  const handleResetSceneDefaults = () => {
    setDoc((prev) => ({
      ...prev,
      masterExposure: 105,
      masterContrast: 104,
      masterSaturation: 108,
      temperature: 0,
      chromaticAberration: 12,
      edgeFade: prev.backgroundMode === 'transparent' ? 0 : 28,
      grain: 8,
    }));
  };

  // Draggable Origin Pins directly on preview stage
  const updateOriginFromPointer = useCallback((clientX: number, clientY: number, layerId: string) => {
    const stage = stageCanvasRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = Math.max(-0.2, Math.min(1.2, (clientX - rect.left) / rect.width));
    const ny = Math.max(-0.2, Math.min(1.2, (clientY - rect.top) / rect.height));
    updateLayer(layerId, {
      x: Number(nx.toFixed(3)),
      y: Number(ny.toFixed(3)),
    });
  }, [updateLayer]);

  // Non-passive wheel zoom for inline stage
  useEffect(() => {
    const el = stageViewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && zoomRef.current <= 1 && e.deltaY > 0) return;
      e.preventDefault();
      setZoom((z) => {
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        const nz = Math.max(1, Math.min(4, Number((z + delta).toFixed(2))));
        if (nz <= 1) setPan({ x: 0, y: 0 });
        return nz;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Non-passive wheel zoom for fullscreen view
  useEffect(() => {
    if (!isFullView) return;
    const el = fullViewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setFullZoom((z) => {
        const nz = Math.max(0.5, Math.min(5, Number((z + (e.deltaY < 0 ? 0.15 : -0.15)).toFixed(2))));
        if (nz <= 1) setFullPan({ x: 0, y: 0 });
        return nz;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isFullView]);

  // Window-level drag tracking for pin dragging and panning
  useEffect(() => {
    if (!draggingPinLayerId && !isPanning) return;
    const onMove = (e: MouseEvent) => {
      if (draggingPinLayerId) {
        updateOriginFromPointer(e.clientX, e.clientY, draggingPinLayerId);
        return;
      }
      if (isPanning && panStartRef.current) {
        setPan({
          x: panStartRef.current.px + (e.clientX - panStartRef.current.x),
          y: panStartRef.current.py + (e.clientY - panStartRef.current.y),
        });
      }
    };
    const onUp = () => {
      setDraggingPinLayerId(null);
      setIsPanning(false);
      panStartRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingPinLayerId, isPanning, updateOriginFromPointer]);

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

  // Close menus & full view on outside click or Escape
  useEffect(() => {
    if (!batchMenuOpen && !addLayerOpen && !isFullView) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (batchMenuOpen && batchMenuRef.current && target && !batchMenuRef.current.contains(target)) {
        setBatchMenuOpen(false);
      }
      if (addLayerOpen && addLayerRef.current && target && !addLayerRef.current.contains(target)) {
        setAddLayerOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBatchMenuOpen(false);
        setAddLayerOpen(false);
        setIsFullView(false);
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [batchMenuOpen, addLayerOpen, isFullView]);

  const handleStageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingPinLayerId) return;
    if (zoom <= 1) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };

  const handleSaveToGallery = () => {
    const thumbCanvas = renderOverlayToCanvas(doc, { previewMaxEdge: 640, fastMode: false });
    const previewUrl = thumbCanvas.toDataURL('image/png');
    const item: SavedOverlayItem = {
      id: `ov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      previewUrl,
      doc: cloneOverlayDoc(doc),
      width: dims.width,
      height: dims.height,
      favorite: false,
    };
    setGallery((prev) => [item, ...prev]);
  };

  const handleBatchGenerate = async (count: number) => {
    setBatchMenuOpen(false);
    setIsBatchGenerating(true);
    setExportError(null);
    try {
      const created: SavedOverlayItem[] = [];
      for (let i = 0; i < count; i++) {
        const nextDoc = generateRandomOverlayDoc(doc.category, {
          aspectRatio: doc.aspectRatio,
          customRatioW: doc.customRatioW,
          customRatioH: doc.customRatioH,
          resolutionPreset: doc.resolutionPreset,
          customWidth: doc.customWidth,
          customHeight: doc.customHeight,
          backgroundMode: doc.backgroundMode,
          previewBackdrop: doc.previewBackdrop,
        });
        const thumbCanvas = renderOverlayToCanvas(nextDoc, {
          previewMaxEdge: 640,
          fastMode: false,
        });
        const previewUrl = thumbCanvas.toDataURL('image/png');
        const resolved = resolveOverlayDimensions(nextDoc);
        created.push({
          id: `ov_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          createdAt: Date.now() + i,
          previewUrl,
          doc: nextDoc,
          width: resolved.width,
          height: resolved.height,
          favorite: false,
        });
        // Yield periodically so UI stays crisp
        if (i % 2 === 1) await new Promise((r) => setTimeout(r, 12));
      }
      setGallery((prev) => [...created, ...prev]);
      if (created[0]) {
        setDoc(cloneOverlayDoc(created[0].doc));
        if (created[0].doc.layers[0]) setSelectedLayerId(created[0].doc.layers[0].id);
      }
    } catch (err: any) {
      setExportError(err?.message || 'Batch overlay generation failed.');
    } finally {
      setIsBatchGenerating(false);
    }
  };

  const handleDownloadCurrent = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const { blob, width, height } = await exportOverlayBlob(doc, exportFormat, exportQuality);
      const ext = exportFormat === 'jpeg' ? 'jpg' : exportFormat;
      const modeTag = doc.backgroundMode === 'transparent' ? 'alpha' : 'screen';
      const filename = `${slugify(doc.title)}_${doc.resolutionPreset}_${width}x${height}_${modeTag}.${ext}`;
      triggerDownload(blob, filename);
    } catch (err: any) {
      setExportError(err?.message || 'Overlay export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleBulkZipExport = async () => {
    const targets =
      selectedGalleryIds.size > 0
        ? gallery.filter((g) => selectedGalleryIds.has(g.id))
        : gallery;
    if (targets.length === 0) return;
    setIsZipExporting(true);
    setExportError(null);
    try {
      const zip = new JSZip();
      const ext = exportFormat === 'jpeg' ? 'jpg' : exportFormat;
      for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        const { blob, width, height } = await exportOverlayBlob(
          item.doc,
          exportFormat,
          exportQuality
        );
        const modeTag = item.doc.backgroundMode === 'transparent' ? 'alpha' : 'screen';
        zip.file(
          `${String(i + 1).padStart(2, '0')}_${slugify(item.doc.title)}_${width}x${height}_${modeTag}.${ext}`,
          blob
        );
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      triggerDownload(zipBlob, `Lighting_Overlays_${doc.resolutionPreset}_Pack.zip`);
    } catch (err: any) {
      setExportError(err?.message || 'ZIP pack export failed.');
    } finally {
      setIsZipExporting(false);
    }
  };

  const handleOpenFullView = () => {
    const canvas = latestRenderedRef.current;
    if (!canvas) return;
    setFullViewUrl(canvas.toDataURL('image/png'));
    setFullZoom(1);
    setFullPan({ x: 0, y: 0 });
    setIsFullView(true);
  };

  const handleRunQualityCheck = () => {
    const next = !showQualityPanel;
    setShowQualityPanel(next);
    if (next && latestRenderedRef.current) {
      setQualityReport(
        analyzeStockQuality(
          latestRenderedRef.current,
          dims.width,
          dims.height,
          doc.backgroundMode === 'transparent'
        )
      );
    }
  };

  const visibleGallery = useMemo(
    () => (galleryFilter === 'favorites' ? gallery.filter((g) => g.favorite) : gallery),
    [gallery, galleryFilter]
  );

  return (
    <div className="space-y-5">
      {/* Header & Top Category Strip */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
            Lighting Overlays
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Procedural optical lens flares, god rays, lightning, light leaks, prism &amp; bokeh overlays up to 8K.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleRandomize()}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Dices className="w-3.5 h-3.5" />
            Randomize
          </button>

          {/* Batch Pack Generator Menu */}
          <div ref={batchMenuRef} className="relative">
            <button
              type="button"
              disabled={isBatchGenerating}
              onClick={() => setBatchMenuOpen((o) => !o)}
              className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {isBatchGenerating ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
              ) : (
                <Package className="w-3.5 h-3.5 text-indigo-600" />
              )}
              {isBatchGenerating ? 'Generating Pack...' : 'Generate Pack'}
            </button>

            {batchMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-48 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 z-40">
                {[4, 8, 12].map((qty) => (
                  <button
                    key={qty}
                    type="button"
                    onClick={() => handleBatchGenerate(qty)}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 flex items-center justify-between cursor-pointer"
                  >
                    <span>Generate {qty} Unique</span>
                    <span className="text-[10px] font-mono text-slate-400">{doc.resolutionPreset}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleSaveToGallery}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            Save to Gallery
          </button>

          <button
            type="button"
            disabled={isExporting}
            onClick={handleDownloadCurrent}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {isExporting ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>
              {isExporting
                ? `Rendering ${doc.resolutionPreset}...`
                : `Export ${doc.resolutionPreset} ${exportFormat.toUpperCase()}`}
            </span>
          </button>
        </div>
      </header>

      {exportError && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{exportError}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportError(null)}
            className="text-rose-500 hover:text-rose-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Overlay Category Quick Generator Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2 shadow-xs flex items-center gap-1.5 overflow-x-auto">
        {OVERLAY_CATEGORY_OPTIONS.map((cat) => {
          const active = doc.category === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => handleRandomize(cat.id)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0',
                active
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              )}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Main Studio Grid: Stage Left + Inspector Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT STAGE */}
        <div className="lg:col-span-7 space-y-3">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            {/* Stage Toolbar */}
            <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Sun className="w-4 h-4 text-indigo-600 shrink-0" />
                <input
                  type="text"
                  value={doc.title}
                  onChange={(e) => setDoc((prev) => ({ ...prev, title: e.target.value }))}
                  className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none border-b border-transparent focus:border-indigo-500 min-w-0 flex-1 truncate"
                />
                <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap shrink-0 tabular-nums">
                  {dims.width}×{dims.height}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {/* Screen vs Transparent Quick Switch */}
                <button
                  type="button"
                  onClick={() =>
                    setDoc((prev) => ({
                      ...prev,
                      backgroundMode: prev.backgroundMode === 'black' ? 'transparent' : 'black',
                    }))
                  }
                  className={cn(
                    'px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0',
                    doc.backgroundMode === 'transparent'
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  )}
                  title="Switch between Pure Black (Screen blend) and Transparent PNG Alpha"
                >
                  {doc.backgroundMode === 'transparent' ? 'Alpha PNG' : 'Black Screen'}
                </button>

                {/* Origin Handle Toggle */}
                <button
                  type="button"
                  onClick={() => setShowOriginPins((v) => !v)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0',
                    showOriginPins
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  )}
                  title="Drag light origin handles directly on preview"
                >
                  <Move className="w-3 h-3" />
                  Pins
                </button>

                {/* Quality Check Toggle */}
                <button
                  type="button"
                  onClick={handleRunQualityCheck}
                  className={cn(
                    'px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0',
                    showQualityPanel
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <ShieldCheck className="w-3 h-3" />
                  Quality
                </button>

                {/* Inline Zoom & Full View */}
                <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setZoom((z) => {
                        const nz = Math.max(1, Number((z - 0.25).toFixed(2)));
                        if (nz <= 1) setPan({ x: 0, y: 0 });
                        return nz;
                      });
                    }}
                    className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
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
                    className="px-1.5 text-[10px] font-mono font-semibold text-slate-700 cursor-pointer tabular-nums"
                    title="Reset Zoom"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
                    className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleOpenFullView}
                  className="p-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-600 hover:text-slate-900 cursor-pointer"
                  title="Fullscreen Preview"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Interactive Canvas Viewport */}
            <div
              ref={stageViewportRef}
              onMouseDown={handleStageMouseDown}
              className={cn(
                'relative w-full min-h-[380px] max-h-[560px] flex items-center justify-center overflow-hidden p-4 select-none',
                zoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''
              )}
              style={
                effectiveBackdrop === 'checkerboard'
                  ? CHECKERBOARD_STYLE
                  : {
                      backgroundColor: effectiveBackdrop === 'charcoal' ? '#18181b' : '#050507',
                    }
              }
            >
              <div
                className="relative flex items-center justify-center transition-transform duration-75"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  aspectRatio: `${dims.width} / ${dims.height}`,
                  maxWidth: '100%',
                  maxHeight: '510px',
                  width: dims.width >= dims.height ? '100%' : 'auto',
                  height: dims.height > dims.width ? '500px' : 'auto',
                }}
              >
                <canvas
                  ref={stageCanvasRef}
                  className="w-full h-full object-contain rounded-lg shadow-md border border-white/10"
                />

                {/* Interactive Light Origin Handles */}
                {showOriginPins &&
                  doc.layers.map((layer, index) => {
                    if (!layer.enabled) return null;
                    const isSelected = layer.id === activeLayer?.id;
                    const leftPct = `${layer.x * 100}%`;
                    const topPct = `${layer.y * 100}%`;
                    return (
                      <button
                        key={layer.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setSelectedLayerId(layer.id);
                          setDraggingPinLayerId(layer.id);
                        }}
                        style={{ left: leftPct, top: topPct }}
                        title={`${layer.name} (${Math.round(layer.x * 100)}%, ${Math.round(layer.y * 100)}%) — Drag to reposition`}
                        className={cn(
                          'absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full border text-[9px] font-mono font-bold flex items-center justify-center cursor-move transition-transform shadow-md',
                          isSelected
                            ? 'bg-indigo-600 text-white border-white scale-110 ring-2 ring-indigo-300'
                            : 'bg-slate-900/75 text-white/90 border-white/60 hover:scale-110'
                        )}
                      >
                        {index + 1}
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* Bottom Stage Bar */}
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <div className="flex items-center gap-3">
                <span className="font-mono font-semibold text-slate-700 tabular-nums">
                  {dims.aspectLabel} • {megapixels} MP
                </span>
                <span>
                  {doc.layers.filter((l) => l.enabled).length} / {doc.layers.length} active layers
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-slate-500">Seed: {doc.globalSeed}</span>
                <button
                  type="button"
                  onClick={() =>
                    setDoc((prev) => ({ ...prev, globalSeed: generateOverlaySeedCode() }))
                  }
                  className="text-indigo-600 hover:text-indigo-700 font-semibold cursor-pointer"
                >
                  Re-seed
                </button>
              </div>
            </div>
          </div>

          {/* Quality Analysis Card (when toggled) */}
          {showQualityPanel && qualityReport && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  <h4 className="text-xs font-bold text-slate-900">
                    Optical Quality Check — {qualityReport.overallTier}
                  </h4>
                </div>
                <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {qualityReport.dimensionsLabel}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {qualityReport.checks.map((chk) => (
                  <div
                    key={chk.id}
                    className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-slate-800">{chk.label}</span>
                      {chk.status === 'pass' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      )}
                    </div>
                    <p className="text-[10px] font-mono text-indigo-600">{chk.value}</p>
                    <p className="text-[10px] text-slate-500 leading-snug">{chk.guidance}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT INSPECTOR PANEL */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          {/* Inspector Tabs */}
          <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50/80 p-1.5 gap-1">
            <button
              type="button"
              onClick={() => setInspectorTab('layers')}
              className={cn(
                'py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap',
                inspectorTab === 'layers'
                  ? 'bg-white text-indigo-700 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <Layers className="w-3.5 h-3.5" />
              Layers ({doc.layers.length})
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab('scene')}
              className={cn(
                'py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap',
                inspectorTab === 'scene'
                  ? 'bg-white text-indigo-700 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <Sliders className="w-3.5 h-3.5" />
              Scene &amp; Color
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab('export')}
              className={cn(
                'py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap',
                inspectorTab === 'export'
                  ? 'bg-white text-indigo-700 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <Monitor className="w-3.5 h-3.5" />
              Size &amp; Export
            </button>
          </div>

          <div className="p-4 space-y-5 max-h-[760px] overflow-y-auto custom-scrollbar">
            {/* ==================== TAB 1: LAYERS & FULL CONTROLS ==================== */}
            {inspectorTab === 'layers' && (
              <>
                {/* Layer Stack */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Optical Layer Stack
                    </span>
                    <div ref={addLayerRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setAddLayerOpen((o) => !o)}
                        className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Plus className="w-3 h-3" />
                        Add Layer
                      </button>
                      {addLayerOpen && (
                        <div className="absolute right-0 mt-1.5 w-56 bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 z-40 max-h-72 overflow-y-auto">
                          {OVERLAY_LAYER_TYPE_OPTIONS.map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => handleAddLayer(opt.id)}
                              className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 cursor-pointer"
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {doc.layers.map((layer, index) => {
                      const selected = layer.id === activeLayer?.id;
                      return (
                        <div
                          key={layer.id}
                          onClick={() => setSelectedLayerId(layer.id)}
                          className={cn(
                            'flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl border transition-all cursor-pointer',
                            selected
                              ? 'bg-indigo-50/70 border-indigo-300'
                              : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100/70'
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="w-5 h-5 rounded-md bg-white border border-slate-200 text-[10px] font-mono font-bold text-slate-700 flex items-center justify-center shrink-0">
                              {index + 1}
                            </span>
                            <span
                              className="w-3 h-3 rounded-full border border-slate-300 shrink-0"
                              style={{ backgroundColor: layer.colorPrimary }}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-slate-800 truncate">
                                {layer.name}
                              </p>
                              <p className="text-[10px] text-slate-500 font-mono tabular-nums">
                                {layer.opacity}% • {layer.blendMode}
                              </p>
                            </div>
                          </div>

                          <div
                            className="flex items-center gap-0.5 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                updateLayer(layer.id, { enabled: !layer.enabled })
                              }
                              className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                              title={layer.enabled ? 'Hide Layer' : 'Show Layer'}
                            >
                              {layer.enabled ? (
                                <Eye className="w-3.5 h-3.5" />
                              ) : (
                                <EyeOff className="w-3.5 h-3.5 text-slate-300" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveLayer(layer.id, -1)}
                              disabled={index === 0}
                              className="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-30 cursor-pointer"
                              title="Move Up"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveLayer(layer.id, 1)}
                              disabled={index === doc.layers.length - 1}
                              className="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-30 cursor-pointer"
                              title="Move Down"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateLayer(layer)}
                              className="p-1 text-slate-500 hover:text-indigo-600 cursor-pointer"
                              title="Duplicate Layer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={doc.layers.length <= 1}
                              onClick={() => handleDeleteLayer(layer.id)}
                              className="p-1 text-slate-500 hover:text-rose-600 disabled:opacity-30 cursor-pointer"
                              title="Delete Layer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Selected Layer Complete Controls */}
                {activeLayer && (
                  <div className="pt-4 border-t border-slate-200 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Active Layer Properties
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateLayer(activeLayer.id, {
                            seed: Math.floor(1000 + Math.random() * 999999),
                          })
                        }
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Dices className="w-3 h-3" />
                        New Variant
                      </button>
                    </div>

                    {/* Layer Type, Blend Mode, Iris Blades */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="sm:col-span-3">
                        <label className="text-[10px] font-bold text-slate-600 block mb-1">
                          Optical Engine Type
                        </label>
                        <select
                          value={activeLayer.type}
                          onChange={(e) => {
                            const nextType = e.target.value as OverlayLayerType;
                            const nextLabel =
                              OVERLAY_LAYER_TYPE_OPTIONS.find((o) => o.id === nextType)?.label ||
                              activeLayer.name;
                            updateLayer(activeLayer.id, { type: nextType, name: nextLabel });
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
                        >
                          {OVERLAY_LAYER_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-600 block mb-1">
                          Blend Mode
                        </label>
                        <select
                          value={activeLayer.blendMode}
                          onChange={(e) =>
                            updateLayer(activeLayer.id, {
                              blendMode: e.target.value as OverlayLayerConfig['blendMode'],
                            })
                          }
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
                        >
                          <option value="lighter">Additive (Glow)</option>
                          <option value="screen">Screen (Soft)</option>
                          <option value="normal">Normal</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-600 block mb-1">
                          Aperture Shape
                        </label>
                        <select
                          value={activeLayer.apertureBlades}
                          onChange={(e) =>
                            updateLayer(activeLayer.id, {
                              apertureBlades: Number(e.target.value) as 0 | 5 | 6 | 8,
                            })
                          }
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
                        >
                          <option value={0}>Circle</option>
                          <option value={5}>Pentagon (5)</option>
                          <option value={6}>Hexagon (6)</option>
                          <option value={8}>Octagon (8)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-600 block mb-1">
                          Layer Name
                        </label>
                        <input
                          type="text"
                          value={activeLayer.name}
                          onChange={(e) =>
                            updateLayer(activeLayer.id, { name: e.target.value })
                          }
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    {/* Colors */}
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { key: 'colorPrimary', label: 'Primary' },
                          { key: 'colorSecondary', label: 'Secondary' },
                          { key: 'colorCore', label: 'Core Glow' },
                        ] as const
                      ).map((c) => (
                        <div
                          key={c.key}
                          className="p-2 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1"
                        >
                          <span className="text-[10px] font-bold text-slate-600 block">
                            {c.label}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={activeLayer[c.key]}
                              onChange={(e) =>
                                updateLayer(activeLayer.id, { [c.key]: e.target.value })
                              }
                              className="w-6 h-6 rounded border border-slate-300 cursor-pointer bg-transparent shrink-0"
                            />
                            <input
                              type="text"
                              value={activeLayer[c.key]}
                              onChange={(e) =>
                                updateLayer(activeLayer.id, { [c.key]: e.target.value })
                              }
                              className="w-full bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10px] font-mono text-slate-700"
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* All Geometry & Optical Sliders */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      <SliderControl
                        label="Opacity"
                        value={activeLayer.opacity}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={(v) => updateLayer(activeLayer.id, { opacity: v })}
                      />
                      <SliderControl
                        label="Scale / Size"
                        value={activeLayer.scale}
                        min={15}
                        max={300}
                        unit="%"
                        onChange={(v) => updateLayer(activeLayer.id, { scale: v })}
                      />
                      <SliderControl
                        label="Origin X"
                        value={Math.round(activeLayer.x * 100)}
                        min={-20}
                        max={120}
                        unit="%"
                        onChange={(v) => updateLayer(activeLayer.id, { x: v / 100 })}
                      />
                      <SliderControl
                        label="Origin Y"
                        value={Math.round(activeLayer.y * 100)}
                        min={-20}
                        max={120}
                        unit="%"
                        onChange={(v) => updateLayer(activeLayer.id, { y: v / 100 })}
                      />
                      <SliderControl
                        label="Rotation / Angle"
                        value={activeLayer.angle}
                        min={0}
                        max={360}
                        unit="°"
                        onChange={(v) => updateLayer(activeLayer.id, { angle: v })}
                      />
                      <SliderControl
                        label="Spread / Cone"
                        value={activeLayer.spread}
                        min={5}
                        max={100}
                        unit="%"
                        onChange={(v) => updateLayer(activeLayer.id, { spread: v })}
                      />
                      <SliderControl
                        label="Stretch X"
                        value={activeLayer.stretchX}
                        min={25}
                        max={400}
                        unit="%"
                        onChange={(v) => updateLayer(activeLayer.id, { stretchX: v })}
                      />
                      <SliderControl
                        label="Stretch Y"
                        value={activeLayer.stretchY}
                        min={25}
                        max={400}
                        unit="%"
                        onChange={(v) => updateLayer(activeLayer.id, { stretchY: v })}
                      />
                      <SliderControl
                        label="Count / Density"
                        value={activeLayer.count}
                        min={1}
                        max={120}
                        unit=""
                        onChange={(v) => updateLayer(activeLayer.id, { count: v })}
                      />
                      <SliderControl
                        label="Sharpness"
                        value={activeLayer.sharpness}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={(v) => updateLayer(activeLayer.id, { sharpness: v })}
                      />
                      <SliderControl
                        label="Chaos / Forks"
                        value={activeLayer.chaos}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={(v) => updateLayer(activeLayer.id, { chaos: v })}
                      />
                      <SliderControl
                        label="Prism Dispersion"
                        value={activeLayer.dispersion}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={(v) => updateLayer(activeLayer.id, { dispersion: v })}
                      />
                      <SliderControl
                        label="Glow Softness"
                        value={activeLayer.softness}
                        min={5}
                        max={100}
                        unit="%"
                        onChange={(v) => updateLayer(activeLayer.id, { softness: v })}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ==================== TAB 2: SCENE & MASTER COLOR ==================== */}
            {inspectorTab === 'scene' && (
              <div className="space-y-5">
                {/* Background Output Mode */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                    Overlay Output Mode
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setDoc((prev) => ({
                          ...prev,
                          backgroundMode: 'black',
                          edgeFade: prev.edgeFade === 0 ? 28 : prev.edgeFade,
                        }))
                      }
                      className={cn(
                        'p-3 rounded-xl border text-left transition-all cursor-pointer',
                        doc.backgroundMode === 'black'
                          ? 'bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                      )}
                    >
                      <p className="text-xs font-bold text-slate-900">Pure Black (Screen)</p>
                      <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                        Pro stock standard for Photoshop/Premiere Screen blend mode.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDoc((prev) => ({
                          ...prev,
                          backgroundMode: 'transparent',
                          edgeFade: 0,
                        }))
                      }
                      className={cn(
                        'p-3 rounded-xl border text-left transition-all cursor-pointer',
                        doc.backgroundMode === 'transparent'
                          ? 'bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                      )}
                    >
                      <p className="text-xs font-bold text-slate-900">Transparent Alpha PNG</p>
                      <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                        Clean un-premultiplied transparency ready to drag-and-drop.
                      </p>
                    </button>
                  </div>
                </div>

                {/* Stage Backdrop */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                    Preview Backdrop
                  </span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        { id: 'auto', label: 'Auto' },
                        { id: 'checkerboard', label: 'Checker' },
                        { id: 'black', label: 'Black' },
                        { id: 'charcoal', label: 'Charcoal' },
                      ] as Array<{ id: OverlayPreviewBackdrop; label: string }>
                    ).map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() =>
                          setDoc((prev) => ({ ...prev, previewBackdrop: b.id }))
                        }
                        className={cn(
                          'py-1.5 rounded-lg border text-xs font-semibold cursor-pointer',
                          doc.previewBackdrop === b.id
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        )}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Master Color & Optical Post-Process */}
                <div className="pt-3 border-t border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Master Color &amp; Optics
                    </span>
                    <button
                      type="button"
                      onClick={handleResetSceneDefaults}
                      className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reset Master
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                    <SliderControl
                      label="Master Exposure"
                      value={doc.masterExposure}
                      min={40}
                      max={200}
                      unit="%"
                      onChange={(v) => setDoc((prev) => ({ ...prev, masterExposure: v }))}
                    />
                    <SliderControl
                      label="Master Contrast"
                      value={doc.masterContrast}
                      min={60}
                      max={160}
                      unit="%"
                      onChange={(v) => setDoc((prev) => ({ ...prev, masterContrast: v }))}
                    />
                    <SliderControl
                      label="Saturation"
                      value={doc.masterSaturation}
                      min={0}
                      max={200}
                      unit="%"
                      onChange={(v) => setDoc((prev) => ({ ...prev, masterSaturation: v }))}
                    />
                    <SliderControl
                      label="Color Temperature"
                      value={doc.temperature}
                      min={-100}
                      max={100}
                      unit=""
                      onChange={(v) => setDoc((prev) => ({ ...prev, temperature: v }))}
                    />
                    <SliderControl
                      label="Chromatic Aberration"
                      value={doc.chromaticAberration}
                      min={0}
                      max={100}
                      unit="%"
                      onChange={(v) => setDoc((prev) => ({ ...prev, chromaticAberration: v }))}
                    />
                    <SliderControl
                      label="Seamless Edge Fade"
                      value={doc.edgeFade}
                      min={0}
                      max={100}
                      unit="%"
                      onChange={(v) => setDoc((prev) => ({ ...prev, edgeFade: v }))}
                    />
                    <SliderControl
                      label="Anti-Banding Grain"
                      value={doc.grain}
                      min={0}
                      max={60}
                      unit="%"
                      onChange={(v) => setDoc((prev) => ({ ...prev, grain: v }))}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ==================== TAB 3: SIZE, 4K/6K/8K & EXPORT ==================== */}
            {inspectorTab === 'export' && (
              <div className="space-y-5">
                {/* Aspect Ratio Selector */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                    Aspect Ratio
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {OVERLAY_ASPECT_RATIOS.map((ar) => (
                      <button
                        key={ar}
                        type="button"
                        onClick={() =>
                          setDoc((prev) => ({ ...prev, aspectRatio: ar as OverlayAspectRatio }))
                        }
                        className={cn(
                          'py-1.5 px-2 rounded-xl border text-xs font-bold font-mono cursor-pointer transition-all',
                          doc.aspectRatio === ar
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        )}
                      >
                        {ar}
                      </button>
                    ))}
                  </div>

                  {doc.aspectRatio === 'Custom' && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 block mb-1">
                          Ratio Width
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={64}
                          value={doc.customRatioW}
                          onChange={(e) =>
                            setDoc((prev) => ({
                              ...prev,
                              customRatioW: Math.max(1, Number(e.target.value) || 1),
                            }))
                          }
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 block mb-1">
                          Ratio Height
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={64}
                          value={doc.customRatioH}
                          onChange={(e) =>
                            setDoc((prev) => ({
                              ...prev,
                              customRatioH: Math.max(1, Number(e.target.value) || 1),
                            }))
                          }
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Resolution Preset (4K / 6K / 8K / Custom) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Output Resolution
                    </span>
                    <span className="text-[11px] font-mono font-bold text-indigo-600 tabular-nums">
                      {dims.width} × {dims.height} px ({megapixels} MP)
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(['4K', '6K', '8K', 'Custom'] as OverlayResolutionPreset[]).map((res) => (
                      <button
                        key={res}
                        type="button"
                        onClick={() =>
                          setDoc((prev) => ({ ...prev, resolutionPreset: res }))
                        }
                        className={cn(
                          'py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all',
                          doc.resolutionPreset === res
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        )}
                      >
                        {res}
                      </button>
                    ))}
                  </div>

                  {doc.resolutionPreset === 'Custom' && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 block mb-1">
                          Width (px)
                        </label>
                        <input
                          type="number"
                          min={320}
                          max={12000}
                          step={10}
                          value={doc.customWidth}
                          onChange={(e) =>
                            setDoc((prev) => ({
                              ...prev,
                              customWidth: Math.max(320, Number(e.target.value) || 3840),
                            }))
                          }
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 block mb-1">
                          Height (px)
                        </label>
                        <input
                          type="number"
                          min={320}
                          max={12000}
                          step={10}
                          value={doc.customHeight}
                          onChange={(e) =>
                            setDoc((prev) => ({
                              ...prev,
                              customHeight: Math.max(320, Number(e.target.value) || 2160),
                            }))
                          }
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Format & Compression */}
                <div className="pt-3 border-t border-slate-200 space-y-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                    Export File Format
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'png', label: 'PNG Lossless' },
                        { id: 'jpeg', label: 'JPEG' },
                        { id: 'webp', label: 'WebP' },
                      ] as Array<{ id: OverlayExportFormat; label: string }>
                    ).map((fmt) => (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => setExportFormat(fmt.id)}
                        className={cn(
                          'py-2 px-2 rounded-xl border text-xs font-bold cursor-pointer',
                          exportFormat === fmt.id
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        )}
                      >
                        {fmt.label}
                      </button>
                    ))}
                  </div>

                  {exportFormat !== 'png' && (
                    <SliderControl
                      label="Compression Quality"
                      value={exportQuality}
                      min={60}
                      max={100}
                      unit="%"
                      onChange={setExportQuality}
                    />
                  )}

                  {doc.backgroundMode === 'transparent' && exportFormat === 'jpeg' && (
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
                      JPEG does not support transparency; select PNG or WebP to preserve alpha channel.
                    </p>
                  )}

                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={handleDownloadCurrent}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-60"
                  >
                    {isExporting ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    {isExporting
                      ? `Rendering Full ${doc.resolutionPreset}...`
                      : `Download Full ${dims.width}×${dims.height} ${exportFormat.toUpperCase()}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SAVED OVERLAYS GALLERY & BULK ZIP EXPORT */}
      {gallery.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-slate-900">
                Overlay Gallery ({gallery.length})
              </h3>
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
                {(['all', 'favorites'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setGalleryFilter(f)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer capitalize',
                      galleryFilter === f
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (selectedGalleryIds.size === visibleGallery.length) {
                    setSelectedGalleryIds(new Set());
                  } else {
                    setSelectedGalleryIds(new Set(visibleGallery.map((g) => g.id)));
                  }
                }}
                className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-700 cursor-pointer"
              >
                {selectedGalleryIds.size === visibleGallery.length ? 'Clear Selection' : 'Select All'}
              </button>

              <button
                type="button"
                disabled={isZipExporting}
                onClick={handleBulkZipExport}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                {isZipExporting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Package className="w-3.5 h-3.5" />
                )}
                {isZipExporting
                  ? 'Rendering Full-Res ZIP...'
                  : selectedGalleryIds.size > 0
                    ? `Export Selected (${selectedGalleryIds.size}) ZIP`
                    : `Export All (${gallery.length}) ZIP`}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
            {visibleGallery.map((item) => {
              const checked = selectedGalleryIds.has(item.id);
              return (
                <div
                  key={item.id}
                  className={cn(
                    'group border rounded-xl overflow-hidden bg-white transition-all',
                    checked ? 'border-indigo-500 ring-1 ring-indigo-200' : 'border-slate-200'
                  )}
                >
                  <div
                    onClick={() => {
                      setDoc(cloneOverlayDoc(item.doc));
                      if (item.doc.layers[0]) setSelectedLayerId(item.doc.layers[0].id);
                    }}
                    className="relative aspect-video overflow-hidden cursor-pointer"
                    style={
                      item.doc.backgroundMode === 'transparent'
                        ? CHECKERBOARD_STYLE
                        : { backgroundColor: '#050507' }
                    }
                  >
                    <img
                      src={item.previewUrl}
                      alt={item.doc.title}
                      className="w-full h-full object-contain group-hover:scale-[1.03] transition-transform duration-200"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedGalleryIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        });
                      }}
                      className={cn(
                        'absolute top-2 left-2 w-5 h-5 rounded-md border flex items-center justify-center cursor-pointer transition-all',
                        checked
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'bg-slate-900/60 border-white/50 text-transparent hover:border-white'
                      )}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-slate-900/75 text-white text-[9px] font-mono">
                      {item.doc.resolutionPreset} • {item.doc.layers.length}L
                    </span>
                  </div>

                  <div className="p-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{item.doc.title}</p>
                      <p className="text-[10px] font-mono text-slate-500 tabular-nums">
                        {item.width}×{item.height}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setGallery((prev) =>
                            prev.map((g) =>
                              g.id === item.id ? { ...g, favorite: !g.favorite } : g
                            )
                          )
                        }
                        className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                        title="Favorite"
                      >
                        <Heart
                          className={cn(
                            'w-3.5 h-3.5',
                            item.favorite && 'fill-rose-500 text-rose-500'
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGallery((prev) => prev.filter((g) => g.id !== item.id));
                          setSelectedGalleryIds((prev) => {
                            const next = new Set(prev);
                            next.delete(item.id);
                            return next;
                          });
                        }}
                        className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                        title="Remove"
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

      {/* FULLSCREEN PREVIEW MODAL */}
      {isFullView && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col">
          <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <Sun className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold">{doc.title}</span>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                {dims.width}×{dims.height} ({doc.resolutionPreset})
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFullZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg cursor-pointer"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setFullZoom(1);
                  setFullPan({ x: 0, y: 0 });
                }}
                className="px-2 py-1 text-xs font-mono tabular-nums cursor-pointer"
              >
                {Math.round(fullZoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setFullZoom((z) => Math.min(5, Number((z + 0.25).toFixed(2))))}
                className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg cursor-pointer"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleDownloadCurrent}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Export {doc.resolutionPreset}
              </button>
              <button
                type="button"
                onClick={() => setIsFullView(false)}
                className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            ref={fullViewportRef}
            className="flex-1 flex items-center justify-center overflow-hidden p-6 cursor-grab active:cursor-grabbing"
            style={
              effectiveBackdrop === 'checkerboard'
                ? CHECKERBOARD_STYLE
                : { backgroundColor: '#050507' }
            }
            onMouseDown={(e) => {
              setIsFullPanning(true);
              fullPanStartRef.current = {
                x: e.clientX,
                y: e.clientY,
                px: fullPan.x,
                py: fullPan.y,
              };
            }}
          >
            <img
              src={fullViewUrl}
              alt={doc.title}
              draggable={false}
              className="max-w-full max-h-full object-contain select-none"
              style={{
                transform: `translate(${fullPan.x}px, ${fullPan.y}px) scale(${fullZoom})`,
              }}
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
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="font-mono font-bold text-indigo-600 tabular-nums">
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
