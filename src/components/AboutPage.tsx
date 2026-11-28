import React, { useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  Cpu,
  FolderArchive,
  Globe,
  Key,
  Sparkles,
} from 'lucide-react';
import type { PublicRouteTab } from './HomePage';

interface AboutPageProps {
  onNavigate: (tab: PublicRouteTab) => void;
  assetCount: number;
}

const FAQS = [
  {
    q: 'How does the Freepik CSV export differ from Adobe Stock CSV?',
    a: 'Adobe Stock CSV exports comma-separated columns (Filename,Title,Description,Keywords). Freepik CSV exports semicolon-separated columns without quotes (filename;title;tags) so you can upload directly to Freepik contributor forms without reformatting.',
  },
  {
    q: 'Does Metadata Generator support .psd, .eps, and .ai files directly?',
    a: 'Yes. Upload .psd, .eps, .ai, .pdf, or .svg files directly—Metafy extracts embedded previews automatically or pairs same-filename .jpg/.png references to generate accurate titles, descriptions, and keywords.',
  },
  {
    q: 'How does 1-click batch packaging work in EPS & PSD Package Generator?',
    a: 'Drop multiple images or EPS vectors at once and click Generate. All converted .psd or .eps files and their matching .jpg previews are auto-numbered sequentially (01, 02, 03...) and placed together inside one downloadable folder.',
  },
  {
    q: 'Are there any app-imposed limits on metadata generation?',
    a: 'No. You configure your own Gemini and Groq API keys in AI Configuration, and the built-in queue automatically rotates across healthy keys and retries transient upstream rate limits.',
  },
];

