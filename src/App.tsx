import React, { useState, useCallback, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Settings, 
  Image as ImageIcon, 
  Plus, 
  Download, 
  RefreshCw, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  Copy,
  LayoutDashboard,
  Search,
  Check,
  Video as VideoIcon,
  Key,
  Shield,
  LogOut,
  RotateCcw,
  Sparkles,
  Layers,
  Sliders
} from 'lucide-react';
import { useDropzone, type Accept } from 'react-dropzone';
import Papa from 'papaparse';
import { cn, compressToDataUrl } from './lib/utils';
import { generateMetadata as generateMetadataService } from './services/aiService';
import type { Platform, GenerationSettings, ImageMetadata, ApiResponse, AssetType } from './types';

// Firebase Integrations
import { 
  saveUserProfile, 
  getUserProfile, 
  deleteAssetFromDb,
  clearAllAssetsFromDb
} from './services/dbService';
import AuthScreen from './components/AuthScreen';
import AdminPanel from './components/AdminPanel';
import FreepikConverter from './components/FreepikConverter';

const PLATFORMS: Platform[] = ['Adobe Stock', 'Shutterstock', 'Freepik', 'Getty Images', 'Draft'];

const dropzoneAccept: Accept = { 'image/*': [] };

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [images, setImages] = useState<ImageMetadata[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'metadata' | 'studio' | 'settings' | 'admin'>('metadata');
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ total: number; completed: number; currentName: string; isRateLimited: boolean } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('All');

  const [settings, setSettings] = useState<GenerationSettings>(() => {
    const saved = localStorage.getItem('lenslogic_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed.apiKeys) || (parsed.apiKeys.length > 0 && typeof parsed.apiKeys[0] === 'string')) {
        parsed.apiKeys = [];
        parsed.activeKeyId = null;
      }
      return {
        ...parsed,
        batchSpeed: parsed.batchSpeed || 'safe'
      };
    }
    return {
      platform: 'Adobe Stock',
      titleLength: '20-200',
      keywordCount: 30,
      prefix: '',
      suffix: '',
      negativeKeywords: '',
      apiKeys: [],
      activeKeyId: null,
      batchSpeed: 'safe'
    };
  });

  // Check auth state on mount and sync assets
  React.useEffect(() => {
    const initAuth = async () => {
      let savedUser = localStorage.getItem('lenslogic_user');
      if (!savedUser) {
        // Auto-initialize premium persistent guest session to bypass account setup
        const guestUid = 'guest_' + Math.random().toString(36).substring(2, 11);
        const guestUser = {
          uid: guestUid,
          email: 'guest@lenslogic.ai',
          role: 'user',
          savedSettings: null,
          createdAt: new Date().toISOString()
        };
        localStorage.setItem('lenslogic_user', JSON.stringify(guestUser));
        savedUser = JSON.stringify(guestUser);
      }

      if (savedUser) {
        try {
          const currentUser = JSON.parse(savedUser);
          setUser(currentUser);
          setUserProfile(currentUser);
          
          if (currentUser.savedSettings) {
            setSettings(currentUser.savedSettings);
          }
        } catch (e) {
          console.error("Error restoring session:", e);
        }
      }
      setLoadingAuth(false);
    };
    initAuth();
  }, []);

  // Sync settings and API Keys to backend and localStorage
  React.useEffect(() => {
    localStorage.setItem('lenslogic_settings', JSON.stringify(settings));
    if (user) {
      const geminiKey = settings.apiKeys.find(k => k.provider === 'Gemini')?.key || '';
      const groqKey = settings.apiKeys.find(k => k.provider === 'Groq')?.key || '';
      
      saveUserProfile(user.uid, user.email || '', {
        savedApiKey: geminiKey,
        savedGroqKey: groqKey,
        savedSettings: settings
      }).catch(err => console.error("Error saving profile settings:", err));

      // Sync settings with cached user object in localStorage
      const updatedUser = { ...user, savedSettings: settings };
      localStorage.setItem('lenslogic_user', JSON.stringify(updatedUser));
    }
  }, [settings, user]);

  const handleSignOut = () => {
    setShowResetConfirm(true);
  };

  const confirmResetSession = () => {
    localStorage.removeItem('lenslogic_user');
    setImages([]);
    setActiveTab('metadata');
    const guestUid = 'guest_' + Math.random().toString(36).substring(2, 11);
    const guestUser = {
      uid: guestUid,
      email: 'guest@lenslogic.ai',
      role: 'user',
      savedSettings: null,
      createdAt: new Date().toISOString()
    };
    localStorage.setItem('lenslogic_user', JSON.stringify(guestUser));
    setUser(guestUser);
    setUserProfile(guestUser);
    setShowResetConfirm(false);
  };

  // File Upload Handling
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const filesToProcess = acceptedFiles; // Lifted 100-file limit!

    // Create a map to find reference images (JPG/PNG/WebP)
    const fileMap = new Map<string, File>();
    acceptedFiles.forEach(f => fileMap.set(f.name.toLowerCase(), f));

    const processFiles = async () => {
      const newAssets: ImageMetadata[] = [];
      const referenceImagesFound = new Map<string, string>();

      // Handle normalizing filename for cross-referencing
      const normalize = (name: string) => {
        const parts = name.split('.');
        let base = parts.length > 1 ? parts.slice(0, -1).join('.') : name;
        base = base.replace(/[-_ ]?preview$/i, '')
                   .replace(/[-_ ]?thumb$/i, '')
                   .replace(/[-_ ]?display$/i, '')
                   .replace(/[-_ ]?lowres$/i, '');
        return base.toLowerCase().replace(/[^a-z0-9]/g, '');
      };

      // First pass: identify all potential reference images in this batch
      acceptedFiles.forEach(f => {
        const ext = f.name.split('.').pop()?.toLowerCase();
        if (['jpg', 'jpeg', 'png', 'webp'].includes(ext || '')) {
          referenceImagesFound.set(normalize(f.name), URL.createObjectURL(f));
        }
      });

      // Also index existing images in state to match against newly dropped vectors
      const existingRefs = new Map<string, string>();
      images.forEach(img => {
        const imgName = img.file?.name || img.fileName || '';
        const ext = imgName.split('.').pop()?.toLowerCase();
        if (['jpg', 'jpeg', 'png', 'webp'].includes(ext || '') && img.preview) {
          existingRefs.set(normalize(imgName), img.preview);
        }
      });

      for (const file of filesToProcess) {
        const fileName = file.name;
        const extension = fileName.split('.').pop()?.toLowerCase();
        
        let type: AssetType = 'Photo';
        const vectorExts = ['svg', 'eps', 'ai', 'pdf'];
        const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mpg'];

        if (vectorExts.includes(extension || '')) {
          type = 'Vector';
        } else if (videoExts.includes(extension || '')) {
          type = 'Video';
        } else if (fileName.toLowerCase().includes('illustration')) {
          type = 'Illustration';
        }

        // Try to find a reference image (JPG/PNG) for this asset
        let preview = '';
        const normBase = normalize(fileName);
        const foundPreview = referenceImagesFound.get(normBase) || existingRefs.get(normBase);

        if (foundPreview && (type === 'Video' || (type === 'Vector' && extension !== 'svg'))) {
          preview = foundPreview;
        } else if (extension === 'svg') {
          try {
            preview = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                  const canvas = document.createElement('canvas');
                  canvas.width = img.width || 1024;
                  canvas.height = img.height || 1024;
                  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
                  resolve(canvas.toDataURL('image/png'));
                };
                img.src = e.target?.result as string;
              };
              reader.readAsDataURL(file);
            });
          } catch (e) {
            preview = URL.createObjectURL(file);
          }
        } else if (type === 'Video' && !foundPreview) {
          try {
            preview = await new Promise((resolve) => {
              const video = document.createElement('video');
              const url = URL.createObjectURL(file);
              video.src = url;
              video.onloadeddata = () => video.currentTime = 1;
              video.onseeked = () => {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext('2d')?.drawImage(video, 0, 0);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
              };
              video.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
            });
          } catch (e) { console.warn('Video frame extraction failed'); }
        } else if (!['eps', 'ai', 'pdf'].includes(extension || '')) {
          preview = URL.createObjectURL(file);
        }

        newAssets.push({
          id: Math.random().toString(36).substring(7),
          file,
          fileName,
          userId: user?.uid || '',
          preview,
          type,
          title: '',
          description: '',
          keywords: [],
          status: 'idle',
          createdAt: new Date().toISOString()
        });
      }

      // Update React state first so UI switches tabs and renders new elements instantly!
      setImages(prev => {
        const updatedPrev = prev.map(img => {
          const imgName = img.file?.name || img.fileName || '';
          if (!img.preview && (img.type === 'Video' || (img.type === 'Vector' && !imgName.toLowerCase().endsWith('.svg')))) {
            const normBase = normalize(imgName);
            const newRef = referenceImagesFound.get(normBase);
            if (newRef) {
              return { 
                ...img, 
                preview: newRef, 
                status: img.status === 'error' ? 'idle' : img.status 
              };
            }
          }
          return img;
        });
        return [...updatedPrev, ...newAssets];
      });
    };

    processFiles();
  }, [images]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 
      'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.svg'],
      'video/*': ['.mp4', '.mov', '.avi', '.webm'],
      'application/postscript': ['.eps', '.ai'],
      'application/pdf': ['.pdf']
    } as any,
    multiple: true
  } as any);

  // Metadata Generation Logic
  const generateMetadata = async (image: ImageMetadata) => {
    if (!image.preview && (image.type === 'Vector' || image.type === 'Video')) {
      const updatedImg = { 
        ...image, 
        status: 'error' as const, 
        error: 'Reference image required (JPG/PNG with same filename)' 
      };
      setImages(prev => prev.map(img => img.id === image.id ? updatedImg : img));
      return;
    }

    setImages(prev => prev.map(img => 
      img.id === image.id ? { ...img, status: 'processing' } : img
    ));

    try {
      const activeKey = settings.apiKeys.find(k => k.id === settings.activeKeyId) || null;

      let base64 = '';
      if (image.preview) {
        // Since image.preview is a blob: URL or base64, compressing it is incredibly fast (sub-second) and light on memory
        base64 = await compressToDataUrl(image.preview, 512, 512, 0.75);
      } else if (image.file) {
        // Compress the original File directly (no huge base64 strings loaded in JS memory!)
        base64 = await compressToDataUrl(image.file, 512, 512, 0.75);
      }

      if (!base64) {
        throw new Error("Could not compress or prepare image data for analysis.");
      }

      const data = await generateMetadataService(base64, settings, activeKey, image.type);

      const completedImg = { 
        ...image, 
        ...data,
        status: 'completed' as const 
      };

      setImages(prev => prev.map(img => img.id === image.id ? completedImg : img));
    } catch (error) {
      console.error('Generation Error:', error);
      const errorMsg = error instanceof Error ? error.message : 'Generation failed';
      const failedImg = { 
        ...image, 
        status: 'error' as const, 
        error: errorMsg 
      };
      setImages(prev => prev.map(img => img.id === image.id ? failedImg : img));
    }
  };

  const processBatch = async () => {
    setIsProcessingAll(true);
    const pending = images.filter(img => {
      const isIdleOrError = img.status === 'idle' || img.status === 'error';
      const needsPreview = (img.type === 'Vector' || img.type === 'Video');
      const hasPreview = !!img.preview;
      return isIdleOrError && (!needsPreview || hasPreview);
    });

    if (pending.length === 0) {
      setIsProcessingAll(false);
      return;
    }
    
    // In safe mode (recommended for Free tier keys), use 2 concurrent workers with 1200ms delay to prevent 429 quota exhaustion.
    const isSafe = settings.batchSpeed !== 'turbo';
    const CONCURRENCY = isSafe ? 2 : 3;
    const DELAY_MS = isSafe ? 1200 : 350;
    
    let completedCount = 0;
    setBatchProgress({
      total: pending.length,
      completed: 0,
      currentName: pending[0]?.fileName || pending[0]?.file?.name || 'Asset',
      isRateLimited: false
    });
    
    const queue = [...pending];
    
    const worker = async () => {
      while (queue.length > 0) {
        const img = queue.shift();
        if (!img) break;
        const assetName = img.fileName || img.file?.name || 'Asset';
        setBatchProgress(p => p ? { ...p, currentName: assetName } : null);

        try {
          await generateMetadata(img);
        } catch (e: any) {
          const msg = String(e?.message || '');
          if (msg.includes('429') || msg.includes('quota') || msg.includes('rate limit')) {
            setBatchProgress(p => p ? { ...p, isRateLimited: true } : null);
            // Brief cooling pause on rate limit
            await new Promise(r => setTimeout(r, 5000));
            setBatchProgress(p => p ? { ...p, isRateLimited: false } : null);
          }
        }

        completedCount++;
        setBatchProgress(p => p ? { ...p, completed: Math.min(completedCount, pending.length) } : null);

        // Controlled spacing between requests to stay below 15 RPM
        if (queue.length > 0) {
          await new Promise(r => setTimeout(r, DELAY_MS));
        }
      }
    };

    // Run up to CONCURRENCY workers concurrently
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker);
    await Promise.all(workers);

    setIsProcessingAll(false);
    setTimeout(() => setBatchProgress(null), 3500);
  };

  const removeImage = async (id: string) => {
    setImages(prev => {
      const img = prev.find(i => i.id === id);
      if (img?.preview && img.preview.startsWith('blob:')) URL.revokeObjectURL(img.preview);
      return prev.filter(i => i.id !== id);
    });
    if (user) {
      await deleteAssetFromDb(id).catch(e => console.error("Error deleting asset:", e));
    }
  };

  const clearAllImages = async () => {
    images.forEach(img => {
      if (img.preview && img.preview.startsWith('blob:')) {
        URL.revokeObjectURL(img.preview);
      }
    });
    setImages([]);
    setShowClearConfirm(false);
    if (user) {
      await clearAllAssetsFromDb(user.uid).catch(e => console.error("Error clearing assets:", e));
    }
  };

  const updateMetadata = (id: string, field: keyof ImageMetadata, value: any) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, [field]: value } : img));
  };

  const exportCSV = () => {
    const data = images.map(img => ({
      Filename: img.fileName || img.file?.name || "unnamed_asset",
      Title: img.title,
      Description: img.description,
      Keywords: img.keywords.join(',')
    }));

    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `LensLogic_Export_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const setManualPreview = async (id: string, file: File) => {
    const preview = URL.createObjectURL(file);
    setImages(prev => prev.map(img => img.id === id ? { ...img, preview, status: img.status === 'error' ? 'idle' : img.status } : img));
  };

  const copyKeywords = (keywords: string[]) => {
    navigator.clipboard.writeText(keywords.join(', '));
  };

  // Keyboard Shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Export: Ctrl + S
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (images.length > 0) exportCSV();
      }
      // Generate: Ctrl + Enter
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (activeTab === 'metadata') processBatch();
      }
      // Switch Tabs: Ctrl + 1, 2, 3, 4
      if ((e.ctrlKey || e.metaKey) && e.key === '1') setActiveTab('metadata');
      if ((e.ctrlKey || e.metaKey) && e.key === '2') setActiveTab('studio');
      if ((e.ctrlKey || e.metaKey) && e.key === '3') setActiveTab('settings');
      if ((e.ctrlKey || e.metaKey) && e.key === '4' && userProfile?.role === 'admin') setActiveTab('admin');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [images, activeTab]);

  if (loadingAuth) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#f8fafc] text-slate-600">
        <div className="text-center space-y-4">
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mx-auto" />
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Verifying Studio Session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuthSuccess={(currentUser) => setUser(currentUser)} />;
  }

  // Filter images by search and media type
  const filteredImages = images.filter((img) => {
    const matchesFilter = filterType === 'all' || img.type === filterType;
    const q = searchQuery.toLowerCase().trim();
    if (!q) return matchesFilter;
    const matchesSearch = 
      (img.fileName || img.file?.name || '').toLowerCase().includes(q) ||
      (img.title || '').toLowerCase().includes(q) ||
      (img.description || '').toLowerCase().includes(q) ||
      img.keywords.some(k => k.toLowerCase().includes(q));
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="flex h-screen bg-[#f8fafc] font-sans text-slate-800 overflow-hidden relative selection:bg-indigo-100 selection:text-indigo-900">
      {/* Custom Clear Confirmation Dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-rose-500 to-amber-500" />
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center border border-rose-200 shrink-0">
                <Trash2 className="text-rose-600 w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Clear Entire Library?</h3>
            </div>
            <p className="text-slate-600 text-sm mb-6 leading-relaxed">
              This action will permanently delete all <span className="text-slate-900 font-semibold">{images.length} assets</span> and their generated metadata from your library. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={clearAllImages}
                className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-bold transition-all shadow-md shadow-rose-600/20 cursor-pointer"
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Reset Session Confirmation Dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative overflow-hidden">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center border border-amber-200 shrink-0">
                <RotateCcw className="text-amber-600 w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Reset Session?</h3>
            </div>
            <p className="text-slate-600 text-sm mb-6 leading-relaxed">
              Are you sure you want to reset your studio session? Your current workspace assets will be cleared and a fresh guest session will start.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmResetSession}
                className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm font-bold transition-all shadow-md shadow-amber-600/20 cursor-pointer"
              >
                Reset Session
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Ambient Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-100/60 blur-[140px] rounded-full pointer-events-none"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[45%] h-[45%] bg-purple-100/50 blur-[140px] rounded-full pointer-events-none"></div>
      </div>

      {/* Sidebar (Desktop Studio Style - Light Theme) */}
      <aside className="w-72 h-full bg-white/90 backdrop-blur-xl border-r border-slate-200/80 flex flex-col z-30 shadow-xs">
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8 px-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-700 flex items-center justify-center shadow-md shadow-indigo-600/25 ring-1 ring-white/50">
              <ImageIcon className="text-white w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-900 leading-none">LensLogic Studio</h1>
              <p className="text-[10px] text-indigo-600 font-bold uppercase tracking-[0.18em] mt-1.5">Desktop Edition</p>
            </div>
          </div>

          <div className="space-y-6">
            <nav className="space-y-1.5">
              <SidebarItem 
                active={activeTab === 'metadata'} 
                icon={<Sparkles className="w-4 h-4 text-indigo-600" />} 
                label="Metadata Generator" 
                shortcut="^1"
                count={images.length}
                onClick={() => setActiveTab('metadata')} 
              />
              <SidebarItem 
                active={activeTab === 'studio'} 
                icon={<Layers className="w-4 h-4 text-indigo-600" />} 
                label="PSD & Vector Studio" 
                shortcut="^2"
                onClick={() => setActiveTab('studio')} 
              />
              <SidebarItem 
                active={activeTab === 'settings'} 
                icon={<Settings className="w-4 h-4" />} 
                label="AI Configuration" 
                shortcut="^3"
                onClick={() => setActiveTab('settings')} 
              />
              {userProfile?.role === 'admin' && (
                <SidebarItem 
                  active={activeTab === 'admin'} 
                  icon={<Shield className="w-4 h-4 text-indigo-600" />} 
                  label="Admin Dashboard" 
                  shortcut="^4"
                  onClick={() => setActiveTab('admin')} 
                />
              )}
            </nav>

            {/* Metadata Settings - Shows only when files are imported */}
            {images.length > 0 && (
              <div className="pt-4 border-t border-slate-200/80 space-y-4 px-1 animate-in fade-in slide-in-from-top-1 duration-200">
                <header className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                    Metadata Settings
                  </p>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                    {images.length} {images.length === 1 ? 'file' : 'files'}
                  </span>
                </header>

                {/* Title Length */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-600 block">Title Length</label>
                  <select 
                    value={settings.titleLength}
                    onChange={(e) => setSettings(s => ({ ...s, titleLength: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer shadow-xs"
                  >
                    <option value="20-50">Short (20–50 chars)</option>
                    <option value="20-100">Medium (20–100 chars)</option>
                    <option value="20-200">Long (20–200 chars)</option>
                  </select>
                </div>

                {/* Keyword Count */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-600">
                    <span>Keyword Count</span>
                    <span className="text-indigo-600 font-mono font-bold">{settings.keywordCount || 30}</span>
                  </div>
                  <input 
                    type="range"
                    min="10" 
                    max="50"
                    step="1"
                    value={settings.keywordCount || 30}
                    onChange={(e) => setSettings(s => ({ ...s, keywordCount: parseInt(e.target.value, 10) || 30 }))}
                    className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg appearance-none"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400 font-medium">
                    <span>10 min</span>
                    <span>30 std</span>
                    <span>50 max</span>
                  </div>
                </div>

                {/* Title Prefix */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-600 block">Title Prefix</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Premium"
                    value={settings.prefix || ''}
                    onChange={(e) => setSettings(s => ({ ...s, prefix: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 shadow-xs"
                  />
                </div>

                {/* Title Suffix */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-600 block">Title Suffix</label>
                  <input 
                    type="text" 
                    placeholder="e.g. 2025"
                    value={settings.suffix || ''}
                    onChange={(e) => setSettings(s => ({ ...s, suffix: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 shadow-xs"
                  />
                </div>
              </div>
            )}

              {/* Safe Mode Rate Limit Badge in Sidebar */}
              <div className="p-3 bg-slate-50 border border-slate-200/70 rounded-xl">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Free-Tier Shield</span>
                  </div>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Active
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Automatic quota protection prevents 429 errors & Pro quota limits on free Gemini keys.
                </p>
              </div>
            </div>
          </div>

        {/* Desktop Sidebar Bottom */}
        <div className="p-5 border-t border-slate-200/80 bg-slate-50/70">
          <button 
            onClick={exportCSV}
            disabled={images.length === 0}
            className="w-full h-10 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2 cursor-pointer mb-4 text-xs group"
          >
            <Download className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
            Export Collection
            <span className="ml-auto text-[10px] opacity-70 font-mono">^S</span>
          </button>

          <div className="flex items-center justify-between gap-2.5 px-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-slate-200 border border-slate-300 overflow-hidden flex items-center justify-center shrink-0">
                 <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.uid || 'Felix'}`} alt="avatar" className="w-full h-full" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-900 truncate">
                  {userProfile?.displayName || userProfile?.email || 'Guest Workspace'}
                </p>
                <p className="text-[10px] text-indigo-600 font-bold uppercase truncate">
                  {userProfile?.role === 'admin' ? 'Studio Admin' : 'Creator'}
                </p>
              </div>
            </div>
            <button 
              onClick={handleSignOut}
              className="p-1.5 hover:bg-slate-200 text-slate-500 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
              title="Reset Workspace Session"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 relative overflow-y-auto custom-scrollbar h-full bg-[#f8fafc]">
        <div className="max-w-7xl mx-auto p-6 lg:p-12">
          
          <AnimatePresence mode="wait">
            {activeTab === 'metadata' && (
              <motion.div
                key="metadata"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                {!settings.activeKeyId && (
                  <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-center gap-3.5 shadow-xs">
                    <div className="p-2 bg-amber-100 rounded-xl text-amber-700 shrink-0">
                      <Key className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-xs font-bold text-amber-900 uppercase tracking-tight">API Key Required</h4>
                      <p className="text-xs text-amber-700 mt-0.5">
                        LensLogic requires a Gemini API Key to analyze your assets. Go to{' '}
                        <button onClick={() => setActiveTab('settings')} className="underline font-bold hover:text-amber-900">
                          AI Configuration
                        </button>{' '}
                        to add your free key.
                      </p>
                    </div>
                  </div>
                )}

                {/* Batch Progress Bar */}
                {batchProgress && (
                  <div className="p-4 bg-indigo-50/80 border border-indigo-200/80 rounded-2xl shadow-xs space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                        <span className="font-bold text-indigo-950">
                          Analyzing {batchProgress.completed} of {batchProgress.total}:
                        </span>
                        <span className="text-indigo-700 font-medium truncate max-w-xs">{batchProgress.currentName}</span>
                      </div>
                      <span className="font-mono text-indigo-700 font-bold text-xs">
                        {Math.round((batchProgress.completed / Math.max(1, batchProgress.total)) * 100)}%
                      </span>
                    </div>
                    <div className="w-full bg-indigo-200/60 rounded-full h-2 overflow-hidden">
                      <div 
                        className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                        style={{ width: `${(batchProgress.completed / Math.max(1, batchProgress.total)) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {images.length === 0 ? (
                  <div className="space-y-8">
                    <header>
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200/60 text-indigo-700 text-xs font-semibold mb-3">
                        <Sparkles className="w-3.5 h-3.5" />
                        AI Stock Asset Optimization
                      </div>
                      <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 mb-2">Metadata Generator</h2>
                      <p className="text-slate-600 text-base max-w-xl">
                        Batch generate high-converting titles, descriptions, and keywords optimized for Adobe Stock, Shutterstock, and Freepik.
                      </p>
                    </header>

                    <div 
                      {...getRootProps()} 
                      className={cn(
                        "relative group h-[320px] rounded-3xl border-2 border-dashed flex flex-col items-center justify-center transition-all duration-200 cursor-pointer bg-white shadow-xs",
                        isDragActive 
                          ? "border-indigo-500 bg-indigo-50/40 shadow-lg shadow-indigo-500/10" 
                          : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50/60 hover:shadow-md"
                      )}
                    >
                      <input {...getInputProps()} />
                      <div className="w-16 h-16 rounded-2xl bg-indigo-50 group-hover:bg-indigo-100 flex items-center justify-center mb-5 transition-all duration-200">
                        <Upload className={cn("w-7 h-7 transition-colors duration-200", isDragActive ? "text-indigo-600" : "text-indigo-500")} />
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-slate-800">Drag & drop stock assets here</p>
                        <p className="text-slate-500 text-sm mt-1">or <span className="text-indigo-600 font-semibold underline underline-offset-2">browse files</span> from your computer</p>
                      </div>
                      <div className="mt-7 flex items-center gap-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        <span>JPEG & PNG</span>
                        <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                        <span>AI & EPS Vectors</span>
                        <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                        <span>MP4 Videos</span>
                        <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                        <span>Illustrations</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Sticky Action and Filter Bar */}
                    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between sticky top-0 py-3 bg-[#f8fafc]/95 backdrop-blur-md z-10 gap-3 border-b border-slate-200/80">
                      <div>
                        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Metadata Generator</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {images.length} {images.length === 1 ? 'file' : 'files'} ({images.filter(i => i.status === 'completed').length} completed)
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        {/* Search Input */}
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input 
                            type="text"
                            placeholder="Search assets..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 w-44 lg:w-56 shadow-xs"
                          />
                        </div>

                        {/* Batch Action Buttons */}
                        {images.filter(i => i.status === 'idle').length > 0 && (
                          <button 
                            onClick={processBatch}
                            disabled={isProcessingAll}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-sm hover:shadow flex items-center gap-2 cursor-pointer"
                          >
                            {isProcessingAll ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            Generate All ({images.filter(i => i.status === 'idle').length})
                          </button>
                        )}

                        <button 
                          {...getRootProps()}
                          className="px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                        >
                          <input {...getInputProps()} />
                          <Plus className="w-3.5 h-3.5" />
                          Add More Files
                        </button>

                        <button 
                          onClick={exportCSV}
                          className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                          title="Export metadata as CSV"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Export CSV
                        </button>

                        <button 
                          onClick={() => setShowClearConfirm(true)}
                          className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-xl text-xs font-semibold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                          title="Clear all assets from this session"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Clear All
                        </button>
                      </div>
                    </div>

                    {/* Filter Pills */}
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                      {(['all', 'Photo', 'Vector', 'Illustration', 'Video'] as const).map((type) => (
                        <button
                          key={type}
                          onClick={() => setFilterType(type)}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap",
                            filterType === type 
                              ? "bg-slate-900 text-white shadow-xs" 
                              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900"
                          )}
                        >
                          {type === 'all' ? 'All Files' : `${type}s`}
                          <span className="ml-1.5 text-[10px] opacity-70">
                            ({type === 'all' ? images.length : images.filter(i => i.type === type).length})
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Filtered Assets List or Empty Search Result */}
                    {filteredImages.length === 0 ? (
                      <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 p-8 shadow-xs">
                        <Search className="w-8 h-8 text-slate-400 mx-auto mb-3" />
                        <p className="text-sm font-semibold text-slate-800">No assets match your search</p>
                        <p className="text-xs text-slate-500 mt-1">Try clearing your search query or filter tags.</p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden divide-y divide-slate-100 shadow-xs">
                        {filteredImages.map(image => (
                          <MetadataRow 
                            key={image.id} 
                            image={image} 
                            onGenerate={() => generateMetadata(image)}
                            onRemove={() => removeImage(image.id)}
                            onUpdate={(field: keyof ImageMetadata, val: any) => updateMetadata(image.id, field, val)}
                            onSetPreview={(file: File) => setManualPreview(image.id, file)}
                            onCopyKeywords={() => copyKeywords(image.keywords)}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}

            {activeTab === 'studio' && (
              <motion.div
                key="studio"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.2 }}
              >
                <FreepikConverter />
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.2 }}
                className="max-w-2xl mx-auto space-y-6"
              >
                <header>
                  <h2 className="text-3xl font-bold tracking-tight text-slate-900 mb-1.5">AI Configuration</h2>
                  <p className="text-sm text-slate-500">Fine-tune how LensLogic analyzes your assets and configure your API keys.</p>
                </header>

                <div className="bg-white rounded-3xl border border-slate-200/90 p-7 space-y-7 shadow-xs">
                  {/* API Management Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <header>
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">API Keys</label>
                        <p className="text-xs text-slate-500 mt-0.5">Google Gemini API keys (Free tier protected)</p>
                      </header>
                      <button 
                        onClick={() => {
                          const id = Math.random().toString(36).substring(7);
                          setSettings(s => ({ 
                            ...s, 
                            apiKeys: [...s.apiKeys, { id, label: 'Gemini Key', key: '', provider: 'Gemini' }],
                            activeKeyId: s.activeKeyId || id
                          }));
                        }}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-xs flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Key
                      </button>
                    </div>

                    <div className="space-y-3">
                      {settings.apiKeys.length === 0 && (
                        <div className="p-4 border border-emerald-200 rounded-2xl bg-emerald-50/50 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                              <Sparkles className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-800">Server-Side Gemini Engine Active</p>
                              <p className="text-[11px] text-slate-500">Ready to generate metadata automatically for everyone. You can optionally add custom keys above.</p>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                            Active
                          </span>
                        </div>
                      )}
                      
                      {settings.apiKeys.map((entry) => (
                        <div key={entry.id} className={cn(
                          "p-4 rounded-2xl border transition-all space-y-3",
                          settings.activeKeyId === entry.id ? "bg-indigo-50/40 border-indigo-200" : "bg-slate-50/60 border-slate-200"
                        )}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <button 
                                onClick={() => setSettings(s => ({ ...s, activeKeyId: entry.id }))}
                                className={cn(
                                  "w-4 h-4 rounded-full border flex items-center justify-center transition-all cursor-pointer",
                                  settings.activeKeyId === entry.id ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white"
                                )}
                              >
                                {settings.activeKeyId === entry.id && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                              </button>
                              <input 
                                value={entry.label}
                                onChange={(e) => {
                                  const newKeys = settings.apiKeys.map(k => k.id === entry.id ? { ...k, label: e.target.value } : k);
                                  setSettings(s => ({ ...s, apiKeys: newKeys }));
                                }}
                                className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none border-b border-transparent focus:border-slate-400 w-36"
                              />
                            </div>
                            <button 
                              onClick={() => {
                                const newKeys = settings.apiKeys.filter(k => k.id !== entry.id);
                                setSettings(s => ({ 
                                  ...s, 
                                  apiKeys: newKeys,
                                  activeKeyId: s.activeKeyId === entry.id ? (newKeys[0]?.id || null) : s.activeKeyId
                                }));
                              }}
                              className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                              title="Delete API Key"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="flex gap-3">
                            <select 
                              value={entry.provider}
                              onChange={(e) => {
                                const newKeys = settings.apiKeys.map(k => k.id === entry.id ? { ...k, provider: e.target.value as any } : k);
                                setSettings(s => ({ ...s, apiKeys: newKeys }));
                              }}
                              className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer shadow-xs"
                            >
                              <option value="Gemini">Gemini</option>
                              <option value="Groq">Groq</option>
                            </select>
                            <input 
                              type="password"
                              placeholder="AIzaSy..."
                              value={entry.key}
                              onChange={(e) => {
                                const newKeys = settings.apiKeys.map(k => k.id === entry.id ? { ...k, key: e.target.value } : k);
                                setSettings(s => ({ ...s, apiKeys: newKeys }));
                              }}
                              className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 font-mono shadow-xs"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Batch Speed & Free Tier Rate Limiting */}
                  <div className="space-y-3 pt-4 border-t border-slate-100">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest block">
                      Batch Processing Mode
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setSettings(s => ({ ...s, batchSpeed: 'safe' }))}
                        className={cn(
                          "p-3 rounded-xl border text-left transition-all cursor-pointer",
                          (settings.batchSpeed || 'safe') === 'safe'
                            ? "bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200"
                            : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-900">Safe Mode (Recommended)</span>
                          {(settings.batchSpeed || 'safe') === 'safe' && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                        </div>
                        <p className="text-[10px] text-slate-500 leading-tight">
                          Prevents 429 Quota Exceeded errors on Free-Tier Gemini keys (15 RPM compliant).
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSettings(s => ({ ...s, batchSpeed: 'turbo' }))}
                        className={cn(
                          "p-3 rounded-xl border text-left transition-all cursor-pointer",
                          settings.batchSpeed === 'turbo'
                            ? "bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200"
                            : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-900">Turbo Mode</span>
                          {settings.batchSpeed === 'turbo' && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                        </div>
                        <p className="text-[10px] text-slate-500 leading-tight">
                          Higher parallelism for paid Google Cloud tier with high rate limits.
                        </p>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4 border-t border-slate-100">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Title Constraints</label>
                      <select 
                        value={settings.titleLength}
                        onChange={(e) => setSettings(s => ({ ...s, titleLength: e.target.value }))}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer shadow-xs"
                      >
                        <option value="20-50">Short (20-50 chars)</option>
                        <option value="20-100">Medium (20-100 chars)</option>
                        <option value="20-200">Long (20-200 chars)</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Keyword Count</label>
                      <input 
                        type="number" 
                        min="10" 
                        max="50"
                        value={settings.keywordCount}
                        onChange={(e) => setSettings(s => ({ ...s, keywordCount: parseInt(e.target.value) }))}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:border-indigo-500 shadow-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Title Prefix</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Premium"
                        value={settings.prefix}
                        onChange={(e) => setSettings(s => ({ ...s, prefix: e.target.value }))}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 shadow-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Title Suffix</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 2025"
                        value={settings.suffix}
                        onChange={(e) => setSettings(s => ({ ...s, suffix: e.target.value }))}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 shadow-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Negative Keywords</label>
                    <textarea 
                      placeholder="Exclude terms like: blur, noisy, low-quality"
                      value={settings.negativeKeywords}
                      onChange={(e) => setSettings(s => ({ ...s, negativeKeywords: e.target.value }))}
                      className="w-full h-20 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 resize-none focus:outline-none focus:border-indigo-500 shadow-xs"
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'admin' && userProfile?.role === 'admin' && (
              <motion.div
                key="admin"
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
              >
                <AdminPanel />
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </main>
    </div>
  );
}

function SidebarItem({ active, icon, label, count, shortcut, onClick }: { active: boolean, icon: ReactNode, label: string, count?: number, shortcut?: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all duration-150 cursor-pointer group text-xs",
        active 
          ? "bg-indigo-50 text-indigo-700 font-bold ring-1 ring-indigo-200/80 shadow-xs" 
          : "text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 font-medium"
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn("transition-transform duration-200", active ? "text-indigo-600 scale-105" : "text-slate-400 group-hover:text-slate-600")}>
          {icon}
        </div>
        <span className="tracking-tight">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {count !== undefined && count > 0 && (
          <span className={cn(
            "text-[9px] px-1.5 py-0.5 rounded-md font-mono font-bold",
            active ? "bg-indigo-200/80 text-indigo-900" : "bg-slate-200/80 text-slate-600"
          )}>
            {count}
          </span>
        )}
        {shortcut && (
          <span className="text-[9px] font-mono text-slate-400 opacity-60 group-hover:opacity-100 transition-opacity font-semibold">{shortcut}</span>
        )}
      </div>
    </button>
  );
}


const MetadataRow = React.memo(function MetadataRow({ 
  image, 
  onGenerate, 
  onRemove, 
  onUpdate,
  onSetPreview,
  onCopyKeywords
}: any) {
  const [copied, setCopied] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Maintain local state for snappy, zero-lag typing
  const [localTitle, setLocalTitle] = useState(image.title || "");
  const [localDescription, setLocalDescription] = useState(image.description || "");

  // Keep local state synchronized with incoming prop updates (e.g., when AI generation completes)
  React.useEffect(() => {
    setLocalTitle(image.title || "");
  }, [image.title]);

  React.useEffect(() => {
    setLocalDescription(image.description || "");
  }, [image.description]);

  const handleCopy = () => {
    onCopyKeywords();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePreviewUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onSetPreview(file);
    }
  };

  const handleTitleBlur = () => {
    if (localTitle !== image.title) {
      onUpdate('title', localTitle);
    }
  };

  const handleDescriptionBlur = () => {
    if (localDescription !== image.description) {
      onUpdate('description', localDescription);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="hover:bg-slate-50/70 transition-colors group relative bg-white"
    >
      <div className="flex flex-col lg:flex-row items-center p-5 gap-5">
        <div className="w-full lg:w-48 relative h-36 lg:h-36 bg-slate-100 rounded-2xl border border-slate-200 overflow-hidden shadow-xs shrink-0">
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handlePreviewUpload}
            accept="image/*"
            className="hidden"
          />
          
          {image.preview ? (
            <div className="relative w-full h-full bg-slate-100">
              <img src={image.preview} alt="preview" className="w-full h-full object-cover" />
              {(image.type === 'Vector' || image.type === 'Video') && (
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-2 right-2 p-1.5 bg-slate-900/70 hover:bg-slate-900 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm cursor-pointer shadow-xs"
                  title="Change Preview Image"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-full flex flex-col items-center justify-center bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors group/preview cursor-pointer"
            >
              {image.type === 'Video' ? (
                <VideoIcon className="w-7 h-7 mb-1 text-indigo-500 group-hover/preview:scale-110 transition-transform" />
              ) : (
                <Key className="w-7 h-7 mb-1 text-amber-500 group-hover/preview:scale-110 transition-transform" />
              )}
              <span className="text-[10px] font-bold uppercase text-slate-700">
                {image.type === 'Video' ? 'Video File' : 'EPS/AI Vector'}
              </span>
              <p className="text-[9px] px-3 text-center mt-1.5 leading-tight text-indigo-600 font-bold uppercase">
                + Upload JPG Preview
              </p>
            </button>
          )}
          
          {image.preview && (image.type === 'Video' || (image.type === 'Vector' && !(image.fileName || image.file?.name || '').toLowerCase().endsWith('.svg'))) && (
            <div className="absolute top-2 right-2 px-2 py-0.5 bg-emerald-600/90 backdrop-blur-sm rounded text-[8px] font-bold text-white flex items-center gap-1 shadow-xs">
              <Check className="w-2.5 h-2.5" /> REF MATCHED
            </div>
          )}

          <div className="absolute top-2 left-2 flex flex-col gap-1">
            <span className={cn(
              "px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider backdrop-blur-sm text-white shadow-xs",
              image.status === 'completed' && "bg-emerald-600",
              image.status === 'processing' && "bg-indigo-600 animate-pulse",
              image.status === 'idle' && "bg-slate-700",
              image.status === 'error' && "bg-rose-600",
            )}>
              {image.status}
            </span>
            <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider backdrop-blur-sm bg-slate-900/70 text-white">
              {image.type}
            </span>
          </div>

          <button 
            onClick={onRemove}
            className="absolute top-2 right-2 p-1.5 bg-white/90 hover:bg-rose-600 hover:text-white text-slate-600 rounded-lg backdrop-blur-sm transition-all cursor-pointer border border-slate-200/80 shadow-xs"
            title="Remove asset"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 w-full">
          {image.status === 'idle' || image.status === 'error' ? (
            <div className="h-full flex items-center justify-between p-4 bg-slate-50/80 rounded-xl border border-slate-200/80">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600">
                  <ImageIcon className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold text-slate-900">{image.fileName || image.file?.name || 'Asset'}</p>
                  {!image.preview && (image.type === 'Vector' || image.type === 'Video') ? (
                    <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wide flex items-center gap-1 mt-0.5">
                      <AlertCircle className="w-3 h-3" /> Preview Image Required for AI
                    </p>
                  ) : image.status === 'error' ? (
                    <p className="text-[10px] text-rose-600 font-semibold tracking-wide flex items-center gap-1 mt-0.5">
                      <AlertCircle className="w-3 h-3" /> {image.error || 'Generation Error'}
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-500 font-medium tracking-wide mt-0.5">Ready for metadata generation</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={onGenerate}
                  disabled={!image.preview && (image.type === 'Vector' || image.type === 'Video')}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Analyze AI
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="space-y-2.5">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block text-left">
                    Title (Optimized)
                  </label>
                  <input 
                    type="text" 
                    value={localTitle}
                    onChange={(e) => setLocalTitle(e.target.value)}
                    onBlur={handleTitleBlur}
                    disabled={image.status === 'processing'}
                    placeholder="Generating title..."
                    className="w-full text-xs font-bold text-slate-900 bg-transparent border-b border-slate-200 hover:border-slate-300 focus:border-indigo-600 focus:outline-none transition-all pb-1 placeholder:text-slate-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block text-left">
                    Description
                  </label>
                  <textarea 
                     value={localDescription}
                     onChange={(e) => setLocalDescription(e.target.value)}
                     onBlur={handleDescriptionBlur}
                     disabled={image.status === 'processing'}
                     rows={2}
                     placeholder="Analyzing visual details..."
                     className="w-full text-xs text-slate-600 bg-transparent border-b border-slate-200 hover:border-slate-300 focus:border-indigo-600 focus:outline-none transition-all resize-none placeholder:text-slate-400 leading-relaxed"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block text-left">
                    Keywords ({image.keywords.length})
                  </label>
                  {image.keywords.length > 0 && (
                    <button 
                      onClick={handleCopy}
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      {copied ? 'Copied!' : 'Copy Keywords'}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1 custom-scrollbar">
                  {image.status === 'processing' ? (
                    <div className="w-full flex gap-1.5">
                      {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-5 w-16 bg-slate-100 animate-pulse rounded-md" />)}
                    </div>
                  ) : (
                    image.keywords.map((kw: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200/80 text-slate-700 rounded-md text-[10px] font-medium border border-slate-200/60 transition-colors">
                        {kw}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {image.status === 'processing' && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-indigo-100 overflow-hidden">
          <div className="h-full bg-indigo-600 w-1/3 animate-[shimmer_2s_infinite_linear]"></div>
        </div>
      )}
    </motion.div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.image.id === nextProps.image.id &&
    prevProps.image.status === nextProps.image.status &&
    prevProps.image.title === nextProps.image.title &&
    prevProps.image.description === nextProps.image.description &&
    prevProps.image.preview === nextProps.image.preview &&
    prevProps.image.error === nextProps.image.error &&
    prevProps.image.keywords?.length === nextProps.image.keywords?.length &&
    JSON.stringify(prevProps.image.keywords) === JSON.stringify(nextProps.image.keywords)
  );
});
