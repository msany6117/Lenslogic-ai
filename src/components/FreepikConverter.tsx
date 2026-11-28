import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { 
  Package, 
  Upload, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  Layers, 
  FileCheck, 
  RefreshCw, 
  Sparkles,
  Image as ImageIcon,
  Check,
  Grid,
  Maximize2,
  Sliders,
  CheckCheck,
  PenTool,
  FileCode2,
  FolderArchive,
  Plus,
  Trash2,
  X
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { 
  convertFileToFreepikPsdPack, 
  detectTransparency, 
  formatBytes,
  loadImage, 
  sanitizeFileName,
  type FreepikPackResult 
} from '../services/freepikService';
import { 
  convertFileToFreepikVectorPack, 
  loadVectorPreview, 
  type FreepikVectorResult 
} from '../services/vectorService';
type StudioMode = 'psd' | 'vector';

interface BatchPackageItem {
  id: string;
  file: File;
  customPreviewFile?: File | null;
  previewUrl: string | null;
  width?: number;
  height?: number;
  isTransparent?: boolean;
  status: 'idle' | 'processing' | 'done' | 'error';
  error?: string;
  pairName?: string;
  assetSizeFormatted?: string;
  jpgSizeFormatted?: string;
  isCompliant?: boolean;
}

interface BatchZipResult {
  zipUrl: string;
  zipFileName: string;
  folderName: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  zipSizeFormatted: string;
  dpi: number;
  mode: StudioMode;
}

function formatBatchPairName(index: number, total: number, prefix?: string): string {
  const padLen = total >= 100 ? 3 : 2;
  const num = String(index + 1).padStart(padLen, '0');
  const trimmed = (prefix || '').trim();
  if (!trimmed) return num;
  return `${sanitizeFileName(trimmed)}_${num}`;
}

export interface DetectedDimensionInfo {
  width: number;
  height: number;
  aspect: string;
}

export function getAspectRatioLabel(w: number, h: number): string {
  if (!w || !h) return 'Original Ratio';
  const ratio = w / h;
  if (Math.abs(ratio - 1) < 0.02) return '1:1 Square';
  if (Math.abs(ratio - 16 / 9) < 0.04) return '16:9 Landscape';
  if (Math.abs(ratio - 9 / 16) < 0.04) return '9:16 Portrait';
  if (Math.abs(ratio - 3 / 2) < 0.03) return '3:2 Landscape';
  if (Math.abs(ratio - 2 / 3) < 0.03) return '2:3 Portrait';
  if (Math.abs(ratio - 4 / 3) < 0.03) return '4:3 Standard';
  if (Math.abs(ratio - 3 / 4) < 0.03) return '3:4 Standard';
  if (Math.abs(ratio - 21 / 9) < 0.05) return '21:9 UltraWide';
  return ratio > 1 ? `${ratio.toFixed(2)}:1 Landscape` : `1:${(1 / ratio).toFixed(2)} Portrait`;
}

export default function FreepikConverter() {
  // Studio Mode: 'psd' (2MB - 200MB) vs 'vector' (1MB - 70MB)
  const [studioMode, setStudioMode] = useState<StudioMode>('psd');

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState<boolean>(false);
  const [customName, setCustomName] = useState<string>('');
  const [customPreviewFile, setCustomPreviewFile] = useState<File | null>(null);

  // Transparency state
  const [isTransparentDetected, setIsTransparentDetected] = useState<boolean>(false);
  const [enableTransparentPsd, setEnableTransparentPsd] = useState<boolean>(true);
  const [previewBgStyle, setPreviewBgStyle] = useState<'checkerboard' | 'solid'>('checkerboard');
  const [bgColor, setBgColor] = useState<string>('#ffffff');
  const [addEditableBgLayer, setAddEditableBgLayer] = useState<boolean>(true);

  // Auto-detected Dimensions & Resolution state (100% Original Preserved)
  const [detectedDimensions, setDetectedDimensions] = useState<DetectedDimensionInfo | null>(null);
  const [customDpi, setCustomDpi] = useState<number>(300);
  const [dpiMode, setDpiMode] = useState<string>('300');

  // Conversion process state
  const [isConverting, setIsConverting] = useState(false);
  const [isParsingPreview, setIsParsingPreview] = useState(false);
  const [psdResult, setPsdResult] = useState<FreepikPackResult | null>(null);
  const [vectorResult, setVectorResult] = useState<FreepikVectorResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Batch package queue state (activated automatically when 2+ files are uploaded)
  const [batchItems, setBatchItems] = useState<BatchPackageItem[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [batchZipResult, setBatchZipResult] = useState<BatchZipResult | null>(null);

  // Track active blob URLs for safe cleanup without leaks
  const previewUrlRef = useRef<string | null>(null);
  const psdZipUrlRef = useRef<string | null>(null);
  const vectorZipUrlRef = useRef<string | null>(null);
  const batchZipUrlRef = useRef<string | null>(null);
  const batchPreviewUrlsRef = useRef<Set<string>>(new Set());
  const addMoreInputRef = useRef<HTMLInputElement | null>(null);

  const setSafePreviewUrl = (nextUrl: string | null) => {
    const prev = previewUrlRef.current;
    if (prev && prev !== nextUrl && prev.startsWith('blob:')) {
      URL.revokeObjectURL(prev);
    }
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);
  };

  useEffect(() => {
    return () => {
      if (previewUrlRef.current?.startsWith('blob:')) URL.revokeObjectURL(previewUrlRef.current);
      if (psdZipUrlRef.current?.startsWith('blob:')) URL.revokeObjectURL(psdZipUrlRef.current);
      if (vectorZipUrlRef.current?.startsWith('blob:')) URL.revokeObjectURL(vectorZipUrlRef.current);
      if (batchZipUrlRef.current?.startsWith('blob:')) URL.revokeObjectURL(batchZipUrlRef.current);
      batchPreviewUrlsRef.current.forEach((url) => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      });
      batchPreviewUrlsRef.current.clear();
    };
  }, []);

  const clearConversionResults = () => {
    if (psdZipUrlRef.current?.startsWith('blob:')) URL.revokeObjectURL(psdZipUrlRef.current);
    if (vectorZipUrlRef.current?.startsWith('blob:')) URL.revokeObjectURL(vectorZipUrlRef.current);
    if (batchZipUrlRef.current?.startsWith('blob:')) URL.revokeObjectURL(batchZipUrlRef.current);
    psdZipUrlRef.current = null;
    vectorZipUrlRef.current = null;
    batchZipUrlRef.current = null;
    setPsdResult(null);
    setVectorResult(null);
    setBatchZipResult(null);
  };

  const clearBatchQueue = () => {
    batchPreviewUrlsRef.current.forEach((url) => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    });
    batchPreviewUrlsRef.current.clear();
    setBatchItems([]);
    setBatchProgress(null);
    clearConversionResults();
    setSelectedFile(null);
    setSafePreviewUrl(null);
    setDetectedDimensions(null);
    setCustomName('');
    setCustomPreviewFile(null);
    setError(null);
  };

  const applyAlphaUiState = (hasAlpha: boolean) => {
    setIsTransparentDetected(hasAlpha);
    if (hasAlpha) {
      setEnableTransparentPsd(true);
      setPreviewBgStyle('checkerboard');
    } else {
      setEnableTransparentPsd(false);
      setPreviewBgStyle('solid');
    }
  };

  const inspectFileMetadata = async (file: File): Promise<{
    previewUrl: string | null;
    width?: number;
    height?: number;
    isTransparent: boolean;
  }> => {
    try {
      const previewInfo = await loadVectorPreview(file);
      return {
        previewUrl: previewInfo.previewUrl || null,
        width: previewInfo.width || undefined,
        height: previewInfo.height || undefined,
        isTransparent: Boolean(previewInfo.isTransparent),
      };
    } catch {
      if (file.type && file.type.startsWith('image/') && !file.name.endsWith('.ai') && !file.name.endsWith('.eps')) {
        try {
          const url = URL.createObjectURL(file);
          const img = await loadImage(url);
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          return {
            previewUrl: url,
            width: w || undefined,
            height: h || undefined,
            isTransparent: detectTransparency(img),
          };
        } catch {
          return { previewUrl: null, isTransparent: false };
        }
      }
      return { previewUrl: null, isTransparent: false };
    }
  };

  const loadFilesIntoStudio = async (incomingFiles: File[], appendToBatch = false) => {
    if (!incomingFiles || incomingFiles.length === 0) return;

    const getExt = (f: File) => f.name.split('.').pop()?.toLowerCase() || '';
    const getStem = (f: File) => f.name.replace(/\.[^/.]+$/, '').trim().toLowerCase();

    const epsFiles = incomingFiles.filter((f) => getExt(f) === 'eps');
    const rasterFiles = incomingFiles.filter((f) => ['jpg', 'jpeg', 'png', 'webp'].includes(getExt(f)));

    // If vector files are dropped with matching preview images, pair them automatically
    const previewMap = new Map<string, File>();
    if (epsFiles.length > 0 && rasterFiles.length > 0) {
      rasterFiles.forEach((rf) => previewMap.set(getStem(rf), rf));
    }

    const effectiveMode: StudioMode =
      epsFiles.length > 0 && (studioMode === 'vector' || epsFiles.length === incomingFiles.length || previewMap.size === rasterFiles.length)
        ? 'vector'
        : studioMode;

    if (effectiveMode === 'vector') {
      if (epsFiles.length === 0) {
        setError('In Vector Mode, only authentic EPS (.eps) vector files are supported. Please upload EPS files.');
        return;
      }
      if (studioMode !== 'vector') {
        setStudioMode('vector');
      }
    }

    const targetFiles = effectiveMode === 'vector' ? epsFiles : incomingFiles;
    const isNowBatch = appendToBatch ? (batchItems.length + targetFiles.length > 1 || (selectedFile !== null && targetFiles.length >= 1)) : targetFiles.length > 1;

    // Preserve exact original single-file UX whenever total files === 1
    if (!isNowBatch && targetFiles.length === 1) {
      const file = targetFiles[0];
      batchPreviewUrlsRef.current.forEach((url) => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      });
      batchPreviewUrlsRef.current.clear();
      setBatchItems([]);

      setSelectedFile(file);
      setCustomPreviewFile(previewMap.get(getStem(file)) || null);
      setCustomName(file.name.replace(/\.[^/.]+$/, ''));
      clearConversionResults();
      setError(null);
      setImgError(false);

      setIsParsingPreview(true);
      try {
        const info = await inspectFileMetadata(file);
        setSafePreviewUrl(info.previewUrl);
        applyAlphaUiState(info.isTransparent);
        if (info.width && info.height) {
          setDetectedDimensions({
            width: info.width,
            height: info.height,
            aspect: getAspectRatioLabel(info.width, info.height)
          });
        }
      } finally {
        setIsParsingPreview(false);
      }
      return;
    }

    // Multi-file Batch Mode
    setError(null);
    setImgError(false);
    clearConversionResults();

    const existingItems: BatchPackageItem[] = appendToBatch
      ? batchItems.length > 0
        ? batchItems
        : selectedFile
          ? [{
              id: `${Date.now()}_0`,
              file: selectedFile,
              customPreviewFile: customPreviewFile,
              previewUrl: previewUrl,
              width: detectedDimensions?.width,
              height: detectedDimensions?.height,
              isTransparent: isTransparentDetected,
              status: 'idle',
            }]
          : []
      : [];

    if (!appendToBatch) {
      batchPreviewUrlsRef.current.forEach((url) => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      });
      batchPreviewUrlsRef.current.clear();
      // Clear single-file name so automatic sequential numbering (01, 02, 03...) applies by default
      setCustomName('');
    } else {
      if (selectedFile && previewUrl && previewUrl.startsWith('blob:')) {
        batchPreviewUrlsRef.current.add(previewUrl);
        if (previewUrlRef.current === previewUrl) {
          previewUrlRef.current = null;
        }
      }
      if (existingItems.length === 1 && customName === existingItems[0].file.name.replace(/\.[^/.]+$/, '')) {
        setCustomName('');
      }
    }

    setSelectedFile(null);
    setSafePreviewUrl(null);
    setCustomPreviewFile(null);

    const newBatchEntries: BatchPackageItem[] = targetFiles.map((file, idx) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${idx}`,
      file,
      customPreviewFile: previewMap.get(getStem(file)) || null,
      previewUrl: null,
      status: 'idle',
    }));

    const combined = [...existingItems, ...newBatchEntries];
    setBatchItems(combined);
    setIsParsingPreview(true);

    try {
      let appliedFirstAlpha = existingItems.length > 0;
      for (const item of newBatchEntries) {
        const info = await inspectFileMetadata(item.file);
        if (info.previewUrl && info.previewUrl.startsWith('blob:')) {
          batchPreviewUrlsRef.current.add(info.previewUrl);
        }
        if (!appliedFirstAlpha) {
          appliedFirstAlpha = true;
          applyAlphaUiState(info.isTransparent);
          if (info.width && info.height) {
            setDetectedDimensions({
              width: info.width,
              height: info.height,
              aspect: getAspectRatioLabel(info.width, info.height)
            });
          }
        }
        setBatchItems((prev) =>
          prev.map((row) =>
            row.id === item.id
              ? {
                  ...row,
                  previewUrl: info.previewUrl,
                  width: info.width,
                  height: info.height,
                  isTransparent: info.isTransparent,
                }
              : row
          )
        );
      }
    } finally {
      setIsParsingPreview(false);
    }
  };

  const onDrop = async (acceptedFiles: File[]) => {
    await loadFilesIntoStudio(acceptedFiles, false);
  };

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: studioMode === 'vector'
      ? {
          'application/postscript': ['.eps'],
          'application/eps': ['.eps'],
          'image/eps': ['.eps'],
          'application/octet-stream': ['.eps']
        } as any
      : {
          'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.svg'],
          'application/postscript': ['.eps', '.ai'],
          'application/illustrator': ['.ai'],
          'application/pdf': ['.ai']
        } as any,
    multiple: true
  } as any);

  const removeBatchItem = (id: string) => {
    const target = batchItems.find((i) => i.id === id);
    if (target?.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(target.previewUrl);
      batchPreviewUrlsRef.current.delete(target.previewUrl);
    }
    const next = batchItems.filter((i) => i.id !== id);
    if (next.length === 0) {
      setBatchItems([]);
      setDetectedDimensions(null);
    } else if (next.length === 1) {
      const remaining = next[0];
      if (remaining.previewUrl) {
        batchPreviewUrlsRef.current.delete(remaining.previewUrl);
      }
      setBatchItems([]);
      setSelectedFile(remaining.file);
      setCustomPreviewFile(remaining.customPreviewFile || null);
      setCustomName(remaining.file.name.replace(/\.[^/.]+$/, ''));
      setSafePreviewUrl(remaining.previewUrl);
      setImgError(false);
      applyAlphaUiState(Boolean(remaining.isTransparent));
      if (remaining.width && remaining.height) {
        setDetectedDimensions({
          width: remaining.width,
          height: remaining.height,
          aspect: getAspectRatioLabel(remaining.width, remaining.height)
        });
      } else {
        setDetectedDimensions(null);
      }
    } else {
      setBatchItems(next);
    }
    clearConversionResults();
  };

  const handleConvert = async () => {
    const isBatchMode = batchItems.length > 1;
    if (!isBatchMode && !selectedFile && !previewUrl) return;
    if (isBatchMode && batchItems.length === 0) return;

    setIsConverting(true);
    setError(null);

    try {
      if (isBatchMode) {
        clearConversionResults();
        const total = batchItems.length;
        const folderName = studioMode === 'vector' ? 'Freepik_Vector_EPS_Pack' : 'Freepik_PSD_Pack';
        const masterZip = new JSZip();
        const folder = masterZip.folder(folderName)!;

        setBatchItems((prev) => prev.map((it) => ({ ...it, status: 'idle', error: undefined })));

        let successCount = 0;
        let failedCount = 0;

        for (let i = 0; i < total; i++) {
          const item = batchItems[i];
          const pairName = formatBatchPairName(i, total, customName);
          const ext = studioMode === 'vector' ? 'eps' : 'psd';

          setBatchProgress({
            current: i + 1,
            total,
            label: `${pairName}.${ext} + ${pairName}.jpg (${item.file.name})`
          });
          setBatchItems((prev) =>
            prev.map((row) => (row.id === item.id ? { ...row, status: 'processing', pairName } : row))
          );

          try {
            if (studioMode === 'vector') {
              const vResult = await convertFileToFreepikVectorPack(item.file, pairName, {
                baseName: pairName,
                targetWidth: item.width,
                targetHeight: item.height,
                dpi: customDpi,
                previewBgStyle,
                backgroundColor: bgColor,
                customPreviewSource: item.customPreviewFile || undefined,
                returnRawFiles: true,
              });
              if (vResult.epsBlob && vResult.jpgBlob) {
                folder.file(`${pairName}.eps`, vResult.epsBlob);
                folder.file(`${pairName}.jpg`, vResult.jpgBlob);
              }
              successCount++;
              setBatchItems((prev) =>
                prev.map((row) =>
                  row.id === item.id
                    ? {
                        ...row,
                        status: 'done',
                        pairName,
                        assetSizeFormatted: vResult.epsSizeFormatted,
                        jpgSizeFormatted: vResult.jpgSizeFormatted,
                        isCompliant: vResult.isCompliant,
                      }
                    : row
                )
              );
            } else {
              const pResult = await convertFileToFreepikPsdPack(item.file, pairName, {
                baseName: pairName,
                targetWidth: item.width,
                targetHeight: item.height,
                dpi: customDpi,
                transparentPsd: enableTransparentPsd,
                previewBgStyle,
                backgroundColor: bgColor,
                addEditableBackgroundLayer: addEditableBgLayer,
                returnRawFiles: true,
              });
              if (pResult.psdBlob && pResult.jpgBlob) {
                folder.file(`${pairName}.psd`, pResult.psdBlob);
                folder.file(`${pairName}.jpg`, pResult.jpgBlob);
              }
              successCount++;
              setBatchItems((prev) =>
                prev.map((row) =>
                  row.id === item.id
                    ? {
                        ...row,
                        status: 'done',
                        pairName,
                        assetSizeFormatted: pResult.psdSizeFormatted,
                        jpgSizeFormatted: pResult.jpgSizeFormatted,
                        isCompliant: pResult.isCompliant,
                      }
                    : row
                )
              );
            }
          } catch (itemErr: any) {
            failedCount++;
            setBatchItems((prev) =>
              prev.map((row) =>
                row.id === item.id
                  ? { ...row, status: 'error', pairName, error: itemErr?.message || 'Conversion failed' }
                  : row
              )
            );
          }

          // Brief yield so browser UI stays smooth during heavy batch canvas/PSD encoding
          await new Promise((r) => setTimeout(r, 20));
        }

        if (successCount === 0) {
          throw new Error('All files failed to package. Please check the file formats and try again.');
        }

        setBatchProgress({ current: total, total, label: `Archiving ${successCount} pairs into ${folderName}/...` });
        const masterZipBlob = await masterZip.generateAsync({
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 3 }
        });
        const masterZipUrl = URL.createObjectURL(masterZipBlob);
        batchZipUrlRef.current = masterZipUrl;

        setBatchZipResult({
          zipUrl: masterZipUrl,
          zipFileName: `${folderName}.zip`,
          folderName,
          totalCount: total,
          successCount,
          failedCount,
          zipSizeFormatted: formatBytes(masterZipBlob.size),
          dpi: customDpi,
          mode: studioMode,
        });
      } else {
        const activeFile = batchItems.length === 1 ? batchItems[0].file : selectedFile;
        const source = activeFile || previewUrl!;
        const baseTitle = customName || 'freepik_asset';

        if (studioMode === 'vector') {
          // Package Freepik Vector EPS Pack (1MB - 70MB) with 100% original dimensions
          const vResult = await convertFileToFreepikVectorPack(source, baseTitle, {
            baseName: baseTitle,
            targetWidth: detectedDimensions?.width,
            targetHeight: detectedDimensions?.height,
            dpi: customDpi,
            customPreviewSource: customPreviewFile || undefined
          });
          clearConversionResults();
          vectorZipUrlRef.current = vResult.zipUrl;
          setVectorResult(vResult);
        } else {
          // Convert to Freepik PSD Pack (2MB - 200MB) with 100% original dimensions
          const pResult = await convertFileToFreepikPsdPack(source, baseTitle, {
            baseName: baseTitle,
            targetWidth: detectedDimensions?.width,
            targetHeight: detectedDimensions?.height,
            dpi: customDpi,
            transparentPsd: enableTransparentPsd,
            previewBgStyle: previewBgStyle,
            backgroundColor: bgColor,
            addEditableBackgroundLayer: addEditableBgLayer
          });
          clearConversionResults();
          psdZipUrlRef.current = pResult.zipUrl;
          setPsdResult(pResult);
        }
      }
    } catch (err: any) {
      console.error('Freepik conversion error:', err);
      setError(err?.message || 'Failed to convert file into Freepik pack.');
    } finally {
      setIsConverting(false);
      setBatchProgress(null);
    }
  };

  const handleDownload = () => {
    if (batchZipResult) {
      const a = document.createElement('a');
      a.href = batchZipResult.zipUrl;
      a.download = batchZipResult.zipFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
    const activeResult = studioMode === 'vector' ? vectorResult : psdResult;
    if (!activeResult) return;
    const a = document.createElement('a');
    a.href = activeResult.zipUrl;
    a.download = activeResult.zipFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const activeResult = studioMode === 'vector' ? vectorResult : psdResult;
  const isBatchMode = batchItems.length > 1;

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {/* Header Banner */}
      <header className="bg-white rounded-3xl border border-slate-200/90 p-8 shadow-xs relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-indigo-100/60 via-sky-100/35 to-transparent rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            EPS & PSD Package Generator
          </h2>
        </div>

        {/* Studio Mode Selector (Tabs) */}
        <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex p-1 bg-slate-100 rounded-2xl w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                setStudioMode('psd');
                setError(null);
              }}
              className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                studioMode === 'psd'
                  ? 'bg-white text-indigo-900 shadow-xs ring-1 ring-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-4 h-4 text-indigo-600" />
              <span>Photoshop PSD Pack</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                2MB – 200MB
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStudioMode('vector');
                setError(null);
              }}
              className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                studioMode === 'vector'
                  ? 'bg-white text-amber-900 shadow-xs ring-1 ring-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <PenTool className="w-4 h-4 text-amber-600" />
              <span>Illustrator Vector EPS Pack</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                1MB – 70MB
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Studio Flow */}
      <div className="space-y-8">
        {/* Upload Section */}
        <div className="space-y-6">
          {/* Hidden input for adding more files into batch without replacing existing ones */}
          <input
            ref={addMoreInputRef}
            type="file"
            multiple
            accept={studioMode === 'vector' ? '.eps,.jpg,.jpeg,.png' : 'image/*,.eps,.ai'}
            className="sr-only"
            onChange={(e) => {
              const files: File[] = e.target.files ? (Array.from(e.target.files) as File[]) : [];
              if (files.length > 0) {
                loadFilesIntoStudio(files, true);
              }
              e.target.value = '';
            }}
          />

          {/* Dropzone */}
          <div 
            {...getRootProps()}
            className={`bg-white rounded-3xl border-2 border-dashed p-8 text-center transition-all cursor-pointer shadow-xs group relative overflow-hidden ${
              studioMode === 'vector'
                ? 'border-amber-300 hover:border-amber-500 hover:bg-amber-50/20'
                : 'border-slate-300 hover:border-indigo-500 hover:bg-indigo-50/20'
            }`}
          >
            <input {...getInputProps()} />
            
            {isParsingPreview && !isBatchMode ? (
              <div className="py-12 space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
                  <RefreshCw className="w-7 h-7 animate-spin" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800">Rendering Vector Artwork...</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                    Extracting vector paths and generating high-res preview for {selectedFile?.name}
                  </p>
                </div>
              </div>
            ) : isBatchMode ? (
              <div className="space-y-4 text-left" onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                      studioMode === 'vector' ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'
                    }`}>
                      <FolderArchive className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">
                        {batchItems.length} Files Ready for 1-Click Batch Folder
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Each {studioMode === 'vector' ? 'EPS' : 'PSD'} + JPG preview pair gets an automatic numbered name inside one folder
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isConverting}
                      onClick={() => addMoreInputRef.current?.click()}
                      className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 text-indigo-700 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add More
                    </button>
                    <button
                      type="button"
                      disabled={isConverting}
                      onClick={clearBatchQueue}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 disabled:opacity-40 text-rose-700 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear All
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[360px] overflow-y-auto pr-1">
                  {batchItems.map((item, idx) => {
                    const ext = studioMode === 'vector' ? 'eps' : 'psd';
                    const previewPairName = item.pairName || formatBatchPairName(idx, batchItems.length, customName);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 p-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 relative group/item"
                      >
                        <div className="w-12 h-12 rounded-xl overflow-hidden border border-slate-200 bg-white shrink-0 flex items-center justify-center">
                          {item.previewUrl ? (
                            <img src={item.previewUrl} alt={item.file.name} className="w-full h-full object-cover" />
                          ) : (
                            <FileCode2 className="w-5 h-5 text-amber-600" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 shrink-0">
                              #{previewPairName}
                            </span>
                            <p className="text-xs font-bold text-slate-800 truncate">{item.file.name}</p>
                          </div>
                          <p className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                            → {previewPairName}.{ext} &amp; {previewPairName}.jpg
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {item.width && item.height && (
                              <span className="text-[9px] text-slate-400 font-mono">
                                {item.width}×{item.height}
                              </span>
                            )}
                            {item.status === 'processing' && (
                              <span className="text-[9px] font-bold text-indigo-600 flex items-center gap-1">
                                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                                Packaging...
                              </span>
                            )}
                            {item.status === 'done' && (
                              <span className="text-[9px] font-bold text-emerald-700">
                                ✓ {item.assetSizeFormatted}
                              </span>
                            )}
                            {item.status === 'error' && (
                              <span className="text-[9px] font-bold text-rose-600 truncate" title={item.error}>
                                Failed
                              </span>
                            )}
                          </div>
                        </div>
                        {!isConverting && (
                          <button
                            type="button"
                            onClick={() => removeBatchItem(item.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                            title="Remove file"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : selectedFile || previewUrl ? (
              <div className="space-y-4">
                <div className="w-full flex justify-center">
                  <div
                    className={`relative inline-flex items-center justify-center rounded-2xl overflow-hidden border border-slate-200 shadow-md max-w-full ${
                      isTransparentDetected
                        ? 'bg-[linear-gradient(45deg,#f1f5f9_25%,transparent_25%),linear-gradient(-45deg,#f1f5f9_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f1f5f9_75%),linear-gradient(-45deg,transparent_75%,#f1f5f9_75%)] bg-[size:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] bg-white'
                        : 'bg-slate-100'
                    }`}
                  >
                    {previewUrl && !imgError ? (
                      <img
                        src={previewUrl}
                        alt="Artwork Preview"
                        className={`block max-w-full max-h-[540px] w-auto h-auto object-contain ${
                          detectedDimensions && detectedDimensions.width < 420 && detectedDimensions.height < 420
                            ? detectedDimensions.width >= detectedDimensions.height
                              ? 'min-w-[320px] sm:min-w-[440px]'
                              : 'min-h-[380px]'
                            : ''
                        }`}
                        onError={() => {
                          console.warn('Image load error on previewUrl, switching to vector badge');
                          setImgError(true);
                        }}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center px-12 py-14 text-center min-w-[280px]">
                        <FileCode2 className="w-14 h-14 text-amber-600 mb-3" />
                        <p className="text-sm font-bold text-slate-800 break-all">{selectedFile?.name || customName}</p>
                        <span className="text-xs text-amber-700 font-semibold mt-1">
                          {selectedFile?.name?.endsWith('.ai') ? 'Adobe Illustrator (.ai)' : selectedFile?.name?.endsWith('.eps') ? 'PostScript Vector (.eps)' : 'Vector / Graphic Asset'}
                        </span>
                      </div>
                    )}

                    {isTransparentDetected && previewUrl && !imgError && (
                      <div className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-slate-900/80 backdrop-blur-xs text-[10px] font-bold text-white flex items-center gap-1.5 shadow-xs">
                        <Grid className="w-3.5 h-3.5 text-indigo-400" />
                        Transparent Background
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-bold text-slate-800">{selectedFile?.name || customName || 'Selected Graphic'}</p>
                  {detectedDimensions && (
                    <p className="text-[11px] font-mono font-semibold text-slate-500 mt-0.5">
                      {detectedDimensions.width} × {detectedDimensions.height} px • {detectedDimensions.aspect}
                    </p>
                  )}
                  <div className="flex items-center justify-center gap-3 mt-1">
                    <p className="text-[11px] text-indigo-600 font-semibold">Click or drag files to replace</p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        addMoreInputRef.current?.click();
                      }}
                      className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Add More for Batch
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-105 transition-transform ${
                  studioMode === 'vector' ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'
                }`}>
                  {studioMode === 'vector' ? <PenTool className="w-7 h-7" /> : <Upload className="w-7 h-7" />}
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  {studioMode === 'vector' 
                    ? 'Upload Original EPS Vector Files (.eps)' 
                    : 'Upload Single or Multiple Image Files'}
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  {studioMode === 'vector'
                    ? 'Drag & drop one or multiple EPS files at once. Vector files are preserved with matching JPEG previews, auto-numbered, and packaged together (1MB–70MB).'
                    : 'Drag & drop one or multiple PNG, JPG, SVG, WebP files at once to generate 2MB–200MB Layered PSD Packs.'}
                </p>
                <span className={`inline-block mt-4 px-4 py-2 text-xs font-bold rounded-xl transition-colors ${
                  studioMode === 'vector'
                    ? 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                    : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                }`}>
                  Browse Files
                </span>
              </div>
            )}
          </div>

        </div>

      {/* Export Settings Panel - Located directly under upload section */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-6 md:p-8 shadow-xs space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            {studioMode === 'vector' ? 'Export EPS Settings' : 'Export PSD Settings'}
          </h3>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                studioMode === 'vector' 
                  ? 'bg-amber-100 text-amber-800 border border-amber-200' 
                  : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
              }`}>
                {studioMode === 'vector' ? '1MB – 70MB Limit' : '2MB – 200MB Limit'}
              </span>
            </div>

        {/* 2-Column Settings Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: File Name, DPI, and Mode-Specific Options */}
          <div className="space-y-5">
            {/* Base File Name */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                {isBatchMode
                  ? `Batch Name Prefix (${studioMode === 'vector' ? 'Auto Numbered EPS & JPG' : 'Auto Numbered PSD & JPG'})`
                  : `Asset Name (${studioMode === 'vector' ? 'for EPS & JPG' : 'for PSD & JPG'})`}
              </label>
              <input 
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={isBatchMode ? 'Optional prefix (leave blank for 01, 02, 03...)' : 'e.g. isometric_vector_elements'}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[10px] text-slate-400">
                {isBatchMode ? (
                  <>
                    Generates <code>{formatBatchPairName(0, batchItems.length, customName)}.{studioMode === 'vector' ? 'eps' : 'psd'}</code> + <code>{formatBatchPairName(0, batchItems.length, customName)}.jpg</code>, <code>{formatBatchPairName(1, batchItems.length, customName)}.{studioMode === 'vector' ? 'eps' : 'psd'}</code> + <code>{formatBatchPairName(1, batchItems.length, customName)}.jpg</code> ...
                  </>
                ) : (
                  <>
                    Generates <code>{customName || 'asset'}.{studioMode === 'vector' ? 'eps' : 'psd'}</code> and <code>{customName || 'asset'}.jpg</code>
                  </>
                )}
              </p>
            </div>

            {/* Resolution (DPI / PPI) Dropdown Selection */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                  Resolution (DPI / PPI)
                </label>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono">
                  {customDpi} DPI
                </span>
              </div>

              <div className="relative">
                <select
                  value={dpiMode}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDpiMode(val);
                    if (val !== 'custom') {
                      setCustomDpi(parseInt(val, 10));
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none pr-8"
                >
                  <option value="300">300 DPI — High-Res Print / Standard (Recommended)</option>
                  <option value="150">150 DPI — Medium / Digital Display</option>
                  <option value="72">72 DPI — Web & Screen Resolution</option>
                  <option value="600">600 DPI — Ultra High-Res Print</option>
                  <option value="custom">Custom DPI...</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-500">
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" fillRule="evenodd"></path>
                  </svg>
                </div>
              </div>

              {dpiMode === 'custom' && (
                <div className="flex items-center gap-2 pt-1 animate-in fade-in">
                  <span className="text-[10px] text-slate-500 font-medium">Enter Custom DPI:</span>
                  <input
                    type="number"
                    min={72}
                    max={1200}
                    step={1}
                    value={customDpi}
                    onChange={(e) => setCustomDpi(Math.max(72, Math.min(1200, parseInt(e.target.value) || 300)))}
                    className="w-24 bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[10px] text-slate-400">(72 – 1200 DPI)</span>
                </div>
              )}
            </div>

            {/* Mode-Specific Settings */}
            {studioMode === 'vector' ? (
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                      <FileCode2 className="w-3.5 h-3.5 text-amber-600" />
                      Adobe Illustrator 10 EPS
                    </p>
                    <p className="text-[10px] text-slate-500">Universal standard vector format</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    Auto-Formatted
                  </span>
                </div>

                {/* Optional Custom Preview Image for Vector EPS */}
                <div className="space-y-1.5 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                      Custom Preview (.jpg / .png)
                    </span>
                    {customPreviewFile ? (
                      <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        Custom Attached
                      </span>
                    ) : (
                      <span className="text-[9px] font-medium text-slate-400">
                        Auto-Generated from EPS
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex-1 px-3 py-2 bg-slate-50 hover:bg-amber-50/50 border border-slate-200 hover:border-amber-300 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer flex items-center justify-center gap-2 transition-all">
                      <ImageIcon className="w-3.5 h-3.5 text-amber-600" />
                      <span className="truncate max-w-[200px]">
                        {customPreviewFile ? customPreviewFile.name : 'Attach Custom Preview Image (Optional)'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={async (e) => {
                          if (e.target.files && e.target.files[0]) {
                            const pFile = e.target.files[0];
                            setCustomPreviewFile(pFile);
                            const url = URL.createObjectURL(pFile);
                            setSafePreviewUrl(url);
                            setImgError(false);
                            try {
                              const img = await loadImage(url);
                              const w = img.naturalWidth || img.width;
                              const h = img.naturalHeight || img.height;
                              if (w && h && !detectedDimensions) {
                                setDetectedDimensions({
                                  width: w,
                                  height: h,
                                  aspect: getAspectRatioLabel(w, h)
                                });
                              }
                              applyAlphaUiState(detectTransparency(img));
                            } catch {
                              // Keep existing dimensions if inspection fails
                            }
                          }
                        }}
                      />
                    </label>
                    {customPreviewFile && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomPreviewFile(null);
                          if (selectedFile) {
                            loadVectorPreview(selectedFile).then((info) => {
                              setSafePreviewUrl(info.previewUrl);
                              setImgError(false);
                              applyAlphaUiState(info.isTransparent);
                              if (info.width && info.height) {
                                setDetectedDimensions({
                                  width: info.width,
                                  height: info.height,
                                  aspect: getAspectRatioLabel(info.width, info.height)
                                });
                              }
                            });
                          }
                        }}
                        className="px-2.5 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl border border-rose-200 transition-colors cursor-pointer"
                        title="Remove custom preview image"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Upload your own custom preview image or let the studio generate it automatically.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                      <Grid className="w-3.5 h-3.5 text-indigo-600" />
                      Transparent PSD Canvas
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {isTransparentDetected ? 'Transparent PNG detected' : 'Alpha channel transparency'}
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={enableTransparentPsd}
                      onChange={(e) => setEnableTransparentPsd(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                {/* Preview JPG Background Style */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    Preview JPG Background
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewBgStyle('checkerboard')}
                      className={`p-2 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                        previewBgStyle === 'checkerboard'
                          ? 'bg-indigo-50 border-indigo-400 text-indigo-900 ring-1 ring-indigo-200'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                      }`}
                    >
                      <div className="w-6 h-6 rounded-md border border-slate-300 shrink-0 bg-[linear-gradient(45deg,#cbd5e1_25%,transparent_25%),linear-gradient(-45deg,#cbd5e1_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#cbd5e1_75%),linear-gradient(-45deg,transparent_75%,#cbd5e1_75%)] bg-[size:8px_8px] bg-[position:0_0,0_4px,4px_-4px,-4px_0px] bg-white" />
                      <div>
                        <p className="text-[11px] font-bold leading-tight">Checkerboard</p>
                        <p className="text-[9px] text-slate-400">Shows transparency</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPreviewBgStyle('solid')}
                      className={`p-2 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                        previewBgStyle === 'solid'
                          ? 'bg-indigo-50 border-indigo-400 text-indigo-900 ring-1 ring-indigo-200'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                      }`}
                    >
                      <div className="w-6 h-6 rounded-md border border-slate-300 shrink-0 bg-white" />
                      <div>
                        <p className="text-[11px] font-bold leading-tight">Solid Background</p>
                        <p className="text-[9px] text-slate-400">Opaque preview</p>
                      </div>
                    </button>
                  </div>
                </div>

                {previewBgStyle === 'solid' && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] text-slate-500 font-semibold block">Solid Color:</span>
                    <div className="flex items-center gap-2">
                      {[
                        { name: 'White', hex: '#ffffff' },
                        { name: 'Dark', hex: '#0f172a' },
                        { name: 'Warm Cream', hex: '#fdfbf7' },
                        { name: 'Light Gray', hex: '#f1f5f9' }
                      ].map((col) => (
                        <button
                          key={col.hex}
                          type="button"
                          onClick={() => setBgColor(col.hex)}
                          className={`flex-1 py-1.5 px-2 rounded-xl border text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                            bgColor === col.hex 
                              ? 'bg-indigo-50 border-indigo-400 text-indigo-900 ring-1 ring-indigo-200' 
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <span className="w-2.5 h-2.5 rounded-full border border-slate-300" style={{ backgroundColor: col.hex }} />
                          <span>{col.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-600 font-medium">Include toggleable background layer in PSD</span>
                  <input 
                    type="checkbox"
                    checked={addEditableBgLayer}
                    onChange={(e) => setAddEditableBgLayer(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Auto-Detected Dimensions (100% Original Preserved) */}
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block flex items-center gap-1.5">
                  <Maximize2 className="w-3.5 h-3.5 text-indigo-600" />
                  Auto-Detected Dimensions
                </label>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                  <Check className="w-3 h-3 text-emerald-600" />
                  100% Original Preserved
                </span>
              </div>

              {isBatchMode ? (
                <div className="p-5 bg-gradient-to-br from-indigo-50/70 via-slate-50 to-white rounded-2xl border border-indigo-100/80 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Batch Packaging Summary</p>
                      <p className="text-xl font-extrabold text-slate-900 tracking-tight font-mono mt-0.5">
                        {batchItems.length} Pairs ({batchItems.length * 2} Files)
                      </p>
                    </div>
                    <span className="px-3 py-1 bg-white border border-slate-200/90 rounded-xl text-xs font-bold text-indigo-700 shadow-2xs">
                      1 Output Folder
                    </span>
                  </div>
                  <div className="flex items-start gap-2 bg-emerald-50/70 p-3 rounded-xl border border-emerald-100">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-emerald-900 leading-relaxed">
                      <strong>Auto-Numbered &amp; Original Proportions:</strong> Every file preserves its own original pixel dimensions and receives matching sequential names (<code>01</code>, <code>02</code>, <code>03</code>...) inside one folder.
                    </p>
                  </div>
                </div>
              ) : detectedDimensions ? (
                <div className="p-5 bg-gradient-to-br from-indigo-50/70 via-slate-50 to-white rounded-2xl border border-indigo-100/80 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Source Resolution</p>
                      <p className="text-2xl font-extrabold text-slate-900 tracking-tight font-mono mt-0.5">
                        {detectedDimensions.width} <span className="text-slate-400 font-sans font-normal text-lg">×</span> {detectedDimensions.height} <span className="text-xs font-semibold text-slate-500 font-sans">px</span>
                      </p>
                    </div>
                    <span className="px-3 py-1 bg-white border border-slate-200/90 rounded-xl text-xs font-bold text-slate-700 shadow-2xs">
                      {detectedDimensions.aspect}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200/60">
                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200/60">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Output Dimensions</p>
                      <p className="text-xs font-bold text-slate-800 font-mono mt-0.5">
                        {detectedDimensions.width} × {detectedDimensions.height} px
                      </p>
                      <p className="text-[9px] text-emerald-600 font-medium mt-0.5">Pixel-exact 1:1 match</p>
                    </div>

                    <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200/60">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Resolution Metadata</p>
                      <p className="text-xs font-bold text-slate-800 font-mono mt-0.5">
                        {customDpi} DPI / PPI
                      </p>
                      <p className="text-[9px] text-indigo-600 font-medium mt-0.5">Print ready</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 bg-emerald-50/70 p-3 rounded-xl border border-emerald-100">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-emerald-900 leading-relaxed">
                      <strong>Zero Distortion:</strong> No stretching or squeezing. Both the {studioMode === 'vector' ? 'EPS and preview JPG' : 'layered PSD and JPG'} will match your uploaded file's original proportions and quality exactly.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-center space-y-2">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                    <Maximize2 className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-bold text-slate-700">Auto-Detects from Uploaded File</p>
                  <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                    Upload your {studioMode === 'vector' ? 'EPS vector' : 'image'} above. Its natural dimensions and aspect ratio will be detected automatically and preserved 100% without squashing.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Convert Trigger Button & Error Banner */}
        <div className="pt-4 border-t border-slate-100 space-y-3">
          {batchProgress && (
            <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-2xl space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-indigo-950 truncate">
                  Packaging {batchProgress.current} of {batchProgress.total}: {batchProgress.label}
                </span>
                <span className="font-mono font-bold text-indigo-700 shrink-0 ml-2">
                  {Math.round((batchProgress.current / Math.max(1, batchProgress.total)) * 100)}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-indigo-200/60 overflow-hidden">
                <div
                  className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                  style={{ width: `${(batchProgress.current / Math.max(1, batchProgress.total)) * 100}%` }}
                />
              </div>
            </div>
          )}

          <button
            onClick={handleConvert}
            disabled={(!isBatchMode && !selectedFile && !previewUrl) || (isBatchMode && batchItems.length === 0) || isConverting}
            className={`w-full py-4 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer ${
              studioMode === 'vector'
                ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20'
                : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20'
            }`}
          >
            {isConverting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                {isBatchMode
                  ? `Generating Batch Folder (${batchProgress?.current || 1}/${batchItems.length})...`
                  : studioMode === 'vector'
                    ? 'Packaging Original EPS & Preview (1MB–70MB)...'
                    : 'Generating 2MB–200MB Layered PSD Pack...'}
              </>
            ) : (
              <>
                {isBatchMode ? <FolderArchive className="w-4 h-4" /> : studioMode === 'vector' ? <PenTool className="w-4 h-4" /> : <Package className="w-4 h-4" />}
                {isBatchMode
                  ? studioMode === 'vector'
                    ? `Package All ${batchItems.length} EPS & Previews in 1 Folder (ZIP)`
                    : `Generate All ${batchItems.length} PSD & Previews in 1 Folder (ZIP)`
                  : studioMode === 'vector'
                    ? 'Package EPS & Preview (ZIP)'
                    : 'Generate PSD Pack (ZIP)'}
              </>
            )}
          </button>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* Batch Results Box */}
      {batchZipResult && batchZipResult.mode === studioMode && (
        <div className="bg-emerald-50/60 border border-emerald-200 rounded-3xl p-6 shadow-xs space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Batch Folder Ready! ({batchZipResult.successCount} {batchZipResult.mode === 'vector' ? 'EPS + JPG' : 'PSD + JPG'} Pairs)
            </div>
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1 font-mono">
              <FolderArchive className="w-3 h-3 text-emerald-600" />
              {batchZipResult.folderName}/ • {batchZipResult.zipSizeFormatted}
            </span>
          </div>

          <div className="bg-white rounded-2xl border border-emerald-100 p-4 space-y-2 max-h-64 overflow-y-auto text-xs">
            {batchItems.filter((it) => it.status === 'done').map((it) => {
              const ext = batchZipResult.mode === 'vector' ? 'eps' : 'psd';
              return (
                <div key={it.id} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-b-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="font-mono font-bold text-slate-800">
                      {batchZipResult.folderName}/{it.pairName}.{ext}
                    </span>
                    <span className="text-slate-400">+</span>
                    <span className="font-mono font-semibold text-indigo-700">
                      {it.pairName}.jpg
                    </span>
                  </div>
                  <div className="text-right font-mono text-[11px] text-slate-600 shrink-0 ml-2">
                    {it.assetSizeFormatted} + {it.jpgSizeFormatted}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={handleDownload}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Download All in One Folder ({batchZipResult.zipFileName})
          </button>
        </div>
      )}

      {/* Results Box */}
      {!(batchZipResult && batchZipResult.mode === studioMode) && activeResult && (
        <div className="bg-emerald-50/60 border border-emerald-200 rounded-3xl p-6 shadow-xs space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              {studioMode === 'vector' ? 'Vector EPS' : 'PSD'} Pack Ready!
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
              <CheckCheck className="w-3 h-3 text-emerald-600" />
              {studioMode === 'vector' ? 'Compliant (1MB – 70MB)' : 'Compliant (2MB – 200MB)'}
            </span>
          </div>

          {/* Package File Details */}
          <div className="bg-white rounded-2xl border border-emerald-100 p-4 space-y-2.5 text-xs">
            {/* Main Asset File */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                {studioMode === 'vector' ? (
                  <PenTool className="w-4 h-4 text-amber-600" />
                ) : (
                  <FileCheck className="w-4 h-4 text-indigo-600" />
                )}
                <div>
                  <span className="font-semibold text-slate-800">
                    {studioMode === 'vector'
                      ? (vectorResult?.epsFileName || `${customName || 'asset'}.eps`)
                      : `${customName || 'asset'}.psd`}
                  </span>
                  <span className="text-[10px] text-slate-400 block">
                    {studioMode === 'vector'
                      ? 'Original EPS Vector File (Preserved & 1MB–70MB Standardized)'
                      : `${psdResult?.isTransparent ? 'Transparent Canvas' : 'Layered'} • ${activeResult.dpi} PPI`}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="font-mono font-bold text-slate-800">
                  {studioMode === 'vector' ? vectorResult?.epsSizeFormatted : psdResult?.psdSizeFormatted}
                </span>
                <span className="text-[9px] text-emerald-600 font-bold block">
                  {studioMode === 'vector' ? '✓ 1MB–70MB' : '✓ 2MB–200MB'}
                </span>
              </div>
            </div>

            {/* JPG File */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-emerald-600" />
                <div>
                  <span className="font-semibold text-slate-800">
                    {studioMode === 'vector'
                      ? (vectorResult?.jpgFileName || `${customName || 'asset'}.jpg`)
                      : `${customName || 'asset'}.jpg`}
                  </span>
                  <span className="text-[10px] text-slate-400 block">
                    Matching Preview Image • {activeResult.dpi} PPI
                  </span>
                </div>
              </div>
              <span className="font-mono text-slate-500">
                {studioMode === 'vector' ? vectorResult?.jpgSizeFormatted : psdResult?.jpgSizeFormatted}
              </span>
            </div>

            {/* Metadata Row */}
            <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-600">
              <div className="bg-slate-50 p-2 rounded-xl">
                <span className="text-[10px] text-slate-400 block">Dimensions</span>
                <span className="font-mono font-bold text-slate-800">
                  {activeResult.dimensions.width} × {activeResult.dimensions.height} px
                </span>
              </div>
              <div className="bg-slate-50 p-2 rounded-xl">
                <span className="text-[10px] text-slate-400 block">Resolution</span>
                <span className="font-mono font-bold text-indigo-600">
                  {activeResult.dpi} PPI / DPI
                </span>
              </div>
            </div>
          </div>

          {/* Download Action */}
          <button
            onClick={handleDownload}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Download {studioMode === 'vector' ? 'Vector EPS' : 'PSD'} ZIP Pack
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
