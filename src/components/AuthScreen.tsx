import React, { useState } from 'react';
import { 
  Mail, 
  Lock, 
  Sparkles, 
  Image as ImageIcon, 
  UserPlus, 
  LogIn, 
  AlertCircle 
} from 'lucide-react';
import { getApiUrl } from '../services/dbService';

interface AuthScreenProps {
  onAuthSuccess: (user: any) => void;
}

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [apiUrlInput, setApiUrlInput] = useState(() => {
    return localStorage.getItem("LENS_LOGIC_API_URL") || (typeof process !== "undefined" && process.env?.APP_URL) || "";
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

  const handleGuestMode = () => {
    setLoading(true);
    setError('');
    try {
      const guestUser = {
        uid: 'guest_' + Math.random().toString(36).substring(2, 11),
        email: 'guest@lenslogic.ai',
        role: 'user',
        savedSettings: null,
        createdAt: new Date().toISOString()
      };
      
      localStorage.setItem('lenslogic_user', JSON.stringify(guestUser));
      onAuthSuccess(guestUser);
    } catch (err: any) {
      setError('Failed to log in as guest. ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#06040a] text-slate-100 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Blobs */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-indigo-600/10 blur-[150px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-purple-600/10 blur-[150px] rounded-full pointer-events-none"></div>

      <div className="w-full max-w-md z-10">
        {/* Header/Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-2xl shadow-indigo-500/30 ring-1 ring-white/20 mb-4 animate-bounce">
            <ImageIcon className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-white mb-2">
            LensLogic <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Studio</span>
          </h1>
          <p className="text-slate-400 text-sm text-center">
            Professional AI-Powered Metadata Generator for Stock Contributors
          </p>
        </div>

        {/* Auth Card */}
        <div className="glass rounded-2xl p-8 border border-white/10 shadow-2xl relative overflow-hidden bg-white/[0.02] backdrop-blur-xl">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            {isSignUp ? <UserPlus className="w-5 h-5 text-indigo-400" /> : <LogIn className="w-5 h-5 text-indigo-400" />}
            {isSignUp ? "Create Professional Account" : "Sign In to Studio"}
          </h2>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Email Address</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
                  <Mail className="w-4 h-4" />
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 transition-all text-white placeholder-slate-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Password</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 transition-all text-white placeholder-slate-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer mt-6"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>
                  {isSignUp ? "Create Free Account" : "Access Studio"}
                  <Sparkles className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="relative flex py-4 items-center">
            <div className="flex-grow border-t border-white/5"></div>
            <span className="flex-shrink mx-4 text-[10px] text-slate-500 font-bold uppercase tracking-widest">or</span>
            <div className="flex-grow border-t border-white/5"></div>
          </div>

          <button
            onClick={handleGuestMode}
            disabled={loading}
            className="w-full py-3 px-4 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            Explore as Guest
          </button>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
            >
              {isSignUp ? "Already have an account? Sign In" : "Don't have an account? Create one"}
            </button>
          </div>
        </div>

        {/* Demo Admin Account Tip */}
        <div className="mt-4 p-4 rounded-xl bg-indigo-950/20 border border-indigo-500/10 text-center">
          <p className="text-xs text-slate-400">
            💡 <strong className="text-indigo-300">Admin Account:</strong> Access directly using <span className="font-mono text-indigo-200">msany6117@gmail.com</span> and password <span className="font-mono text-indigo-200">Admin@124390</span>.
          </p>
        </div>

        {/* Backend Connection Settings */}
        <div className="mt-4 p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
          <details className="group">
            <summary className="text-xs font-semibold text-slate-400 hover:text-slate-300 cursor-pointer list-none flex items-center justify-center gap-1.5 select-none">
              <span>🔧 Connection Settings (Vercel / Custom Domain)</span>
              <span className="transition-transform group-open:rotate-180 text-[10px]">▼</span>
            </summary>
            <div className="mt-3 text-left space-y-2.5 pt-2 border-t border-white/5">
              <p className="text-[11px] text-slate-400 leading-relaxed">
                If hosted on Vercel or a custom domain, specify your Cloud Run Express backend server URL:
              </p>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Backend API Base URL</label>
                <input
                  type="text"
                  placeholder="https://your-backend-cloud-run-url.run.app"
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
                  className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none focus:border-indigo-500/50 text-white font-mono"
                />
              </div>
              <p className="text-[9px] text-slate-500 italic font-mono">
                Currently targeting: {localStorage.getItem("LENS_LOGIC_API_URL") || (typeof process !== "undefined" && process.env?.APP_URL) || "Relative Paths (Default)"}
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
