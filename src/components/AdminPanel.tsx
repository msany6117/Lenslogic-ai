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
  const [searchQuery, setSearchQuery] = useState('');

  const loadData = async () => {
    try {
      const allUsers = await adminLoadAllUsers();
      const allAssets = await adminLoadAllAssets();
      setUsers(allUsers);
      setAssets(allAssets);
    } catch (e) {
      console.error("Admin loaded error:", e);
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
        savedSettings: roleChangeTarget.user.savedSettings,
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
  const activeKeysCount = users.filter(u => u.savedApiKey || u.savedGroqKey).length;

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
    <div className="space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-display font-bold text-white flex items-center gap-3">
            <Shield className="w-8 h-8 text-indigo-400" />
            Studio Administration
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Global operational overview of LensLogic Studio. Real-time platform metrics.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="self-start md:self-auto px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer"
        >
          <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
          Sync Live Data
        </button>
      </header>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass rounded-2xl p-6 border border-white/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-5">
            <Users className="w-24 h-24 text-indigo-400" />
          </div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Registered Creators</p>
          <h3 className="text-4xl font-display font-extrabold text-white mt-2">{totalUsers}</h3>
          <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold mt-3">
            <UserCheck className="w-4 h-4" />
            <span>{activeKeysCount} users with API keys</span>
          </div>
        </div>

        <div className="glass rounded-2xl p-6 border border-white/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-5">
            <Database className="w-24 h-24 text-indigo-400" />
          </div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Assets Saved</p>
          <h3 className="text-4xl font-display font-extrabold text-white mt-2">{totalAssets}</h3>
          <p className="text-slate-400 text-xs mt-3 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>{statusCounts.completed} completely processed</span>
          </p>
        </div>

        <div className="glass rounded-2xl p-6 border border-white/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-5">
            <RefreshCw className="w-24 h-24 text-indigo-400" />
          </div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Success Rate</p>
          <h3 className="text-4xl font-display font-extrabold text-white mt-2">
            {totalAssets > 0 
              ? `${Math.round(((statusCounts.completed) / totalAssets) * 100)}%` 
              : '100%'}
          </h3>
          <p className="text-slate-400 text-xs mt-3 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
            <span>{statusCounts.error} generation errors</span>
          </p>
        </div>
      </div>

      {/* Asset Breakdown */}
      <div className="glass rounded-2xl p-6 border border-white/5">
        <h3 className="text-base font-bold text-white mb-4">Storage Metrics & Distribution</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Photos</p>
              <p className="text-lg font-bold text-white mt-0.5">{typeCounts.Photo + typeCounts.Illustration}</p>
            </div>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <Video className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Videos</p>
              <p className="text-lg font-bold text-white mt-0.5">{typeCounts.Video}</p>
            </div>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Vectors</p>
              <p className="text-lg font-bold text-white mt-0.5">{typeCounts.Vector}</p>
            </div>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Generating</p>
              <p className="text-lg font-bold text-white mt-0.5">{statusCounts.processing}</p>
            </div>
          </div>
        </div>
      </div>

      {/* User Directory */}
      <div className="glass rounded-2xl border border-white/5 overflow-hidden">
        <header className="p-6 border-b border-white/5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">Creator Directory</h3>
            <p className="text-slate-400 text-xs mt-1">Manage creator registrations and verify custom setups.</p>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by email..."
              className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500/40 text-white"
            />
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/[0.02] border-b border-white/5">
                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Creator Email</th>
                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">User ID</th>
                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Role</th>
                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Custom Setup</th>
                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Saved Assets</th>
                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredUsers.length > 0 ? (
                filteredUsers.map((user, idx) => {
                  const userAssetsCount = assets.filter(a => a.userId === user.uid).length;
                  const hasKeys = user.savedApiKey || user.savedGroqKey;
                  return (
                    <tr key={user.uid || idx} className="hover:bg-white/[0.01] transition-colors">
                      <td className="p-4 text-xs font-medium text-white">{user.email || 'Guest'}</td>
                      <td className="p-4 text-xs font-mono text-slate-500">{user.uid}</td>
                      <td className="p-4">
                        <span className={cn(
                          "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase",
                          user.role === 'admin' 
                            ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30" 
                            : "bg-slate-800 text-slate-400 border border-slate-700/50"
                        )}>
                          {user.role}
                        </span>
                      </td>
                      <td className="p-4 text-xs">
                        <span className={cn(
                          "flex items-center gap-1",
                          hasKeys ? "text-emerald-400" : "text-slate-500"
                        )}>
                          {hasKeys ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Active Keys
                            </>
                          ) : 'No API Keys'}
                        </span>
                      </td>
                      <td className="p-4 text-xs font-mono text-slate-300">{userAssetsCount}</td>
                      <td className="p-4">
                        <button
                          onClick={() => setRoleChangeTarget({ user, newRole: user.role === 'admin' ? 'user' : 'admin' })}
                          className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-[10px] font-bold uppercase tracking-wider text-indigo-400 hover:text-indigo-300 rounded-lg border border-white/5 cursor-pointer transition-all"
                        >
                          Toggle Role
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-xs text-slate-500">
                    No matching creators found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role Change Modal (Replaces native window.confirm) */}
      {roleChangeTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#110f17] border border-white/10 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative overflow-hidden">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shrink-0">
                <Shield className="text-indigo-400 w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Change Account Role</h3>
                <p className="text-xs text-slate-400">{roleChangeTarget.user.email}</p>
              </div>
            </div>

            <p className="text-slate-300 text-xs mb-4 leading-relaxed">
              Are you sure you want to change this creator's role to <span className="font-bold text-indigo-300 uppercase">{roleChangeTarget.newRole}</span>?
            </p>

            {roleError && (
              <div className="mb-4 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                {roleError}
              </div>
            )}

            <div className="flex justify-end gap-2.5">
              <button
                disabled={roleUpdating}
                onClick={() => { setRoleChangeTarget(null); setRoleError(null); }}
                className="px-3.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={roleUpdating}
                onClick={confirmToggleUserRole}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-2 cursor-pointer disabled:opacity-50"
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
