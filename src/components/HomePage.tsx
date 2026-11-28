import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Cpu,
  FolderArchive,
  Globe,
  Sparkles,
} from 'lucide-react';
import heroStudioImg from '../assets/images/hero_stock_studio_1795854949363.jpg';

export type WorkspaceTab = 'metadata' | 'studio' | 'techbg' | 'settings';
export type PublicRouteTab = 'home' | 'about' | WorkspaceTab;

interface HomePageProps {
  onNavigate: (tab: PublicRouteTab) => void;
  assetCount: number;
}

export default function HomePage({ onNavigate, assetCount }: HomePageProps) {
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [metaImgFailed, setMetaImgFailed] = useState(false);
  const [psdImgFailed, setPsdImgFailed] = useState(false);
  const [bgImgFailed, setBgImgFailed] = useState(false);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans flex flex-col">
      {/* Top Navigation Bar — Three-Zone Contract */}
      <header className="sticky top-0 z-30 bg-[#f8fafc]/95 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            aria-label="Metafy Home"
            className="inline-flex items-center whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-indigo-600 rounded-sm"
          >
            <div className="w-[155px] h-[44px] overflow-hidden flex items-center">
              <img
                src="/assets/aistudio/i008iu__1__c82bac29.png"
                alt="Metafy"
                className="w-full h-auto max-w-none mix-blend-multiply"
              />
            </div>
          </a>

          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
          >
            <span className="text-slate-950 font-semibold underline underline-offset-4 whitespace-nowrap shrink-0">
              Home
            </span>
            <a
              href="#tools"
              className="hover:text-slate-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Tools
            </a>
            <button
              type="button"
              onClick={() => onNavigate('about')}
              className="hover:text-slate-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              About
            </button>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('metadata')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all duration-200 hover:-translate-y-0.5 shadow-xs cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              {assetCount > 0 ? `Resume Studio (${assetCount})` : 'Open Studio'}
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* Minimal Hero Split */}
        <section className="max-w-6xl mx-auto px-6 lg:px-10 pt-12 pb-16 lg:pt-16 lg:pb-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-stretch">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-6 flex flex-col justify-between space-y-8 py-2"
            >
              <div className="space-y-5">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                  <span>Adobe Stock</span>
                  <span aria-hidden="true">·</span>
                  <span>Shutterstock</span>
                  <span aria-hidden="true">·</span>
                  <span>Freepik</span>
                </div>

                <h1
                  className="font-bold tracking-tight text-slate-950 leading-[1.08] text-balance max-w-lg"
                  style={{ fontSize: 'clamp(2.25rem, 3.8vw, 3.5rem)' }}
                >
                  All Your Stock Asset Tools In One Studio.
                </h1>

                <p className="text-base text-slate-600 leading-relaxed max-w-md">
                  Generate SEO titles, tags, and CSVs, batch-package numbered PSD or EPS pairs with
                  JPG previews, and render procedural backgrounds in one studio.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => onNavigate('metadata')}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md shadow-sm inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                >
                  <span>Open Metadata Generator</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => onNavigate('about')}
                  className="px-5 py-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 hover:border-slate-300 text-sm font-semibold rounded-xl transition-all duration-200 hover:-translate-y-0.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  About &amp; Formats
                </button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-6"
            >
              <div className="group w-full h-full min-h-[280px] lg:min-h-[380px] rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 transition-all duration-300 hover:border-slate-300 hover:shadow-md">
                {!heroImgFailed ? (
                  <img
                    src={heroStudioImg}
                    alt="Minimalist stock creative workstation displaying photography and vector artwork"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgFailed(true)}
                    className="w-full h-full object-cover block transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.025]"
                  />
                ) : (
                  <div className="w-full h-full min-h-[320px] flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-slate-100 to-slate-200">
                    <Sparkles className="w-10 h-10 text-indigo-600 mb-3" />
                    <p className="text-sm font-bold text-slate-800">Metafy Workspace</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </section>

        {/* Minimal 3-Tool Workspace Entry */}
        <section id="tools" className="border-t border-slate-200/80 bg-white">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-14 lg:py-16 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-indigo-600">Workspace</p>
                <h2 className="text-2xl font-bold tracking-tight text-slate-950">
                  Choose a studio tool
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('about')}
                className="text-xs font-semibold text-slate-600 hover:text-indigo-600 hover:underline underline-offset-4 transition-colors cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                View full specifications →
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Tool 01: Metadata Generator */}
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => onNavigate('metadata')}
                className="group text-left bg-[#f8fafc] border border-slate-200 hover:border-indigo-300 rounded-2xl p-5 flex flex-col justify-between gap-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-md cursor-pointer"
              >
                <div className="space-y-4">
                  <div className="aspect-video w-full rounded-xl overflow-hidden border border-slate-200 bg-white">
                    {!metaImgFailed ? (
                      <img
                        src="/assets/aistudio/Metadata_generator_UI_icon_illus__72b33d96_2K_a88c6b2c.jpg"
                        alt="Metadata Generator UI illustration with CSV, ID, TAG, and Title cards"
                        referrerPolicy="no-referrer"
                        onError={() => setMetaImgFailed(true)}
                        className="w-full h-full object-cover block transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-400">
                        <Sparkles className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                      <span className="text-indigo-600 font-semibold">01.</span>
                      <span>JPG · PSD · EPS · MP4</span>
                    </div>
                    <h3 className="text-base font-bold text-slate-950 group-hover:text-indigo-700 transition-colors">
                      Metadata Generator
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      AI titles, keywords, and separate Adobe Stock &amp; Freepik CSV exports.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-200/80 text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Open Tool
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                </div>
              </motion.button>

              {/* Tool 02: EPS & PSD Studio */}
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => onNavigate('studio')}
                className="group text-left bg-[#f8fafc] border border-slate-200 hover:border-indigo-300 rounded-2xl p-5 flex flex-col justify-between gap-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-md cursor-pointer"
              >
                <div className="space-y-4">
                  <div className="aspect-video w-full rounded-xl overflow-hidden border border-slate-200 bg-white">
                    {!psdImgFailed ? (
                      <img
                        src="/assets/aistudio/3D_UI_icon_glass_layers_a3590a01_2K_aff18eb4.jpg"
                        alt="EPS and PSD Studio 3D layered glass UI illustration"
                        referrerPolicy="no-referrer"
                        onError={() => setPsdImgFailed(true)}
                        className="w-full h-full object-cover block transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-400">
                        <FolderArchive className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                      <span className="text-indigo-600 font-semibold">02.</span>
                      <span>1-Click Folder · 300 PPI</span>
                    </div>
                    <h3 className="text-base font-bold text-slate-950 group-hover:text-indigo-700 transition-colors">
                      EPS &amp; PSD Studio
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Batch-package numbered PSD or EPS pairs with matching JPG previews.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-200/80 text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                  <span className="inline-flex items-center gap-1.5">
                    <FolderArchive className="w-3.5 h-3.5" />
                    Open Tool
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                </div>
              </motion.button>

              {/* Tool 03: BG Studio */}
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => onNavigate('techbg')}
                className="group text-left bg-[#f8fafc] border border-slate-200 hover:border-indigo-300 rounded-2xl p-5 flex flex-col justify-between gap-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-md cursor-pointer"
              >
                <div className="space-y-4">
                  <div className="aspect-video w-full rounded-xl overflow-hidden border border-slate-200 bg-[#050a18]">
                    {!bgImgFailed ? (
                      <img
                        src="/assets/aistudio/UI_card_with_sine_wave_5cd9ffd7_2K_37b31231.jpg"
                        alt="BG Studio procedural sine wave interface preview"
                        referrerPolicy="no-referrer"
                        onError={() => setBgImgFailed(true)}
                        className="w-full h-full object-cover block transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-900 text-indigo-400">
                        <Cpu className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                      <span className="text-indigo-600 font-semibold">03.</span>
                      <span>WebGL · Up to 8K</span>
                    </div>
                    <h3 className="text-base font-bold text-slate-950 group-hover:text-indigo-700 transition-colors">
                      BG Studio
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Procedural geometric and architectural backgrounds with batch export.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-200/80 text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                  <span className="inline-flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5" />
                    Open Tool
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                </div>
              </motion.button>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Minimal Footer — Theme-Harmonized */}
      <footer className="border-t border-slate-200 bg-[#f8fafc]">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-bold text-slate-900">Metafy</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>Developed By SNY247™</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href="https://sny247.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 px-3 bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 rounded-lg text-[11px] font-bold transition-all duration-200 hover:-translate-y-0.5 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Globe className="w-3 h-3 text-indigo-600" />
              <span>Website</span>
            </a>

            <a
              href="https://wa.me/8801618985090"
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 px-3 bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 rounded-lg text-[11px] font-bold transition-all duration-200 hover:-translate-y-0.5 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              title="WhatsApp: 01618985090"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 text-emerald-600 shrink-0" aria-hidden="true">
                <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m5.79 14.01c-.24.68-1.41 1.3-1.95 1.38-.5.07-1.13.1-1.82-.12-.42-.13-.96-.31-1.65-.61-2.91-1.26-4.81-4.19-4.96-4.38-.14-.19-1.18-1.57-1.18-3 0-1.43.75-2.13 1.01-2.42.27-.29.58-.36.77-.36.19 0 .39 0 .56.01.18.01.42-.07.66.5.24.58.82 2 .89 2.15.07.15.12.32.02.51-.1.19-.15.32-.29.49-.14.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.29.75 1.24 1.62 2.01 1.11.99 2.05 1.3 2.34 1.44.29.15.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.39-.24.65-.15.27.1 1.69.8 1.98.94.29.15.48.22.55.34.07.12.07.7-.17 1.38Z" />
              </svg>
              <span>WhatsApp</span>
            </a>

            <a
              href="https://www.youtube.com/channel/UCV6frnsNl3RMtXbCTU57Z2A?sub_confirmation=1"
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 px-3 bg-slate-900 hover:bg-indigo-600 text-white rounded-lg text-[11px] font-bold transition-all duration-200 hover:-translate-y-0.5 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              title="Subscribe to SNY247™ on YouTube"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-rose-400 shrink-0" aria-hidden="true">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              <span>Subscribe on YouTube</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