export default function AboutPage({ onNavigate, assetCount }: AboutPageProps) {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans">
      {/* Top Navigation Bar — Three-Zone Contract */}
      <header className="sticky top-0 z-30 bg-[#f8fafc]/95 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => onNavigate('home')}
            aria-label="Metafy Home"
            className="inline-flex items-center whitespace-nowrap shrink-0 cursor-pointer"
          >
            <div className="w-[155px] h-[44px] overflow-hidden flex items-center">
              <img
                src="/assets/aistudio/i008iu__1__c82bac29.png"
                alt="Metafy"
                className="w-full h-auto max-w-none mix-blend-multiply"
              />
            </div>
          </button>

          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
          >
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="hover:text-slate-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => onNavigate('metadata')}
              className="hover:text-slate-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Tools
            </button>
            <span className="text-slate-950 font-semibold underline underline-offset-4 whitespace-nowrap shrink-0">
              About
            </span>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('metadata')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all duration-200 hover:-translate-y-0.5 shadow-xs cursor-pointer whitespace-nowrap shrink-0"
            >
              {assetCount > 0 ? `Resume Studio (${assetCount})` : 'Open Studio'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 lg:px-10 py-14 lg:py-16 space-y-16">
        {/* Editorial About Hero */}
        <section className="max-w-3xl space-y-5">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span>About Metafy</span>
            <span aria-hidden="true">·</span>
            <span>Developed By SNY247™</span>
          </div>

          <h1
            className="font-bold tracking-tight text-slate-950 leading-[1.1] text-balance"
            style={{ fontSize: 'clamp(2rem, 3.6vw, 3rem)' }}
          >
            Built for microstock contributors preparing Adobe Stock, Shutterstock, and Freepik portfolios.
          </h1>

          <p className="text-base text-slate-600 leading-relaxed">
            Metafy combines AI-driven stock SEO metadata generation, automated 1-click PSD
            and EPS batch packaging, and procedural background creation inside one unified workspace—eliminating
            manual CSV formatting and repetitive file exports.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => onNavigate('metadata')}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all duration-200 hover:-translate-y-0.5 shadow-xs inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Open Metadata Generator</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('studio')}
              className="px-5 py-2.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 text-xs font-semibold rounded-xl transition-all duration-200 hover:-translate-y-0.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              Open Package Studio
            </button>
          </div>
        </section>

        {/* Capabilities Section */}
        <section aria-labelledby="capabilities-heading" className="pt-12 border-t border-slate-200 space-y-8">
          <div className="space-y-2 max-w-2xl">
            <p className="text-xs font-semibold text-indigo-600">Capabilities</p>
            <h2 id="capabilities-heading" className="text-2xl font-bold tracking-tight text-slate-950">
              Workflow architecture built around contributor guidelines
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <article className="bg-white border border-slate-200 rounded-2xl p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-indigo-600 font-semibold">
                <Sparkles className="w-3.5 h-3.5" />
                <span>01. Direct PSD &amp; Vector Preview Extraction</span>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Upload `.psd`, `.eps`, `.ai`, `.pdf`, or `.svg` files directly into Metadata
                Generator. Previews are decoded automatically or paired with matching `.jpg`/`.png`
                references for fast visual SEO indexing.
              </p>
            </article>

            <article className="bg-white border border-slate-200 rounded-2xl p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-indigo-600 font-semibold">
                <FolderArchive className="w-3.5 h-3.5" />
                <span>02. Sequential 1-Click Batch Folder Packaging</span>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Upload multiple graphics or EPS vectors together in PSD &amp; Vector Studio to
                produce one ZIP folder containing auto-numbered asset and JPG preview pairs (`01`,
                `02`, `03`...) with preserved original dimensions.
              </p>
            </article>

            <article className="bg-white border border-slate-200 rounded-2xl p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-indigo-600 font-semibold">
                <Cpu className="w-3.5 h-3.5" />
                <span>03. Procedural &amp; AI Background Synthesis</span>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Render deterministic 4K–8K geometric, architectural, and abstract stock backgrounds in
                BG Studio with live shader editing, seed locking, and built-in stock quality checks.
              </p>
            </article>

            <article className="bg-white border border-slate-200 rounded-2xl p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-indigo-600 font-semibold">
                <Key className="w-3.5 h-3.5" />
                <span>04. Multi-Key Failover &amp; Persistent Tabs</span>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Configure multiple Gemini and Groq keys with automatic health rotation. Switching
                between Home, About, Metadata, Package Studio, and BG Studio preserves every active
                batch and result.
              </p>
            </article>
          </div>
        </section>

        {/* Format & Export Compliance Matrix */}
        <section aria-labelledby="formats-heading" className="pt-12 border-t border-slate-200 space-y-6">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-indigo-600">Formats &amp; Specifications</p>
            <h2 id="formats-heading" className="text-2xl font-bold tracking-tight text-slate-950">
              Supported file formats and marketplace export standards
            </h2>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-2xl bg-white">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
                  <th className="py-3.5 px-5 font-semibold">Tool / Export</th>
                  <th className="py-3.5 px-5 font-semibold">Accepted Inputs</th>
                  <th className="py-3.5 px-5 font-semibold">Output Format</th>
                  <th className="py-3.5 px-5 font-semibold">Target Standard</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 text-slate-700">
                <tr>
                  <td className="py-3.5 px-5 font-bold text-slate-900">Adobe Stock CSV</td>
                  <td className="py-3.5 px-5 font-mono tabular-nums">JPG, PNG, PSD, EPS, AI, MP4</td>
                  <td className="py-3.5 px-5 font-mono">Filename,Title,Description,Keywords</td>
                  <td className="py-3.5 px-5">Adobe Stock &amp; Shutterstock</td>
                </tr>
                <tr>
                  <td className="py-3.5 px-5 font-bold text-slate-900">Freepik CSV</td>
                  <td className="py-3.5 px-5 font-mono tabular-nums">JPG, PNG, PSD, EPS, AI, MP4</td>
                  <td className="py-3.5 px-5 font-mono">filename;title;tags (no quotes)</td>
                  <td className="py-3.5 px-5">Freepik Contributor Bulk Upload</td>
                </tr>
                <tr>
                  <td className="py-3.5 px-5 font-bold text-slate-900">Photoshop PSD Pack</td>
                  <td className="py-3.5 px-5 font-mono tabular-nums">PNG, JPG, SVG, WebP, AI, EPS</td>
                  <td className="py-3.5 px-5 font-mono">.psd + .jpg (1 numbered folder)</td>
                  <td className="py-3.5 px-5 font-mono tabular-nums">2 MB – 200 MB · 72–1200 PPI</td>
                </tr>
                <tr>
                  <td className="py-3.5 px-5 font-bold text-slate-900">Illustrator EPS Pack</td>
                  <td className="py-3.5 px-5 font-mono tabular-nums">EPS (+ optional JPG/PNG)</td>
                  <td className="py-3.5 px-5 font-mono">.eps + .jpg (1 numbered folder)</td>
                  <td className="py-3.5 px-5 font-mono tabular-nums">1 MB – 70 MB · 300 PPI default</td>
                </tr>
                <tr>
                  <td className="py-3.5 px-5 font-bold text-slate-900">BG Studio Export</td>
                  <td className="py-3.5 px-5">Procedural / AI Blueprint</td>
                  <td className="py-3.5 px-5 font-mono">PNG / JPG / Batch ZIP</td>
                  <td className="py-3.5 px-5 font-mono tabular-nums">Up to 8K High-Resolution</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Contributor FAQ Section for SEO */}
        <section aria-labelledby="faq-heading" className="pt-12 border-t border-slate-200 space-y-6">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-indigo-600">FAQ</p>
            <h2 id="faq-heading" className="text-2xl font-bold tracking-tight text-slate-950">
              Common workflow questions
            </h2>
          </div>

          <div className="divide-y divide-slate-200 border border-slate-200 rounded-2xl bg-white overflow-hidden">
            {FAQS.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={item.q}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full px-6 py-4 text-left flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <span className="text-sm font-bold text-slate-900">{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-indigo-600' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-4 text-xs text-slate-600 leading-relaxed">
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Developer Attribution & Contact Card — Theme-Harmonized */}
        <section aria-labelledby="developer-heading" className="pt-12 border-t border-slate-200">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 lg:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-indigo-600">Developer</p>
              <h2 id="developer-heading" className="text-xl font-bold text-slate-950">
                Developed By SNY247™
              </h2>
              <p className="text-xs text-slate-600 max-w-md">
                Creative engineering, stock automation tools, and contributor workflow software.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <a
                href="https://sny247.vercel.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="h-10 px-4 bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 rounded-xl text-xs font-bold transition-all duration-200 hover:-translate-y-0.5 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <Globe className="w-3.5 h-3.5 text-indigo-600" />
                <span>Website</span>
              </a>

              <a
                href="https://wa.me/8801618985090"
                target="_blank"
                rel="noopener noreferrer"
                className="h-10 px-4 bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 rounded-xl text-xs font-bold transition-all duration-200 hover:-translate-y-0.5 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                title="WhatsApp: 01618985090"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true">
                  <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m5.79 14.01c-.24.68-1.41 1.3-1.95 1.38-.5.07-1.13.1-1.82-.12-.42-.13-.96-.31-1.65-.61-2.91-1.26-4.81-4.19-4.96-4.38-.14-.19-1.18-1.57-1.18-3 0-1.43.75-2.13 1.01-2.42.27-.29.58-.36.77-.36.19 0 .39 0 .56.01.18.01.42-.07.66.5.24.58.82 2 .89 2.15.07.15.12.32.02.51-.1.19-.15.32-.29.49-.14.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.29.75 1.24 1.62 2.01 1.11.99 2.05 1.3 2.34 1.44.29.15.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.39-.24.65-.15.27.1 1.69.8 1.98.94.29.15.48.22.55.34.07.12.07.7-.17 1.38Z" />
                </svg>
                <span>WhatsApp</span>
              </a>

              <a
                href="https://www.youtube.com/channel/UCV6frnsNl3RMtXbCTU57Z2A?sub_confirmation=1"
                target="_blank"
                rel="noopener noreferrer"
                className="h-10 px-4 bg-slate-900 hover:bg-indigo-600 text-white rounded-xl text-xs font-bold transition-all duration-200 hover:-translate-y-0.5 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                title="Subscribe to SNY247™ on YouTube"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-rose-400 shrink-0" aria-hidden="true">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
                <span>Subscribe on YouTube</span>
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
