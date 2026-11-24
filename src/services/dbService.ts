import type { ImageMetadata } from "../types";
import { compressToDataUrl } from "../lib/utils";

const AUTH_TOKEN_STORAGE_KEY = "lenslogic_token";
const USER_STORAGE_KEY = "lenslogic_user";

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

export async function ensureGuestSession(existingUid?: string): Promise<any> {
  const res = await fetch(getApiUrl("/api/auth/guest"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(existingUid ? { uid: existingUid } : {})
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "Failed to start guest session.");
  }
  const data = await res.json();
  if (data?.token) {
    setAuthToken(data.token);
  }
  if (data?.user) {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
  }
  return data.user;
}

export async function verifyAuthSession(): Promise<any | null> {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const res = await fetch(getApiUrl("/api/auth/me"), {
      headers: getAuthHeaders()
    });
    if (res.status === 401) {
      setAuthToken(null);
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.user) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
      return data.user;
    }
  } catch {
    return null;
  }
  return null;
}

// Helper to determine the backend API base URL
export function getApiUrl(path: string): string {
  try {
    const localUrl = localStorage.getItem("LENS_LOGIC_API_URL")?.trim();
    if (localUrl && (localUrl.startsWith("http://") || localUrl.startsWith("https://"))) {
      // Ignore stale AI Studio preview URLs that differ from the active origin to avoid cross-origin Failed to fetch
      if (typeof window !== "undefined") {
        try {
          const parsed = new URL(localUrl);
          if (
            parsed.origin !== window.location.origin &&
            (parsed.hostname.includes(".run.app") || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
          ) {
            localStorage.removeItem("LENS_LOGIC_API_URL");
            return path;
          }
        } catch {
          return path;
        }
      }
      return `${localUrl.replace(/\/$/, "")}${path}`;
    }
    const envUrl = (import.meta as any).env?.VITE_API_URL;
    if (envUrl && (envUrl.startsWith("http://") || envUrl.startsWith("https://"))) {
      return `${envUrl.replace(/\/$/, "")}${path}`;
    }
  } catch (_) {}
  // Default to relative path which is always safe and on the same origin (no CORS or invalid URL issues)
  return path;
}

// Save or update user profile settings
export async function saveUserProfile(uid: string, email: string, data?: Partial<{
  savedApiKey: string;
  savedGroqKey: string;
  savedSettings: any;
  role: "user" | "admin";
}>) {
  if (!getAuthToken()) {
    return;
  }
  const payload: Record<string, any> = { uid, email };
  if (data && "savedSettings" in data && data.savedSettings !== undefined) {
    payload.savedSettings = data.savedSettings;
  }
  if (data?.role) {
    payload.role = data.role;
  }

  const postUpdate = () =>
    fetch(getApiUrl("/api/users/update"), {
      method: "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    });

  let res: Response;
  try {
    res = await postUpdate();
  } catch {
    // Offline or cross-origin unreachable; settings remain persisted in localStorage
    return;
  }

  if (res.status === 401) {
    const isGuest = uid.startsWith("guest_") || email === "guest@lenslogic.ai";
    setAuthToken(null);
    if (isGuest) {
      try {
        await ensureGuestSession(uid);
        if (getAuthToken()) {
          res = await postUpdate();
        } else {
          return;
        }
      } catch {
        return;
      }
    } else {
      return;
    }
  }

  // On serverless deployments (e.g. Vercel without DB persistence), 404/405/HTML is expected; keep localStorage state
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (res.status === 404 || res.status === 405 || contentType.includes("text/html")) {
    return;
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error || "Failed to update profile settings.");
  }
}

// Fetch user profile (locally cached during login or retrieved if needed)
export async function getUserProfile(uid: string) {
  try {
    const saved = localStorage.getItem(USER_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.uid === uid) {
        return parsed;
      }
    }
  } catch (e) {
    console.error(e);
  }
  return null;
}

// Save an asset to the Express custom database
export async function saveAsset(asset: ImageMetadata, userId: string) {
  try {
    if (!getAuthToken()) return;
    // Compress preview image to optimize transmission size
    let compressedPreview = asset.preview;
    if (asset.preview) {
      if (asset.preview.startsWith("blob:")) {
        try {
          // Instantly compress the blob: URL on the client side!
          compressedPreview = await compressToDataUrl(asset.preview, 400, 400, 0.7);
          
          // CRITICAL OPTIMIZATION: Mutate the local asset.preview with the compressed base64
          // so subsequent calls to saveAsset for this asset immediately skip compression.
          asset.preview = compressedPreview;
        } catch (e) {
          console.warn("Failed to compress blob preview:", e);
        }
      } else if (asset.preview.startsWith("data:image")) {
        // ALREADY COMPRESSED! Bypassing is extremely fast and saves 100% of CPU cycles
        compressedPreview = asset.preview;
      }
    }

    const assetData = {
      id: asset.id,
      userId,
      name: asset.fileName || asset.file?.name || "unnamed_asset",
      type: asset.type,
      preview: compressedPreview || "",
      title: asset.title || "",
      description: asset.description || "",
      keywords: asset.keywords || [],
      status: asset.status,
      errorMsg: asset.error || "",
      createdAt: asset.createdAt || new Date().toISOString()
    };

    const res = await fetch(getApiUrl("/api/assets"), {
      method: "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(assetData)
    });

    if (!res.ok) {
      throw new Error("Failed to save asset.");
    }
  } catch (err) {
    console.error("saveAsset error:", err);
  }
}

// Load all assets for a user
export async function loadUserAssets(userId: string): Promise<ImageMetadata[]> {
  try {
    if (!getAuthToken()) return [];
    const res = await fetch(getApiUrl(`/api/assets?userId=${encodeURIComponent(userId)}`), {
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      throw new Error("Failed to load assets.");
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      return data.map((item: any) => ({
        id: item.id,
        fileName: item.name,
        type: item.type,
        preview: item.preview,
        title: item.title,
        description: item.description,
        keywords: item.keywords,
        status: item.status,
        error: item.errorMsg,
        createdAt: item.createdAt
      }));
    }
  } catch (err) {
    console.error("loadUserAssets error:", err);
  }
  return [];
}

// Delete an asset from database
export async function deleteAssetFromDb(assetId: string) {
  try {
    if (!getAuthToken()) return;
    const res = await fetch(getApiUrl(`/api/assets/${encodeURIComponent(assetId)}`), {
      method: "DELETE",
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      throw new Error("Failed to delete asset.");
    }
  } catch (err) {
    console.error("deleteAssetFromDb error:", err);
  }
}

// Clear all assets for a user from database
export async function clearAllAssetsFromDb(userId: string) {
  try {
    if (!getAuthToken()) return;
    const res = await fetch(getApiUrl("/api/assets/clear"), {
      method: "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ userId })
    });
    if (!res.ok) {
      throw new Error("Failed to clear assets.");
    }
  } catch (err) {
    console.error("clearAllAssetsFromDb error:", err);
  }
}

// Admin function: Load all users
export async function adminLoadAllUsers() {
  const res = await fetch(getApiUrl("/api/admin/users"), {
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error || "Failed to load admin users.");
  }
  return await res.json();
}

// Admin function: Load all assets for metrics
export async function adminLoadAllAssets() {
  const res = await fetch(getApiUrl("/api/admin/assets"), {
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error || "Failed to load admin assets.");
  }
  return await res.json();
}
