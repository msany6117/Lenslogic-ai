import React, { useState, useEffect } from 'react';
import { 
  adminLoadAllUsers, 
  adminLoadAllAssets,
  saveUserProfile
} from '../services/dbService';
import { 
  Users, 
  Database, 
  Shield, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw,
  ImageIcon,
  Video,
  FileCode,
  Search,
  UserCheck
} from 'lucide-react';
import { cn } from '../lib/utils';

export default function AdminPanel() {
  const [users, setUsers] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadData = async () => {
    setLoadError(null);
    try {
      const [allUsers, allAssets] = await Promise.all([
        adminLoadAllUsers(),
        adminLoadAllAssets(),
      ]);
      setUsers(Array.isArray(allUsers) ? allUsers : []);
      setAssets(Array.isArray(allAssets) ? allAssets : []);
    } catch (e: any) {
      console.error("Admin loaded error:", e);
      setLoadError(e?.message || "Failed to load admin metrics.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const [roleChangeTarget, setRoleChangeTarget] = useState<{ user: any; newRole: 'user' | 'admin' } | null>(null);
  const [roleUpdating, setRoleUpdating] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  const confirmToggleUserRole = async () => {
    if (!roleChangeTarget) return;
    setRoleUpdating(true);
    setRoleError(null);
    try {
      await saveUserProfile(roleChangeTarget.user.uid, roleChangeTarget.user.email, {
        role: roleChangeTarget.newRole
      });
      // Update role locally in state
      setUsers(prev => prev.map(u => u.uid === roleChangeTarget.user.uid ? { ...u, role: roleChangeTarget.newRole } : u));
      setRoleChangeTarget(null);
    } catch (err: any) {
      setRoleError(err?.message || "Failed to update role");
    } finally {
      setRoleUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
        <p className="text-slate-400 text-sm">Loading Administration Dashboard...</p>
      </div>
    );
  }

  // Aggregate stats
  const totalUsers = users.length;
  const totalAssets = assets.length;
  const activeKeysCount = users.filter(u => Boolean(u.hasApiKeys || u.savedApiKey || u.savedGroqKey)).length;

  const typeCounts = { Photo: 0, Video: 0, Vector: 0, Illustration: 0 };
  const statusCounts = { idle: 0, processing: 0, completed: 0, error: 0 };

  assets.forEach(asset => {
    if (typeCounts[asset.type as keyof typeof typeCounts] !== undefined) {
      typeCounts[asset.type as keyof typeof typeCounts]++;
    }
    if (statusCounts[asset.status as keyof typeof statusCounts] !== undefined) {
      statusCounts[asset.status as keyof typeof statusCounts]++;
    }
  });

  // Filter users based on search query
  const filteredUsers = users.filter(user => 
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.uid?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8 font-sans">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
              <Shield className="w-4 h-4 text-indigo-600" />
            </div>
            Studio Administration
          </h2>
          <p className="text-slate-500 text-xs mt-1">
            Global operational overview of LensLogic Studio. Real-time platform metrics.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="self-start md:self-auto px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-700 flex items-center gap-2 transition-all shadow-xs cursor-pointer active:scale-[0.99]"
        >
          <RefreshCw className={cn("w-3.5 h-3.5 text-indigo-600", refreshing && "animate-spin")} />
          Sync Live Data
        </button>
      </header>

      {loadError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="px-3 py-1 bg-white border border-rose-200 rounded-lg font-semibold hover:bg-rose-100 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs relative overflow-hidden">
          <div className="absolute top-0 right-0 p-5 opacity-5">
            <Users className="w-20 h-20 text-indigo-600" />
          </div>
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Registered Creators</p>
          <h3 className="text-3xl font-extrabold text-slate-900 mt-2">{totalUsers}</h3>
          <div className="flex items-center gap-1.5 text-emerald-600 text-xs font-semibold mt-3">
            <UserCheck className="w-3.5 h-3.5" />
            <span>{activeKeysCount} users with API keys</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs relative overflow-hidden">
          <div className="absolute top-0 right-0 p-5 opacity-5">
            <Database className="w-20 h-20 text-indigo-600" />
          </div>
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Assets Saved</p>
          <h3 className="text-3xl font-extrabold text-slate-900 mt-2">{totalAssets}</h3>
          <p className="text-slate-500 text-xs mt-3 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>{statusCounts.completed} completely processed</span>
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs relative overflow-hidden">
          <div className="absolute top-0 right-0 p-5 opacity-5">
            <RefreshCw className="w-20 h-20 text-indigo-600" />
          </div>
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Success Rate</p>
          <h3 className="text-3xl font-extrabold text-slate-900 mt-2">
            {totalAssets > 0 
              ? `${Math.round(((statusCounts.completed) / totalAssets) * 100)}%` 
              : '100%'}
          </h3>
          <p className="text-slate-500 text-xs mt-3 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
            <span>{statusCounts.error} generation errors</span>
          </p>
        </div>
      </div>

      {/* Asset Breakdown */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 mb-4">Storage Metrics & Distribution</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/60 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-100/70 flex items-center justify-center text-indigo-600">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Photos</p>
              <p className="text-base font-bold text-slate-900 mt-0.5">{typeCounts.Photo + typeCounts.Illustration}</p>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/60 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100/70 flex items-center justify-center text-emerald-600">
              <Video className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Videos</p>
              <p className="text-base font-bold text-slate-900 mt-0.5">{typeCounts.Video}</p>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/60 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100/70 flex items-center justify-center text-amber-600">
              <FileCode className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Vectors</p>
              <p className="text-base font-bold text-slate-900 mt-0.5">{typeCounts.Vector}</p>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/60 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-rose-100/70 flex items-center justify-center text-rose-600">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pending</p>
              <p className="text-base font-bold text-slate-900 mt-0.5">{statusCounts.processing}</p>
            </div>
          </div>
        </div>
      </div>

      {/* User Directory */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <header className="p-6 border-b border-slate-200/80 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Creator Directory</h3>
            <p className="text-slate-500 text-xs mt-0.5">Manage creator registrations and verify custom setups.</p>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by email..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 transition-all"
            />
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/80">
                <th className="p-4 text-[11px] font-bold text-slate-600 uppercase tracking-wider">Creator Email</th>
                <th className="p-4 text-[11px] font-bold text-slate-600 uppercase tracking-wider">User ID</th>
                <th className="p-4 text-[11px] font-bold text-slate-600 uppercase tracking-wider">Role</th>
                <th className="p-4 text-[11px] font-bold text-slate-600 uppercase tracking-wider">Custom Setup</th>
                <th className="p-4 text-[11px] font-bold text-slate-600 uppercase tracking-wider">Saved Assets</th>
                <th className="p-4 text-[11px] font-bold text-slate-600 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length > 0 ? (
                filteredUsers.map((user, idx) => {
                  const userAssetsCount = assets.filter(a => a.userId === user.uid).length;
                  const hasKeys = Boolean(user.hasApiKeys || user.savedApiKey || user.savedGroqKey);
                  return (
                    <tr key={user.uid || idx} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-4 text-xs font-semibold text-slate-900">{user.email || 'Guest'}</td>
                      <td className="p-4 text-xs font-mono text-slate-500">{user.uid}</td>
                      <td className="p-4">
                        <span className={cn(
                          "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase",
                          user.role === 'admin' 
                            ? "bg-indigo-50 text-indigo-700 border border-indigo-200" 
                            : "bg-slate-100 text-slate-600 border border-slate-200"
                        )}>
                          {user.role}
                        </span>
                      </td>
                      <td className="p-4 text-xs">
                        <span className={cn(
                          "flex items-center gap-1 font-medium",
                          hasKeys ? "text-emerald-600" : "text-slate-400"
                        )}>
                          {hasKeys ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {user.apiKeyCount ? `${user.apiKeyCount} Active` : 'Active Keys'}
                            </>
                          ) : 'No API Keys'}
                        </span>
                      </td>
                      <td className="p-4 text-xs font-mono font-medium text-slate-700">{userAssetsCount}</td>
                      <td className="p-4">
                        <button
                          onClick={() => setRoleChangeTarget({ user, newRole: user.role === 'admin' ? 'user' : 'admin' })}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-indigo-50 text-[10px] font-bold uppercase tracking-wider text-slate-700 hover:text-indigo-600 rounded-lg border border-slate-200 hover:border-indigo-200 cursor-pointer transition-all active:scale-[0.99]"
                        >
                          Toggle Role
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-xs text-slate-400">
                    No matching creators found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role Change Modal */}
      {roleChangeTarget && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-6 shadow-xl relative overflow-hidden">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center border border-indigo-100 shrink-0">
                <Shield className="text-indigo-600 w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Change Account Role</h3>
                <p className="text-xs text-slate-500 truncate max-w-[200px]">{roleChangeTarget.user.email}</p>
              </div>
            </div>

            <p className="text-slate-600 text-xs mb-4 leading-relaxed">
              Are you sure you want to change this creator's role to <span className="font-bold text-indigo-600 uppercase">{roleChangeTarget.newRole}</span>?
            </p>

            {roleError && (
              <div className="mb-4 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {roleError}
              </div>
            )}

            <div className="flex justify-end gap-2.5">
              <button
                disabled={roleUpdating}
                onClick={() => { setRoleChangeTarget(null); setRoleError(null); }}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={roleUpdating}
                onClick={confirmToggleUserRole}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 active:scale-[0.99]"
              >
                {roleUpdating ? "Updating..." : `Confirm ${roleChangeTarget.newRole.toUpperCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
