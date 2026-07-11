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
  LogOut
} from 'lucide-react';
import { useDropzone, type Accept } from 'react-dropzone';
import Papa from 'papaparse';
import { cn } from './lib/utils';
import { generateMetadata as generateMetadataService } from './services/aiService';
import type { Platform, GenerationSettings, ImageMetadata, ApiResponse, AssetType } from './types';

// Firebase Integrations
import { 
  saveUserProfile, 
  getUserProfile, 
  saveAsset, 
  loadUserAssets, 
  deleteAssetFromDb,
  clearAllAssetsFromDb
} from './services/dbService';
import AuthScreen from './components/AuthScreen';
import AdminPanel from './components/AdminPanel';

const PLATFORMS: Platform[] = ['Adobe Stock', 'Shutterstock', 'Freepik', 'Getty Images', 'Draft'];

const dropzoneAccept: Accept = { 'image/*': [] };

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [images, setImages] = useState<ImageMetadata[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'results' | 'settings' | 'admin'>('upload');
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [settings, setSettings] = useState<GenerationSettings>(() => {
    const saved = localStorage.getItem('lenslogic_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed.apiKeys) || (parsed.apiKeys.length > 0 && typeof parsed.apiKeys[0] === 'string')) {
        parsed.apiKeys = [];
        parsed.activeKeyId = null;
      }
      return parsed;
    }
    return {
      platform: 'Adobe Stock',
      titleLength: '20-200',
      keywordCount: 30,
      prefix: '',
      suffix: '',
      negativeKeywords: '',
      apiKeys: [],
      activeKeyId: null
    };
  });

  // Check auth state on mount and sync assets
  React.useEffect(() => {
    const initAuth = async () => {
      const savedUser = localStorage.getItem('lenslogic_user');
      if (savedUser) {
        try {
          const currentUser = JSON.parse(savedUser);
          setUser(currentUser);
          setUserProfile(currentUser);
          
          if (currentUser.savedSettings) {
            setSettings(currentUser.savedSettings);
          }

          const savedAssets = await loadUserAssets(currentUser.uid);
          setImages(savedAssets);
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

  const handleSignOut = async () => {
    localStorage.removeItem('lenslogic_user');
    setUser(null);
    setUserProfile(null);
    setImages([]);
    setActiveTab('upload');
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

      // Save newly created assets to Firestore
      if (user) {
        for (const asset of newAssets) {
          try {
            await saveAsset(asset, user.uid);
          } catch (e) {
            console.error("Failed to save asset to Firestore:", e);
          }
        }
      }

      // Check if any of these new reference images should update existing EPS/Videos
      setImages(prev => {
        const updatedPrev = prev.map(img => {
          const imgName = img.file?.name || img.fileName || '';
          if (!img.preview && (img.type === 'Video' || (img.type === 'Vector' && !imgName.toLowerCase().endsWith('.svg')))) {
            const normBase = normalize(imgName);
            const newRef = referenceImagesFound.get(normBase);
            if (newRef) {
              const updatedImg = { 
                ...img, 
                preview: newRef, 
                status: img.status === 'error' ? 'idle' : img.status 
              };
              if (user) {
                saveAsset(updatedImg, user.uid).catch(e => console.error("Error saving updated reference:", e));
              }
              return updatedImg;
            }
          }
          return img;
        });
        return [...updatedPrev, ...newAssets];
      });
    };

    processFiles();
    setActiveTab('results');
  }, [images, user]);

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
      if (user) {
        saveAsset(updatedImg, user.uid).catch(e => console.error("Error saving status:", e));
      }
      return;
    }

    setImages(prev => prev.map(img => 
      img.id === image.id ? { ...img, status: 'processing' } : img
    ));

    try {
      const activeKey = settings.apiKeys.find(k => k.id === settings.activeKeyId) || null;

      let fileToAnalyze: Blob | File | null = image.file || null;
      if (image.preview && !fileToAnalyze) {
        try {
          const response = await fetch(image.preview);
          fileToAnalyze = await response.blob();
        } catch (e) {
          console.warn('Failed to fetch preview blob:', e);
        }
      }

      if (!fileToAnalyze) {
        throw new Error("No image data available to analyze. Please upload a valid asset.");
      }

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(fileToAnalyze as Blob);
      });
      
      const base64 = await base64Promise;
      const data = await generateMetadataService(base64, settings, activeKey, image.type);

      const completedImg = { 
        ...image, 
        ...data,
        status: 'completed' as const 
      };

      setImages(prev => prev.map(img => img.id === image.id ? completedImg : img));
      if (user) {
        await saveAsset(completedImg, user.uid);
      }
    } catch (error) {
      console.error('Generation Error:', error);
      const errorMsg = error instanceof Error ? error.message : 'Generation failed';
      const failedImg = { 
        ...image, 
        status: 'error' as const, 
        error: errorMsg 
      };
      setImages(prev => prev.map(img => img.id === image.id ? failedImg : img));
      if (user) {
        saveAsset(failedImg, user.uid).catch(e => console.error("Error saving failed asset:", e));
      }
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
    
    for (const img of pending) {
      await generateMetadata(img);
    }
    setIsProcessingAll(false);
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
    setImages(prev => {
      const updated = prev.map(img => img.id === id ? { ...img, [field]: value } : img);
      const target = updated.find(img => img.id === id);
      if (target && user) {
        saveAsset(target, user.uid).catch(e => console.error("Error updating asset field:", e));
      }
      return updated;
    });
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
    setImages(prev => {
      const updated = prev.map(img => img.id === id ? { ...img, preview, status: img.status === 'error' ? 'idle' : img.status } : img);
      const target = updated.find(img => img.id === id);
      if (target && user) {
        saveAsset(target, user.uid).catch(e => console.error("Error setting manual preview:", e));
      }
      return updated;
    });
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
        if (activeTab === 'results') processBatch();
      }
      // Switch Tabs: Ctrl + 1, 2, 3
      if ((e.ctrlKey || e.metaKey) && e.key === '1') setActiveTab('upload');
      if ((e.ctrlKey || e.metaKey) && e.key === '2') setActiveTab('results');
      if ((e.ctrlKey || e.metaKey) && e.key === '3') setActiveTab('settings');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [images, activeTab]);

  if (loadingAuth) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#06040a] text-slate-300">
        <div className="text-center space-y-4">
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mx-auto" />
          <p className="text-sm font-semibold uppercase tracking-wider text-indigo-400">Verifying Studio Session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuthSuccess={(currentUser) => setUser(currentUser)} />;
  }

  return (
    <div className="flex h-screen bg-[#06040a] font-sans text-slate-100 overflow-hidden relative selection:bg-indigo-500/30">
      {/* Custom Clear Confirmation Dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#110f17] border border-white/10 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative overflow-hidden">
            {/* Ambient indicator accent line */}
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-rose-500 to-amber-500" />
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center border border-rose-500/20 shrink-0">
                <Trash2 className="text-rose-400 w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-white">Clear Entire Library?</h3>
            </div>
            <p className="text-slate-400 text-sm mb-6 leading-relaxed">
              This action will permanently delete all <span className="text-white font-semibold">{images.length} assets</span> and their generated metadata from your library. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl text-sm font-semibold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={clearAllImages}
                className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-rose-600/30 cursor-pointer"
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-indigo-600/10 blur-[130px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[130px] rounded-full"></div>
      </div>

      {/* Sidebar (Desktop Studio Style) */}
      <aside className="w-72 h-full desktop-backdrop flex flex-col z-30 shadow-2xl">
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-10 px-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-lg shadow-indigo-500/40 ring-1 ring-white/20">
              <ImageIcon className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white leading-none">LensLogic Studio</h1>
              <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-[0.2em] mt-1.5 opacity-80">Desktop Edition</p>
            </div>
          </div>

          <div className="space-y-8">
            <nav className="space-y-1.5">
              <SidebarItem 
                active={activeTab === 'upload'} 
                icon={<Upload className="w-4 h-4" />} 
                label="Import Content" 
                shortcut="^1"
                onClick={() => setActiveTab('upload')} 
              />
              <SidebarItem 
                active={activeTab === 'results'} 
                icon={<LayoutDashboard className="w-4 h-4" />} 
                label="Asset Library" 
                shortcut="^2"
                count={images.length}
                onClick={() => setActiveTab('results')} 
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
                  icon={<Shield className="w-4 h-4 text-indigo-400" />} 
                  label="Admin Dashboard" 
                  shortcut="^4"
                  onClick={() => setActiveTab('admin')} 
                />
              )}
            </nav>

            <div className="pt-4 border-t border-white/5 space-y-5">
              <div className="px-2">
                <header className="flex items-center justify-between mb-4">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Target Engine</p>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-mono text-slate-500">{images.length} assets</span>
                  </div>
                </header>
                <div className="grid grid-cols-1 gap-1">
                  {PLATFORMS.map(p => (
                    <button
                      key={p}
                      onClick={() => setSettings(s => ({ ...s, platform: p }))}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-200 text-[11px] font-semibold cursor-pointer group",
                        settings.platform === p 
                          ? "bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-500/30" 
                          : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
                      )}
                    >
                      {p}
                      <Check className={cn("w-3 h-3 transition-transform", settings.platform === p ? "scale-100" : "scale-0")} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop Sidebar Bottom */}
        <div className="p-6 border-t border-white/5 bg-black/20">
          <button 
            onClick={exportCSV}
            disabled={images.length === 0}
            className="w-full h-11 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all border border-white/10 flex items-center justify-center gap-2 cursor-pointer mb-6 text-sm group"
          >
            <Download className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
            Export Collection
            <span className="ml-auto text-[10px] opacity-30 font-mono">^S</span>
          </button>

          <div className="flex items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-slate-800 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                 <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.email || 'Felix'}`} alt="avatar" className="w-full h-full" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-white truncate">{user?.email?.split('@')[0] || 'Contributor'}</p>
                <p className="text-[10px] text-emerald-400 font-bold uppercase truncate">
                  {userProfile?.role === 'admin' ? 'Admin Access' : 'Pro Plan Active'}
                </p>
              </div>
            </div>
            <button 
              onClick={handleSignOut}
              className="p-2 hover:bg-white/5 hover:text-rose-400 text-slate-500 rounded-lg transition-colors cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 relative overflow-y-auto custom-scrollbar h-full bg-black/10">
        <div className="max-w-7xl mx-auto p-8 lg:p-14">
          
          <AnimatePresence mode="wait">
            {activeTab === 'upload' && (
              <motion.div
                key="upload"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <header>
                  <h2 className="text-4xl font-display font-bold text-white mb-2">Enhance your workflow</h2>
                  <p className="text-slate-400 max-w-lg">Batch generate optimized metadata for your stock assets using cutting-edge AI analysis.</p>
                </header>

                <div 
                  {...getRootProps()} 
                  className={cn(
                    "relative group h-[340px] rounded-3xl border-2 border-dashed flex flex-col items-center justify-center transition-all duration-300 cursor-pointer",
                    isDragActive ? "border-indigo-400 bg-indigo-500/10 shadow-[0_0_40px_rgba(99,102,241,0.1)]" : "border-white/10 hover:border-white/20 bg-white/5"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="w-16 h-16 rounded-2xl bg-white/5 group-hover:bg-indigo-500/20 flex items-center justify-center mb-6 transition-all duration-300">
                    <Upload className={cn("w-8 h-8 transition-colors duration-300", isDragActive ? "text-indigo-400" : "text-slate-500")} />
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-medium text-white">Drag & drop assets</p>
                    <p className="text-slate-500 mt-1">or click to browse from files</p>
                  </div>
                  <div className="mt-8 flex items-center gap-4 text-[10px] font-bold text-slate-600 uppercase tracking-[0.2em]">
                    <span>Images</span>
                    <span className="w-1 h-1 rounded-full bg-slate-700"></span>
                    <span>Videos</span>
                    <span className="w-1 h-1 rounded-full bg-slate-700"></span>
                    <span>Vectors</span>
                    <span className="w-1 h-1 rounded-full bg-slate-700"></span>
                    <span>Illustrations</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <FeatureCard 
                    icon={<RefreshCw className="w-5 h-5 text-indigo-400" />}
                    title="Batch Power"
                    description="Process large collections simultaneously with parallel AI analysis."
                  />
                  <FeatureCard 
                    icon={<Search className="w-5 h-5 text-emerald-400" />}
                    title="SEO Optimized"
                    description="Keywords crafted for high conversion on major stock platforms."
                  />
                  <FeatureCard 
                    icon={<CheckCircle2 className="w-5 h-5 text-amber-400" />}
                    title="Smart Context"
                    description="Detects mood, lighting, and semantic depth with high precision."
                  />
                </div>
              </motion.div>
            )}

            {activeTab === 'results' && (
              <motion.div
                key="results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                {!settings.activeKeyId && (
                  <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-3xl flex items-center gap-4 animate-pulse">
                    <div className="p-2 bg-amber-500/20 rounded-full">
                      <Key className="w-5 h-5 text-amber-500" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-amber-500 uppercase tracking-tight">API Key Required</h4>
                      <p className="text-xs text-amber-500/70">LensLogic needs an API Key to analyze your files. Head to <button onClick={() => setActiveTab('settings')} className="underline font-bold hover:text-amber-400">Settings</button> to add your key.</p>
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between sticky top-0 py-4 bg-[#0a0514]/60 backdrop-blur-md z-10 gap-4">
                  <div>
                    <h2 className="text-2xl font-display font-bold text-white">Asset Library</h2>
                    <p className="text-sm text-slate-400">Review and refine your generated metadata.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {images.filter(i => i.status === 'idle').length > 0 && (
                      <button 
                        onClick={processBatch}
                        disabled={isProcessingAll}
                        className="px-6 py-2.5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl font-semibold transition-all shadow-lg shadow-indigo-500/25 flex items-center gap-2 cursor-pointer"
                      >
                        {isProcessingAll ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        Generate All
                      </button>
                    )}
                    <button 
                      {...getRootProps()}
                      className="px-4 py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 rounded-xl font-medium transition-all flex items-center gap-2 cursor-pointer"
                    >
                      <input {...getInputProps()} />
                      <Plus className="w-4 h-4" />
                      Add More
                    </button>
                    {images.length > 0 && (
                      <button 
                        onClick={() => setShowClearConfirm(true)}
                        className="px-4 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-xl font-medium transition-all flex items-center gap-2 cursor-pointer"
                        title="Clear all assets from library"
                      >
                        <Trash2 className="w-4 h-4" />
                        Clear All
                      </button>
                    )}
                  </div>
                </div>

                {images.length === 0 ? (
                  <div className="text-center py-32 bg-white/5 rounded-3xl border border-dashed border-white/10">
                    <ImageIcon className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                    <p className="text-slate-500">Your visual asset library is currently empty.</p>
                  </div>
                ) : (
                  <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden divide-y divide-white/5">
                    {images.map(image => (
                      <MetadataRow 
                        key={image.id} 
                        image={image} 
                        onGenerate={() => generateMetadata(image)}
                        onRemove={() => removeImage(image.id)}
                        onUpdate={(field, val) => updateMetadata(image.id, field, val)}
                        onSetPreview={(file) => setManualPreview(image.id, file)}
                        onCopyKeywords={() => copyKeywords(image.keywords)}
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="max-w-2xl mx-auto space-y-8"
              >
                <header>
                  <h2 className="text-3xl font-display font-bold text-white mb-2">AI Configuration</h2>
                  <p className="text-slate-400">Fine-tune how LensLogic analyzes and describes your assets.</p>
                </header>

                <div className="bg-white/5 rounded-3xl border border-white/10 p-8 space-y-8 backdrop-blur-xl">
                  {/* API Management Section */}
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <header>
                        <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">API Management</label>
                        <p className="text-[10px] text-slate-400 mt-1">Manage Gemini and Groq API keys</p>
                      </header>
                      <button 
                        onClick={() => {
                          const id = Math.random().toString(36).substring(7);
                          setSettings(s => ({ 
                            ...s, 
                            apiKeys: [...s.apiKeys, { id, label: 'New API Key', key: '', provider: 'Gemini' }],
                            activeKeyId: s.activeKeyId || id
                          }));
                        }}
                        className="p-2 bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg transition-all cursor-pointer shadow-lg shadow-indigo-500/20"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-4">
                      {settings.apiKeys.length === 0 && (
                        <div className="text-center py-6 border border-dashed border-white/5 rounded-2xl">
                          <p className="text-xs text-slate-500">No API keys saved yet.</p>
                        </div>
                      )}
                      
                      {settings.apiKeys.map((entry) => (
                        <div key={entry.id} className={cn(
                          "p-4 rounded-2xl border transition-all space-y-3",
                          settings.activeKeyId === entry.id ? "bg-indigo-500/5 border-indigo-500/30" : "bg-white/5 border-white/5"
                        )}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <button 
                                onClick={() => setSettings(s => ({ ...s, activeKeyId: entry.id }))}
                                className={cn(
                                  "w-4 h-4 rounded-full border flex items-center justify-center transition-all cursor-pointer",
                                  settings.activeKeyId === entry.id ? "border-indigo-400 bg-indigo-400" : "border-white/20"
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
                                className="bg-transparent text-xs font-semibold text-white focus:outline-none border-b border-transparent focus:border-white/20 w-32"
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
                              className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors pointer-cursor"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex gap-4">
                            <select 
                              value={entry.provider}
                              onChange={(e) => {
                                const newKeys = settings.apiKeys.map(k => k.id === entry.id ? { ...k, provider: e.target.value as any } : k);
                                setSettings(s => ({ ...s, apiKeys: newKeys }));
                              }}
                              className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none cursor-pointer"
                            >
                              <option value="Gemini">Gemini</option>
                              <option value="Groq">Groq</option>
                            </select>
                            <input 
                              type="password"
                              placeholder="Enter API Key"
                              value={entry.key}
                              onChange={(e) => {
                                const newKeys = settings.apiKeys.map(k => k.id === entry.id ? { ...k, key: e.target.value } : k);
                                setSettings(s => ({ ...s, apiKeys: newKeys }));
                              }}
                              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] text-slate-300 focus:outline-none focus:border-indigo-500/50"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Title Constraints</label>
                      <select 
                        value={settings.titleLength}
                        onChange={(e) => setSettings(s => ({ ...s, titleLength: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 cursor-pointer"
                      >
                        <option value="20-50">Short (20-50 chars)</option>
                        <option value="20-100">Medium (20-100 chars)</option>
                        <option value="20-200">Long (20-200 chars)</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Keyword Count</label>
                      <input 
                        type="number" 
                        min="10" 
                        max="50"
                        value={settings.keywordCount}
                        onChange={(e) => setSettings(s => ({ ...s, keywordCount: parseInt(e.target.value) }))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Title Prefix</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Premium"
                        value={settings.prefix}
                        onChange={(e) => setSettings(s => ({ ...s, prefix: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Title Suffix</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 2024"
                        value={settings.suffix}
                        onChange={(e) => setSettings(s => ({ ...s, suffix: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Negative Keywords</label>
                    <textarea 
                      placeholder="Exclude terms like: blur, noisy, low-quality"
                      value={settings.negativeKeywords}
                      onChange={(e) => setSettings(s => ({ ...s, negativeKeywords: e.target.value }))}
                      className="w-full h-24 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-300 placeholder:text-slate-600 resize-none focus:outline-none"
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'admin' && userProfile?.role === 'admin' && (
              <motion.div
                key="admin"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
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
        "w-full flex items-center justify-between px-3.5 py-3 rounded-xl transition-all duration-200 cursor-pointer group",
        active 
          ? "bg-indigo-500/10 text-white shadow-[0_0_20px_rgba(99,102,241,0.05)] ring-1 ring-indigo-500/40" 
          : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
      )}
    >
      <div className="flex items-center gap-3.5">
        <div className={cn("transition-all duration-300", active ? "text-indigo-400 scale-110" : "text-slate-500 group-hover:text-slate-400")}>
          {icon}
        </div>
        <span className={cn("text-xs font-semibold tracking-tight", active ? "text-white" : "text-slate-400")}>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {count !== undefined && count > 0 && (
          <span className={cn(
            "text-[9px] px-1.5 py-0.5 rounded-md font-mono font-bold",
            active ? "bg-indigo-400 text-indigo-950" : "bg-white/10 text-slate-500"
          )}>
            {count}
          </span>
        )}
        {shortcut && (
          <span className="text-[9px] font-mono opacity-20 group-hover:opacity-40 transition-opacity font-bold">{shortcut}</span>
        )}
      </div>
    </button>
  );
}

function FeatureCard({ icon, title, description }: { icon: ReactNode, title: string, description: string }) {
  return (
    <div className="p-6 bg-white/5 rounded-3xl border border-white/10 backdrop-blur-sm">
      <div className="mb-4">{icon}</div>
      <h3 className="font-semibold text-white mb-1.5">{title}</h3>
      <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
    </div>
  );
}

function MetadataRow({ 
  image, 
  onGenerate, 
  onRemove, 
  onUpdate,
  onSetPreview,
  onCopyKeywords
}: any) {
  const [copied, setCopied] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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

  return (
    <motion.div 
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="hover:bg-white/[0.02] transition-colors group relative"
    >
      <div className="flex flex-col lg:flex-row items-center p-6 gap-6">
        <div className="w-full lg:w-48 relative h-36 lg:h-36 bg-slate-900 rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handlePreviewUpload}
            accept="image/*"
            className="hidden"
          />
          
          {image.preview ? (
            <div className="relative w-full h-full">
              <img src={image.preview} alt="preview" className="w-full h-full object-cover" />
              {(image.type === 'Vector' || image.type === 'Video') && (
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-2 right-2 p-1.5 bg-black/60 backdrop-blur-md rounded-lg text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                  title="Change Preview"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-full flex flex-col items-center justify-center bg-slate-800 text-slate-500 hover:bg-slate-700 transition-colors group/preview cursor-pointer"
            >
              {image.type === 'Video' ? (
                <VideoIcon className="w-8 h-8 mb-1 text-indigo-400 group-hover/preview:scale-110 transition-transform" />
              ) : (
                <Key className="w-8 h-8 mb-1 text-amber-400 group-hover/preview:scale-110 transition-transform" />
              )}
              <span className="text-[10px] font-bold uppercase">
                {image.type === 'Video' ? 'Video File' : 'EPS/AI Vector'}
              </span>
              <p className="text-[8px] px-4 text-center mt-2 leading-tight text-rose-400 font-bold uppercase">
                Click to upload Preview Image
              </p>
            </button>
          )}
          
          {image.preview && (image.type === 'Video' || (image.type === 'Vector' && !(image.fileName || image.file?.name || '').toLowerCase().endsWith('.svg'))) && (
            <div className="absolute top-2 right-2 px-2 py-1 bg-emerald-500/80 backdrop-blur-md rounded text-[8px] font-bold text-white flex items-center gap-1">
              <Check className="w-2.5 h-2.5" /> REF MATCHED
            </div>
          )}

          <div className="absolute top-2 left-2 flex flex-col gap-1">
            <span className={cn(
              "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider backdrop-blur-md text-white border border-white/10",
              image.status === 'completed' && "bg-emerald-500/80",
              image.status === 'processing' && "bg-indigo-500/80 border-indigo-400/50",
              image.status === 'idle' && "bg-slate-700/80",
              image.status === 'error' && "bg-rose-500/80",
            )}>
              {image.status}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider backdrop-blur-md bg-white/10 text-white border border-white/10">
              {image.type}
            </span>
          </div>
          <button 
            onClick={onRemove}
            className="absolute top-2 right-2 p-1.5 bg-[#0a0514]/60 hover:bg-rose-500/80 text-white rounded-lg backdrop-blur-md transition-all cursor-pointer border border-white/10"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 w-full">
          {image.status === 'idle' || image.status === 'error' ? (
            <div className="h-full flex items-center justify-between p-4 bg-white/[0.02] rounded-xl border border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                  <ImageIcon className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-slate-300">{image.fileName || image.file?.name || 'Asset'}</p>
                  {!image.preview && (image.type === 'Vector' || image.type === 'Video') ? (
                    <p className="text-[10px] text-rose-400 font-bold uppercase tracking-widest flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Preview Required
                    </p>
                  ) : image.status === 'error' ? (
                    <p className="text-[10px] text-rose-400 uppercase tracking-widest flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {image.error || 'Error'}
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">Ready for analysis</p>
                  )}
                </div>
              </div>
              <button 
                onClick={onGenerate}
                disabled={!image.preview && (image.type === 'Vector' || image.type === 'Video')}
                className="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-indigo-500/10 flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Analyze AI
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block text-left">Title (Optimized)</label>
                  <input 
                    type="text" 
                    value={image.title}
                    onChange={(e) => onUpdate('title', e.target.value)}
                    disabled={image.status === 'processing'}
                    placeholder="Generating title..."
                    className="w-full text-sm font-medium text-white bg-transparent border-b border-white/5 hover:border-white/10 focus:border-indigo-500/50 focus:outline-none transition-all pb-1 placeholder:text-slate-600"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block text-left">Description</label>
                  <textarea 
                     value={image.description}
                     onChange={(e) => onUpdate('description', e.target.value)}
                     disabled={image.status === 'processing'}
                     rows={1}
                     placeholder="Analyzing visual details..."
                     className="w-full text-xs text-slate-400 bg-transparent border-b border-white/5 hover:border-white/10 focus:border-indigo-500/50 focus:outline-none transition-all resize-none placeholder:text-slate-600"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block text-left">Keywords</label>
                  {image.keywords.length > 0 && (
                    <button 
                      onClick={handleCopy}
                      className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto pr-2 custom-scrollbar">
                  {image.status === 'processing' ? (
                    <div className="w-full flex gap-2">
                      {[1, 2, 3, 4].map(i => <div key={i} className="h-5 w-14 bg-white/5 animate-pulse rounded" />)}
                    </div>
                  ) : (
                    image.keywords.map((kw, i) => (
                      <span key={i} className="px-2 py-0.5 bg-white/5 text-slate-400 rounded text-[10px] border border-white/5 transition-colors hover:border-white/10">
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
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-indigo-500/20 overflow-hidden">
          <div className="h-full bg-indigo-500 w-1/3 animate-[shimmer_2s_infinite_linear]"></div>
        </div>
      )}
    </motion.div>
  );
}
