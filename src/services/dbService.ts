import type { ImageMetadata } from "../types";
import { compressImage } from "../lib/utils";

// Helper to determine the backend API base URL
export function getApiUrl(path: string): string {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  // process.env.APP_URL is injected via Vite's define config
  const appUrl = (typeof process !== "undefined" && process.env?.APP_URL) || "";
  const localUrl = localStorage.getItem("LENS_LOGIC_API_URL");
  
  // Choose the best available base URL
  const base = (envUrl || localUrl || appUrl || "").replace(/\/$/, "");
  
  // If we don't have any base configured, use relative path as is.
  // When on localhost, do NOT prefix relative path because the backend dev server is on the same port/origin
  if (!base || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return path;
  }
  
  return `${base}${path}`;
}

// Save or update user profile settings
export async function saveUserProfile(uid: string, email: string, data?: Partial<{
  savedApiKey: string;
  savedGroqKey: string;
  savedSettings: any;
}>) {
  try {
    const res = await fetch(getApiUrl("/api/users/update"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid,
        email,
        savedSettings: data?.savedSettings || null
      })
    });
    if (!res.ok) {
      throw new Error("Failed to update profile settings.");
    }
  } catch (err) {
    console.error("saveUserProfile error:", err);
  }
}

// Fetch user profile (locally cached during login or retrieved if needed)
export async function getUserProfile(uid: string) {
  try {
    const saved = localStorage.getItem("lenslogic_user");
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
    // Compress preview image to optimize transmission size
    let compressedPreview = asset.preview;
    if (asset.preview) {
      if (asset.preview.startsWith("blob:")) {
        try {
          const response = await fetch(asset.preview);
          const blob = await response.blob();
          const base64Data = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = reject;
            r.readAsDataURL(blob);
          });
          compressedPreview = await compressImage(base64Data, 400, 400, 0.7);
          
          // CRITICAL OPTIMIZATION: Mutate the local asset.preview with the compressed base64
          // so subsequent calls to saveAsset for this asset immediately skip compression.
          asset.preview = compressedPreview;
        } catch (e) {
          console.warn("Failed to fetch or compress blob preview:", e);
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
      headers: { "Content-Type": "application/json" },
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
    const res = await fetch(getApiUrl(`/api/assets?userId=${encodeURIComponent(userId)}`));
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
    const res = await fetch(getApiUrl(`/api/assets/${encodeURIComponent(assetId)}`), {
      method: "DELETE"
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
    const res = await fetch(getApiUrl("/api/assets/clear"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  try {
    const res = await fetch(getApiUrl("/api/admin/users"));
    if (!res.ok) {
      throw new Error("Failed to load admin users.");
    }
    return await res.json();
  } catch (err) {
    console.error("adminLoadAllUsers error:", err);
    return [];
  }
}

// Admin function: Load all assets for metrics
export async function adminLoadAllAssets() {
  try {
    const res = await fetch(getApiUrl("/api/admin/assets"));
    if (!res.ok) {
      throw new Error("Failed to load admin assets.");
    }
    return await res.json();
  } catch (err) {
    console.error("adminLoadAllAssets error:", err);
    return [];
  }
}
