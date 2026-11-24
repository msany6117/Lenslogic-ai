import React, { useState } from 'react';
import { 
  Mail, 
  Lock, 
  Sparkles, 
  Image as ImageIcon, 
  UserPlus, 
  LogIn, 
  AlertCircle,
  ArrowLeft
} from 'lucide-react';
import { ensureGuestSession, getApiUrl, setAuthToken } from '../services/dbService';

interface AuthScreenProps {
  onAuthSuccess: (user: any) => void;
  onCancel?: () => void;
}

export default function AuthScreen({ onAuthSuccess, onCancel }: AuthScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [apiUrlInput, setApiUrlInput] = useState(() => {
    return localStorage.getItem("LENS_LOGIC_API_URL") || "";
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const endpoint = isSignUp ? '/api/auth/register' : '/api/auth/login';

    try {
      const response = await fetch(getApiUrl(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      // Verify if the response is JSON, because Vercel/proxies might return HTML on 404/500
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const textError = await response.text();
        console.error("API response is not JSON:", textError);
        throw new Error(
          "Backend API returned HTML instead of JSON. This usually means the API URL is incorrect, the route was not found (404), or the backend server is offline."
        );
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed. Please try again.');
      }

      const authenticatedUser = data.user;
      if (data.token) {
        setAuthToken(data.token);
      }

      // Store in localStorage for persistence
      localStorage.setItem('lenslogic_user', JSON.stringify(authenticatedUser));
      
      onAuthSuccess(authenticatedUser);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleGuestMode = async () => {
    setLoading(true);
    setError('');
    try {
      const guestUser = await ensureGuestSession();
      onAuthSuccess(guestUser);
    } catch (err: any) {
      setError('Failed to log in as guest. ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
      {/* Background Soft Ambient Lights */}
      <div className="absolute top-[-15%] left-[-15%] w-[55%] h-[55%] bg-indigo-100/50 blur-[130px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[-15%] right-[-15%] w-[55%] h-[55%] bg-purple-100/40 blur-[130px] rounded-full pointer-events-none"></div>

      <div className="w-full max-w-md z-10">
        {/* Header/Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 ring-4 ring-indigo-50 mb-3.5 transition-transform hover:scale-105">
            <ImageIcon className="text-white w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-1">
            LensLogic <span className="text-indigo-600">Studio</span>
          </h1>
          <p className="text-slate-500 text-xs text-center max-w-xs leading-relaxed">
            AI-Powered Metadata Studio for Stock Image Contributors
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-white/95 rounded-3xl p-8 border border-slate-200/90 shadow-[0_10px_35px_rgba(0,0,0,0.04)] relative overflow-hidden backdrop-blur-xl">
          <h2 className="text-lg font-bold text-slate-900 mb-5 flex items-center gap-2">
            {isSignUp ? <UserPlus className="w-4 h-4 text-indigo-600" /> : <LogIn className="w-4 h-4 text-indigo-600" />}
            {isSignUp ? "Create Professional Account" : "Sign In to Studio"}
          </h2>

          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Email Address</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400">
                  <Mail className="w-4 h-4" />
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-600 focus:bg-white transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Password</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-600 focus:bg-white transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all shadow-sm hover:shadow flex items-center justify-center gap-2 cursor-pointer mt-5 active:scale-[0.99]"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>
                  {isSignUp ? "Create Free Account" : "Access Studio"}
                  <Sparkles className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="relative flex py-4 items-center">
            <div className="flex-grow border-t border-slate-100"></div>
            <span className="flex-shrink mx-3 text-[10px] text-slate-400 font-bold uppercase tracking-widest">or</span>
            <div className="flex-grow border-t border-slate-100"></div>
          </div>

          <button
            onClick={handleGuestMode}
            disabled={loading}
            className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/80 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
          >
            Explore as Guest
          </button>

          <div className="mt-5 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer"
            >
              {isSignUp ? "Already have an account? Sign In" : "Don't have an account? Create one"}
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="text-xs text-slate-500 hover:text-slate-800 font-medium inline-flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Studio
              </button>
            )}
          </div>
        </div>

        {/* Backend Connection Settings */}
        <div className="mt-3.5 p-3.5 rounded-2xl bg-white border border-slate-200/80 text-center shadow-xs">
          <details className="group">
            <summary className="text-xs font-medium text-slate-600 hover:text-slate-800 cursor-pointer list-none flex items-center justify-center gap-1.5 select-none">
              <span>🔧 Connection Settings (Vercel / Custom Domain)</span>
              <span className="transition-transform group-open:rotate-180 text-[10px]">▼</span>
            </summary>
            <div className="mt-3 text-left space-y-2 pt-2 border-t border-slate-100">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                If hosted on Vercel or custom domain, specify your backend API URL:
              </p>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Backend API Base URL</label>
                <input
                  type="text"
                  placeholder="https://your-backend.run.app"
                  value={apiUrlInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setApiUrlInput(val);
                    if (val.trim()) {
                      localStorage.setItem("LENS_LOGIC_API_URL", val.trim());
                    } else {
                      localStorage.removeItem("LENS_LOGIC_API_URL");
                    }
                  }}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-500 text-slate-800 font-mono"
                />
              </div>
              <p className="text-[9px] text-slate-400 italic font-mono">
                Targeting: {localStorage.getItem("LENS_LOGIC_API_URL") || "Relative Paths (Default)"}
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
