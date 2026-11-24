import express from "express";
import http from "http";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import crypto from "crypto";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

dotenv.config();

const DB_PATH = path.join(process.cwd(), "database.json");

// Helper to hash and verify passwords securely using salted scrypt (with timing-safe legacy sha256 verification)
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash) return false;
  if (storedHash.startsWith("scrypt:")) {
    const parts = storedHash.split(":");
    if (parts.length !== 3) return false;
    const [, salt, hexHash] = parts;
    const expected = Buffer.from(hexHash, "hex");
    const actual = crypto.scryptSync(password, salt, 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }
  const legacyHash = crypto.createHash("sha256").update(password).digest("hex");
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(legacyHash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Initialize and load Database
interface DbSchema {
  users: Array<{
    uid: string;
    email: string;
    passwordHash: string;
    role: "user" | "admin";
    savedSettings: any;
    createdAt: string;
  }>;
  assets: Array<{
    id: string;
    userId: string;
    name: string;
    type: string;
    preview: string;
    title: string;
    description: string;
    keywords: string[];
    status: string;
    errorMsg: string;
    createdAt: string;
  }>;
  sessionSecret?: string;
}

let database: DbSchema = { users: [], assets: [] };
let tokenSigningSecret = "";

function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, "utf8");
      database = JSON.parse(data);
      if (!database.users) database.users = [];
      if (!database.assets) database.assets = [];
    } else {
      saveDb();
    }
  } catch (e) {
    console.error("Error loading database:", e);
  }

  if (database.sessionSecret && typeof database.sessionSecret === "string") {
    tokenSigningSecret = database.sessionSecret;
  } else {
    tokenSigningSecret = crypto.randomBytes(32).toString("hex");
    database.sessionSecret = tokenSigningSecret;
    saveDb();
  }
}

function createSessionToken(user: { uid: string; role: "user" | "admin" }): string {
  const payload = Buffer.from(
    JSON.stringify({
      uid: user.uid,
      role: user.role,
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", tokenSigningSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifySessionToken(token: string): { uid: string; role: "user" | "admin" } | null {
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expectedSig = crypto.createHmac("sha256", tokenSigningSecret).update(payload).digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded?.uid || typeof decoded.exp !== "number" || Date.now() > decoded.exp) {
      return null;
    }
    return {
      uid: String(decoded.uid),
      role: decoded.role === "admin" ? "admin" : "user",
    };
  } catch {
    return null;
  }
}

let saveTimeout: NodeJS.Timeout | null = null;

function saveDb() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFile(DB_PATH, JSON.stringify(database, null, 2), "utf8", (err) => {
        if (err) {
          console.error("Error saving database in background:", err);
        }
      });
    } catch (e) {
      console.error("Error scheduling database save:", e);
    }
  }, 300);
}

loadDb();

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  // Middleware for parsing JSON with a larger limit for images/vector files
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  const extractBearerUser = (req: express.Request) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return null;
    return verifySessionToken(token);
  };

  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authUser = extractBearerUser(req);
    if (!authUser) {
      return res.status(401).json({ error: "Authentication required." });
    }
    (req as any).authUser = authUser;
    next();
  };

  const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authUser = extractBearerUser(req);
    if (!authUser || authUser.role !== "admin") {
      return res.status(401).json({ error: "Administrator access required." });
    }
    (req as any).authUser = authUser;
    next();
  };

  // --- AUTHENTICATION ENDPOINTS ---

  // Register Endpoint
  app.post("/api/auth/register", (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const userExists = database.users.some(u => u.email.toLowerCase() === normalizedEmail);
      if (userExists) {
        return res.status(400).json({ error: "This email is already registered." });
      }

      const role = normalizedEmail === "msany6117@gmail.com" ? "admin" : "user";
      const uid = "u_" + crypto.randomBytes(6).toString("hex");

      const newUser = {
        uid,
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        role: role as "user" | "admin",
        savedSettings: null,
        createdAt: new Date().toISOString()
      };

      database.users.push(newUser);
      saveDb();

      const token = createSessionToken({ uid: newUser.uid, role: newUser.role });
      const { passwordHash, ...userResponse } = newUser;
      res.status(201).json({ user: userResponse, token });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Registration failed." });
    }
  });

  // Login Endpoint
  app.post("/api/auth/login", (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const user = database.users.find(u => u.email.toLowerCase() === normalizedEmail);

      if (!user) {
        return res.status(401).json({ error: "Account not found with this email." });
      }

      if (!verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: "Incorrect password." });
      }

      const token = createSessionToken({ uid: user.uid, role: user.role });
      const { passwordHash, ...userResponse } = user;
      res.json({ user: userResponse, token });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Login failed." });
    }
  });

  // Guest Session Endpoint
  app.post("/api/auth/guest", (req, res) => {
    try {
      const requestedUid = typeof req.body?.uid === "string" && /^guest_[a-z0-9_-]{4,32}$/i.test(req.body.uid)
        ? req.body.uid
        : `guest_${crypto.randomBytes(5).toString("hex")}`;

      let user = database.users.find(u => u.uid === requestedUid);
      if (!user) {
        user = {
          uid: requestedUid,
          email: "guest@lenslogic.ai",
          passwordHash: "",
          role: "user",
          savedSettings: null,
          createdAt: new Date().toISOString()
        };
        database.users.push(user);
        saveDb();
      }
      const token = createSessionToken({ uid: user.uid, role: user.role });
      const { passwordHash, ...userResponse } = user;
      res.json({ user: userResponse, token });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Failed to create guest session." });
    }
  });

  // Current Session Endpoint
  app.get("/api/auth/me", requireAuth, (req, res) => {
    const authUser = (req as any).authUser as { uid: string; role: "user" | "admin" };
    const user = database.users.find(u => u.uid === authUser.uid);
    if (!user) {
      return res.status(404).json({ error: "Session user not found." });
    }
    const { passwordHash, ...userResponse } = user;
    res.json({ user: userResponse });
  });

  // Update Settings Endpoint
  app.post("/api/users/update", requireAuth, (req, res) => {
    try {
      const authUser = (req as any).authUser as { uid: string; role: "user" | "admin" };
      const { uid, email, savedSettings, role } = req.body;
      const targetUid = uid || authUser.uid;

      if (targetUid !== authUser.uid && authUser.role !== "admin") {
        return res.status(401).json({ error: "Unauthorized profile update." });
      }

      const userIndex = database.users.findIndex(u => u.uid === targetUid);
      if (userIndex === -1) {
        const assignedRole = authUser.role === "admin" && role === "admin" ? "admin" : "user";
        database.users.push({
          uid: targetUid,
          email: email || "anonymous@lenslogic.ai",
          passwordHash: "",
          role: assignedRole,
          savedSettings: savedSettings || null,
          createdAt: new Date().toISOString()
        });
      } else {
        if (savedSettings !== undefined) {
          database.users[userIndex].savedSettings = savedSettings;
        }
        if (role && authUser.role === "admin") {
          database.users[userIndex].role = role === "admin" ? "admin" : "user";
        }
        if (email) {
          database.users[userIndex].email = email;
        }
      }
      saveDb();
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update profile settings." });
    }
  });

  // --- ASSETS ENDPOINTS ---

  // Load User Assets
  app.get("/api/assets", requireAuth, (req, res) => {
    try {
      const authUser = (req as any).authUser as { uid: string; role: "user" | "admin" };
      const userId = String(req.query.userId || authUser.uid);
      if (userId !== authUser.uid && authUser.role !== "admin") {
        return res.status(401).json({ error: "Unauthorized asset access." });
      }

      const userAssets = database.assets.filter(a => a.userId === userId);
      res.json(userAssets);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load assets." });
    }
  });

  // Save/Update Asset
  app.post("/api/assets", requireAuth, (req, res) => {
    try {
      const authUser = (req as any).authUser as { uid: string; role: "user" | "admin" };
      const { id, userId, name, type, preview, title, description, keywords, status, errorMsg, createdAt } = req.body;
      const effectiveUserId = userId || authUser.uid;
      if (!id) {
        return res.status(400).json({ error: "Asset ID is required." });
      }
      if (effectiveUserId !== authUser.uid && authUser.role !== "admin") {
        return res.status(401).json({ error: "Unauthorized asset write." });
      }

      const assetIndex = database.assets.findIndex(a => a.id === id);
      if (assetIndex !== -1 && database.assets[assetIndex].userId !== authUser.uid && authUser.role !== "admin") {
        return res.status(401).json({ error: "Unauthorized asset modification." });
      }
      const assetData = {
        id,
        userId: effectiveUserId,
        name: name || "unnamed_asset",
        type: type || "Photo",
        preview: preview || "",
        title: title || "",
        description: description || "",
        keywords: keywords || [],
        status: status || "idle",
        errorMsg: errorMsg || "",
        createdAt: createdAt || new Date().toISOString()
      };

      if (assetIndex === -1) {
        database.assets.push(assetData);
      } else {
        database.assets[assetIndex] = {
          ...database.assets[assetIndex],
          ...assetData
        };
      }

      saveDb();
      res.json({ success: true, asset: assetData });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save asset." });
    }
  });

  // Delete Asset
  app.delete("/api/assets/:id", requireAuth, (req, res) => {
    try {
      const authUser = (req as any).authUser as { uid: string; role: "user" | "admin" };
      const { id } = req.params;
      const existing = database.assets.find(a => a.id === id);
      if (!existing) {
        return res.status(404).json({ error: "Asset not found." });
      }
      if (existing.userId !== authUser.uid && authUser.role !== "admin") {
        return res.status(401).json({ error: "Unauthorized asset deletion." });
      }

      database.assets = database.assets.filter(a => a.id !== id);
      saveDb();
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete asset." });
    }
  });

  // Clear All Assets for a User
  app.post("/api/assets/clear", requireAuth, (req, res) => {
    try {
      const authUser = (req as any).authUser as { uid: string; role: "user" | "admin" };
      const targetUserId = String(req.body?.userId || authUser.uid);
      if (targetUserId !== authUser.uid && authUser.role !== "admin") {
        return res.status(401).json({ error: "Unauthorized asset clear." });
      }

      database.assets = database.assets.filter(a => a.userId !== targetUserId);
      saveDb();
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to clear assets." });
    }
  });

  // --- ADMIN PANEL METRICS ---

  app.get("/api/admin/users", requireAdmin, (req, res) => {
    try {
      // Map out sensitive info like passwords and raw API keys
      const safeUsers = database.users.map(({ passwordHash, ...u }) => {
        const hasApiKeys = Boolean(
          Array.isArray(u.savedSettings?.apiKeys) && u.savedSettings.apiKeys.some((k: any) => k?.key?.trim())
        );
        return {
          ...u,
          hasApiKeys,
          savedSettings: u.savedSettings ? { ...u.savedSettings, apiKeys: undefined } : null,
        };
      });
      res.json(safeUsers);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch admin users." });
    }
  });

  app.get("/api/admin/assets", requireAdmin, (req, res) => {
    try {
      res.json(database.assets);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch admin assets." });
    }
  });

  // --- SHARED GEMINI CLIENT UTILITY ---
  let cachedServerAi: GoogleGenAI | null = null;

  function getAiClient(customKey?: string) {
    const trimmed = typeof customKey === 'string' ? customKey.trim() : '';
    if (trimmed) {
      return new GoogleGenAI({
        apiKey: trimmed,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
    }
    if (!cachedServerAi) {
      cachedServerAi = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY || "",
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
    }
    return cachedServerAi;
  }

  function safeParseJsonObject(rawText: string): any {
    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end > start) {
        return JSON.parse(cleaned.slice(start, end + 1));
      }
      throw new Error('AI response did not contain valid JSON metadata.');
    }
  }

  // Gemini Service Health Status
  app.get("/api/gemini/status", (req, res) => {
    res.json({
      configured: Boolean(process.env.GEMINI_API_KEY),
      model: "gemini-4-hydrogen"
    });
  });

  function getFormatLabel(fileExtension?: string, assetType: string = 'Photo', isTransparent = false): { extUpper: string; phrase: string } {
    const ext = (fileExtension || '').toLowerCase().replace(/^\./, '');
    const extUpper = ext.toUpperCase();
    if (ext === 'eps') return { extUpper: 'EPS', phrase: 'EPS vector illustration' };
    if (ext === 'ai') return { extUpper: 'AI', phrase: 'AI vector illustration' };
    if (ext === 'svg') return { extUpper: 'SVG', phrase: 'SVG vector graphic' };
    if (ext === 'pdf') return { extUpper: 'PDF', phrase: 'PDF vector graphic' };
    if (ext === 'png') return { extUpper: 'PNG', phrase: isTransparent ? 'transparent PNG' : 'PNG graphic' };
    if (ext === 'jpg' || ext === 'jpeg') {
      return { extUpper: 'JPG', phrase: assetType === 'Illustration' ? 'JPG illustration' : assetType === 'Vector' ? 'JPG vector graphic' : 'JPG photo' };
    }
    if (ext === 'webp') return { extUpper: 'WEBP', phrase: isTransparent ? 'transparent WebP graphic' : 'WebP image' };
    if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'mpg'].includes(ext)) return { extUpper: extUpper || 'MP4', phrase: `${extUpper || 'MP4'} stock video` };
    if (assetType === 'Vector') return { extUpper: 'VECTOR', phrase: 'vector illustration' };
    if (assetType === 'Illustration') return { extUpper: 'ILLUSTRATION', phrase: 'digital illustration' };
    if (assetType === 'Video') return { extUpper: 'VIDEO', phrase: 'stock video footage' };
    return { extUpper: extUpper || 'PHOTO', phrase: 'stock photo' };
  }

  // Helper to build high-converting stock SEO prompt
  function buildSeoPrompt(settings: any, assetType: string = 'Photo', fileExtension?: string): string {
    const platform = settings?.platform || 'Adobe Stock';
    const titleLength = settings?.titleLength || '20-200';
    const keywordCount = settings?.keywordCount || 30;
    const isTransparent = Boolean(settings?.transparentBackground);
    const { extUpper, phrase } = getFormatLabel(fileExtension, assetType, isTransparent);

    return `
      You are an elite Stock Marketplace SEO Strategist who ranks assets #1 on ${platform}, Shutterstock, and Freepik for maximum contributor downloads.
      Analyze the image carefully and generate ultra-high-converting, buyer-intent metadata.

      Asset Context:
      - Target Marketplace: ${platform}
      - Asset Type: ${assetType}
      - File Format: ${extUpper} (${phrase})
      - Title Length Target: ${titleLength} characters (strictly respect this length window).
      - Keyword Count: Exactly ${keywordCount} keywords.
      - Transparent Background Mode: ${isTransparent ? 'ENABLED (MANDATORY)' : 'AUTO-DETECT'}

      Title SEO Rules (CRITICAL for top search ranking & downloads):
      1. Front-load the most-searched primary subject, action, and commercial concept in the FIRST 50 characters.
      2. ALWAYS naturally include the asset/file format (${extUpper} / ${phrase}) inside the title so buyers filtering or searching for "${extUpper}" or "${assetType.toLowerCase()}" find this asset immediately.
      3. Include visual style, mood, composition, or commercial use-case (e.g., flat minimalist, 3D render, vibrant gradient, marketing banner, UI icon) without robotic repetition.
      ${isTransparent
        ? `4. TRANSPARENT RULE (STRICT): This file has a transparent background. You MUST explicitly include "transparent" or "isolated on transparent background" in the title. NEVER write "white background", "on white", "isolated on white", or "white backdrop" anywhere in the title, description, or keywords.`
        : `4. Background Rule: Only describe a white background if it is visibly solid white; if isolated or transparent, state "isolated on transparent background" or "isolated graphic".`}
      ${settings?.prefix ? `5. Title Prefix context: Start naturally with or accommodate prefix "${settings.prefix}".` : ''}
      ${settings?.suffix ? `6. Title Suffix context: End naturally with or accommodate suffix "${settings.suffix}".` : ''}

      Keyword SEO Rules (Ordered strictly by search weight — strongest 10 keywords FIRST):
      1. Top 10 keywords MUST be the highest-volume exact-match subject, style, and main commercial concept terms.
      2. Remaining keywords MUST blend high-converting buyer-intent phrases, commercial use-cases (branding, web design, poster, banner, marketing, presentation, template), color/mood/lighting descriptors, and format/asset tags (${extUpper.toLowerCase()}, ${assetType.toLowerCase()}).
      ${isTransparent
        ? `3. TRANSPARENT & PNG KEYWORDS REQUIRED: Include high-traffic transparent keywords ("transparent", "transparent background", "png", "isolated", "cutout", "no background", "alpha channel") among the keywords. Exclude any "white background" keywords.`
        : ''}
      4. Exclude weak filler words ("nice", "good", "file", "picture"), duplicates, and prohibited terms: ${settings?.negativeKeywords || 'None'}.

      Output strictly valid JSON with keys: "title", "description", "keywords" (array of ${keywordCount} unique SEO keywords).
    `;
  }

  function sanitizeTransparentAndFormat(result: any, settings: any, assetType: string = 'Photo', fileExtension?: string) {
    const keywordCount = Number(settings?.keywordCount) || 30;
    const isTransparent = Boolean(settings?.transparentBackground);
    const { extUpper } = getFormatLabel(fileExtension, assetType, isTransparent);

    let title = String(result?.title || 'Stock Asset').trim();
    let description = String(result?.description || '').trim();
    let keywords: string[] = Array.isArray(result?.keywords)
      ? result.keywords.map((k: any) => String(k).trim()).filter((k: string) => k.length > 0)
      : [];

    // Strip negative keywords
    const negList = String(settings?.negativeKeywords || '')
      .split(',')
      .map((s: string) => s.trim().toLowerCase())
      .filter(Boolean);

    if (isTransparent) {
      const stripWhiteBg = (txt: string) =>
        txt
          .replace(/\b(?:isolated\s+)?on\s+(?:a\s+|an\s+)?(?:clean\s+|pure\s+|solid\s+)?white\s+background\b/gi, 'on transparent background')
          .replace(/\bisolated\s+on\s+white\b/gi, 'isolated on transparent background')
          .replace(/\b(?:pure\s+|solid\s+)?white\s+background\b/gi, 'transparent background')
          .replace(/\bwhite\s+backdrop\b/gi, 'transparent background')
          .replace(/\s{2,}/g, ' ')
          .replace(/\s+,/g, ',')
          .trim();

      title = stripWhiteBg(title);
      description = stripWhiteBg(description);

      if (!/\btransparent\b/i.test(title)) {
        title = `${title}, Isolated on Transparent Background`;
      }

      // Remove white-background tags from keywords
      keywords = keywords.filter(
        (k) => !/\bwhite\s*(background|backdrop)\b|^on white$|^isolated on white$/i.test(k)
      );

      // Ensure core transparent & PNG base keywords are included
      const requiredTransparentTags = ['transparent', 'transparent background', 'png', 'isolated', 'cutout', 'no background'];
      const existingLower = new Set(keywords.map((k) => k.toLowerCase()));
      const missingTags = requiredTransparentTags.filter((t) => !existingLower.has(t));
      if (missingTags.length > 0) {
        const keepCount = Math.max(0, keywordCount - missingTags.length);
        keywords = [...keywords.slice(0, keepCount), ...missingTags];
      }
    }

    // Ensure uploaded file format / asset type is mentioned in title if omitted
    if (extUpper && extUpper !== 'PHOTO' && extUpper !== 'ILLUSTRATION' && extUpper !== 'VIDEO') {
      const extRegex = new RegExp(`\\b${extUpper}\\b`, 'i');
      if (!extRegex.test(title)) {
        if (extUpper === 'EPS' || extUpper === 'AI' || extUpper === 'SVG') {
          title = /\bvector\b/i.test(title)
            ? title.replace(/\bvector\b/i, `${extUpper} Vector`)
            : `${title} ${extUpper} Vector`;
        } else {
          title = `${title} ${extUpper}`;
        }
      }
    } else if (assetType === 'Vector' && !/\bvector\b/i.test(title)) {
      title = `${title} Vector`;
    }

    // Deduplicate and filter negative keywords
    const seen = new Set<string>();
    keywords = keywords.filter((k) => {
      const lower = k.toLowerCase();
      if (seen.has(lower)) return false;
      if (negList.some((neg) => lower.includes(neg))) return false;
      seen.add(lower);
      return true;
    });

    if (keywordCount > 0 && keywords.length > keywordCount) {
      keywords = keywords.slice(0, keywordCount);
    }

    // Apply title prefix/suffix if specified
    if (settings?.prefix && !title.toLowerCase().startsWith(settings.prefix.trim().toLowerCase())) {
      title = `${settings.prefix.trim()} ${title}`;
    }
    if (settings?.suffix && !title.toLowerCase().endsWith(settings.suffix.trim().toLowerCase())) {
      title = `${title} ${settings.suffix.trim()}`;
    }

    return {
      title,
      description,
      keywords
    };
  }

  // --- FAST AI METADATA GENERATION ENDPOINT ---
  app.post("/api/generate-metadata", async (req, res) => {
    try {
      const { base64Image, settings, apiKey, assetType, fileExtension } = req.body || {};

      const customKey = typeof apiKey === 'string' ? apiKey.trim() : '';
      if (!customKey) {
        return res.status(400).json({ 
          error: "API key required. Please add your Gemini API key in AI Configuration." 
        });
      }

      if (typeof base64Image !== 'string' || !base64Image.trim() || base64Image.startsWith('blob:')) {
        return res.status(400).json({
          error: "Invalid or missing image preview data. Please re-upload the file or attach a JPG/PNG preview."
        });
      }

      let mimeType = 'image/jpeg';
      let data = '';
      if (base64Image.startsWith('data:')) {
        const commaIdx = base64Image.indexOf(',');
        const header = commaIdx >= 0 ? base64Image.slice(0, commaIdx) : base64Image;
        data = commaIdx >= 0 ? base64Image.slice(commaIdx + 1).trim() : '';
        const detected = header.match(/data:([^;]+);/i)?.[1]?.toLowerCase() || 'image/jpeg';
        if (detected === 'image/svg+xml') {
          return res.status(400).json({
            error: "SVG image must be rasterized to PNG/JPEG before AI analysis."
          });
        }
        const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
        mimeType = allowedMimes.has(detected) ? detected : 'image/jpeg';
      } else {
        data = base64Image.trim();
      }

      if (!data || data.length < 16) {
        return res.status(400).json({
          error: "Image payload is empty or corrupted. Please try re-uploading the asset."
        });
      }

      const ai = getAiClient(customKey);
      const prompt = buildSeoPrompt(settings || {}, assetType || 'Photo', fileExtension);
      const keywordCount = Number(settings?.keywordCount) || 30;

      // Always try the user's key with zero persistent lockouts: Hydrogen -> Flash-Lite -> exponential backoff retries
      const attemptSchedule: Array<{ model: string; thinkingLevel?: ThinkingLevel; delayBeforeMs: number; timeoutMs: number }> = [
        { model: "gemini-4-hydrogen", thinkingLevel: ThinkingLevel.LOW, delayBeforeMs: 0, timeoutMs: 8000 },
        { model: "gemini-3.1-flash-lite", delayBeforeMs: 0, timeoutMs: 11000 },
        { model: "gemini-4-hydrogen", thinkingLevel: ThinkingLevel.LOW, delayBeforeMs: 1100, timeoutMs: 11000 },
        { model: "gemini-3.1-flash-lite", delayBeforeMs: 1800, timeoutMs: 12000 },
      ];

      let response: any = null;
      let lastErr: any = null;
      let primaryModelErr: any = null;
      let skipPrimaryForRequest = false;

      for (let idx = 0; idx < attemptSchedule.length; idx++) {
        const baseCfg = attemptSchedule[idx];
        const cfg =
          skipPrimaryForRequest && baseCfg.model === "gemini-4-hydrogen"
            ? { ...baseCfg, model: "gemini-3.1-flash-lite", thinkingLevel: undefined }
            : baseCfg;

        if (idx > 0 && cfg.delayBeforeMs > 0) {
          const jitter = Math.floor(Math.random() * 350);
          await new Promise(resolve => setTimeout(resolve, cfg.delayBeforeMs + jitter));
        }
        try {
          response = await ai.models.generateContent({
            model: cfg.model,
            contents: {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    data,
                    mimeType
                  }
                }
              ]
            },
            config: {
              ...(cfg.thinkingLevel ? { thinkingConfig: { thinkingLevel: cfg.thinkingLevel } } : {}),
              abortSignal: AbortSignal.timeout(cfg.timeoutMs),
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: {
                    type: Type.STRING,
                    description: `High-ranking SEO stock title optimized for downloads.`
                  },
                  description: {
                    type: Type.STRING,
                    description: "A clear semantic description for stock search indexing."
                  },
                  keywords: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: `A flat array of exactly ${keywordCount} keywords ordered by search relevance.`
                  }
                },
                required: ["title", "description", "keywords"]
              }
            }
          });
          if (response?.text) {
            break;
          }
        } catch (e: any) {
          lastErr = e;
          const rawMsg = String(e?.message || e || '');
          const upper = rawMsg.toUpperCase();
          if (
            cfg.model === "gemini-4-hydrogen" &&
            !upper.includes('503') &&
            !upper.includes('UNAVAILABLE') &&
            !upper.includes('ABORT') &&
            !upper.includes('TIMEOUT')
          ) {
            primaryModelErr = e;
          }
          if (
            cfg.model === "gemini-4-hydrogen" &&
            (/GenerateRequestsPerDay|limit:\s*0\b/i.test(rawMsg) || upper.includes('429'))
          ) {
            skipPrimaryForRequest = true;
          }

          if (
            upper.includes('API_KEY_INVALID') ||
            upper.includes('API KEY NOT VALID') ||
            upper.includes('PERMISSION_DENIED') ||
            upper.includes('403') ||
            upper.includes('INVALID_ARGUMENT')
          ) {
            break;
          }
        }
      }

      if (!response || !response.text) {
        throw primaryModelErr || lastErr || new Error("No response returned from Gemini API");
      }

      const parsed = safeParseJsonObject(response.text);
      const result = sanitizeTransparentAndFormat(parsed, settings || {}, assetType || 'Photo', fileExtension);

      res.json(result);
    } catch (err: any) {
      const raw = String(err?.message || '');
      const cleanMsg = extractCleanUpstreamError(err, "AI metadata generation failed");
      const isBusy503 = raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand');
      const isQuota429 = raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED');
      const isAuth403 = raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403');
      const status = isQuota429 || isBusy503 ? 429 : isAuth403 ? 401 : 500;
      if (status === 500) {
        console.warn("Metadata generation error:", cleanMsg);
      }
      res.status(status).json({
        error: cleanMsg,
        upstreamStatus: isQuota429 ? 429 : isBusy503 ? 503 : isAuth403 ? 403 : 500
      });
    }
  });

  // --- STREAMING METADATA GENERATION ENDPOINT (SSE) ---
  app.post("/api/generate-metadata-stream", async (req, res) => {
    try {
      const { base64Image, settings, apiKey, assetType } = req.body || {};

      const customKey = typeof apiKey === 'string' ? apiKey.trim() : '';
      if (!customKey) {
        return res.status(400).json({ 
          error: "API key required. Please add your Gemini API key in AI Configuration." 
        });
      }

      if (typeof base64Image !== 'string' || !base64Image.trim() || base64Image.startsWith('blob:')) {
        return res.status(400).json({
          error: "Invalid or missing image preview data."
        });
      }

      const ai = getAiClient(customKey || undefined);

      const commaIdx = base64Image.indexOf(',');
      const header = commaIdx >= 0 ? base64Image.slice(0, commaIdx) : '';
      const data = commaIdx >= 0 ? base64Image.slice(commaIdx + 1).trim() : base64Image.trim();
      const detected = header?.match(/data:([^;]+);/i)?.[1]?.toLowerCase() || 'image/jpeg';
      const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
      const mimeType = allowedMimes.has(detected) ? detected : 'image/jpeg';

      if (!data || data.length < 16) {
        return res.status(400).json({ error: "Image payload is empty." });
      }

      const prompt = buildSeoPrompt(settings || {}, assetType || 'Photo', req.body?.fileExtension);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const responseStream = await ai.models.generateContentStream({
        model: "gemini-4-hydrogen",
        contents: {
          parts: [
            { text: prompt },
            {
              inlineData: {
                data,
                mimeType
              }
            }
          ]
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json"
        }
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err: any) {
      console.error("Server streaming generation error:", err);
      const cleanMsg = extractCleanUpstreamError(err, "Streaming failed");
      if (!res.headersSent) {
        res.status(500).json({ error: cleanMsg });
      } else {
        res.write(`data: ${JSON.stringify({ error: cleanMsg })}\n\n`);
        res.end();
      }
    }
  });

  // --- GENERAL GEMINI SERVER PROXY ENDPOINTS ---
  app.post("/api/gemini/generate", async (req, res) => {
    try {
      const { prompt, model = "gemini-4-hydrogen", systemInstruction } = req.body;
      const ai = getAiClient();

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: systemInstruction ? { systemInstruction } : undefined
      });

      res.json({ text: response.text });
    } catch (err: any) {
      console.error("Gemini proxy error:", err);
      const cleanMsg = extractCleanUpstreamError(err, "Gemini generation failed");
      const raw = String(err?.message || '');
      const isQuotaOrBusy = raw.includes('429') || raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand');
      const isAuth = raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403');
      const status = isQuotaOrBusy ? 429 : isAuth ? 401 : 500;
      res.status(status).json({ error: cleanMsg });
    }
  });

  app.post("/api/gemini/generate-stream", async (req, res) => {
    try {
      const { prompt, model = "gemini-4-hydrogen", systemInstruction } = req.body;
      const ai = getAiClient();

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const responseStream = await ai.models.generateContentStream({
        model,
        contents: prompt,
        config: systemInstruction ? { systemInstruction } : undefined
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err: any) {
      console.error("Gemini stream proxy error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Gemini streaming failed" });
      } else {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    }
  });

  // --- AI GENERATIVE CODE ARCHITECT & STOCK MARKET ANALYST (/api/bg/think & /api/bg/repair) ---
  const FULL_BG_STYLE_CATALOG = `
1. Technology, Digital & Cyber: "Circuit Board & Microchip Patterns", "Digital Networks & Connected Nodes", "Futuristic Grids & Perspective Horizons", "Data Flows & Particle Streams", "Wireframes & Holographic Layouts", "Cyber Security & Matrix Streams", "AI & Neural Topology"
2. 3D Procedural & Shader Art: "Liquid Chrome & Metallic Surfaces", "3D Spheres, Torus & Geometric Forms", "Frosted Glass & Refraction Effects", "3D Isometric & Architectural Blocks", "Volumetric Lighting & Light Rays", "3D Terrain & Elevation Mesh"
3. Abstract & Geometric Art: "Low-Poly & Polygon Compositions", "Voronoi & Cellular Patterns", "Tessellations & Repeating Geometry", "Moiré Interference & Optical Illusions", "Minimalist Bauhaus & Modern Shapes", "Abstract Ribbons & Layered Swirls"
4. Mathematical & Algorithmic Generative Art: "Fractals & Self-Similar Structures", "Perlin & Simplex Noise Fields", "Domain Warping & Fluid Marble", "Parametric & Harmonic Curves", "Strange Attractors & Chaotic Systems", "Phyllotaxis & Sacred Geometry", "Sine Waves, Soundwaves & Equalizers"
5. Patterns, Textures & Surface Overlays: "Mesh Gradients & Aurora Blends", "Topographic Contour Lines", "Halftone Dots & Print Patterns", "Film Grain, Noise & Paper Texture", "Stripes, Chevrons & Linear Rhythms", "Organic & Botanical-Inspired Patterns"
6. Commercial, Minimal & Editorial Backgrounds: "Minimal Corporate & Presentation Backdrops", "Pastel, Soft & Calm Aesthetic Backgrounds", "Luxury, Dark & Gold Editorial Backgrounds", "Retro, Synthwave & Vintage Backgrounds", "Nature, Sky, Water & Atmospheric Abstracts"
7. Typography, Graphic & Editorial Systems: "Swiss Grid & Editorial Posters", "Minimalist Line Art & Contour Posters", "Halftone Pop & Graphic Halftone"
8. Atmospheric, Light & Optical Phenomena: "Caustics & Water Light Patterns", "Bokeh, Light Orbs & Depth Blur", "Prism, Dispersion & Iridescent Sheen"
9. Abstract Flow, Fluids & Physical Dynamics: "Curl Noise & Smoke/Ink Diffusion", "Reaction-Diffusion & Turing Patterns", "Pendulum, Spirograph & Harmonograph", "Cloth, Wave & Mesh Deformation"
10. Architectural, Structural & Spatial Layouts: "Brutalist Concrete & Monolithic Blocks", "Grid Systems, Blueprints & Technical CAD", "Perspective Tunnels, Portals & Corridors"
`.trim();

  const BG_SYSTEM_INSTRUCTION = `You are a Principal Graphics Shader Engineer (GLSL ES 3.00 + HTML5 Canvas 2D), Generative Art Director, and Top-Selling Adobe Stock Contributor.

MISSION:
- Code renders at 4K (3840x2160) & 8K (7680x4320) for paying stock buyers. Deliver studio-grade Octane/Cycles 3D renders, optical macro light physics, or precision vector craft — NEVER flat unshaded boxes, muddy gray blurs, or tangled lines.
- CUSTOMIZATION MANDATE: NEVER hardcode hex strings ('#...') or fixed RGB vec3(...) colors inside glslCode or canvasCode! Drive ALL colors from u_base, u_primary, u_secondary, u_accent, u_highlight (GLSL) or api.palette.* & api.rgba/api.mix (Canvas) so live color swatches recolor the artwork cleanly. Also bind u_density/density, u_scale/scale, u_rotation/rotationRad, u_warp/warp, u_glow/glow, u_depth/depth, u_lineWeight/lineWeight, u_seed/seed so sliders reshape the scene live.

ENGINE SELECTION (renderMode):
- "glsl": 3D raymarched chrome/gold/metallic spheres, ribbed toruses, frosted glass, brutalist blocks, Voronoi stained crystal, silk domain-warped waves, ridged noise, caustics, optical bokeh, fractals, prism dispersion, aurora meshes.
- "canvas": 45/90-deg PCB circuits with vias/pads, depth-sorted 3D network graphs, curled fiber-optic light trails, isometric monoliths, triangulated low-poly wireframes, Moire curves, Fibonacci spirals, Swiss grids, CAD plans.
- "hybrid": glslCode renders atmospheric lighting/backdrop FIRST, canvasCode overlays sharp vectors cleanly (NEVER call fillBackground/meshBackdrop in "hybrid").

GLSL ES 3.00 CONTRACT (renderMode "glsl" or "hybrid"):
Write ONLY helpers + vec4 renderBackground(vec2 uv, vec2 p, float aspect) { ... }. NO #version, precision, out, or uniform lines. NEVER use u_time (use u_seed/u_rotation). Strict float literals everywhere (0.0, 1.0, not 1) & constant-bound loops (N<=56 raymarch, N<=24 layers).
Pre-declared stdlib:
- Uniforms: u_seed, u_density (0.05..1), u_scale (0.35..2.5), u_rotation (rad), u_offset, u_warp (0..1.5), u_grain, u_lineWeight (0.4..2.2), u_glow (0..1), u_depth (0..1), u_transparent, u_isLight, u_base, u_primary, u_secondary, u_accent, u_highlight
- Math/Noise: PI, TAU, rot2(a), hash11, hash21, hash22, vnoise(p2|p3), fbm(p2|p3), ridgedFbm(p2|p3), domainWarp(p, amt), curl2(p), voronoi(p)->vec3(d,edge,id), hexGrid(p)->vec4(gv,edge,id), causticsField(p,phase), pal(t,a,b,c,d)
- SDF/Optics: smin, smax, sdSphere, sdBox, sdRoundBox, sdTorus, sdCylinder, sdCapsule, sdOctahedron, sdHexPrism, lineSeg, aaFill(d), aaStroke(d,w), glowCurve(d,w,int), bokehDisc(p,c,r,f)
- Studio 3D Pipeline:
  * cameraRay(p, fov), fresnelSchlick(ndv, F0), iridescence(ndv, phase)
  * studioEnv(refl, low, high, key, rim, gloss), studioBackdrop(p, focal, u_base, u_primary, u_accent, u_glow), studioTone(col), aces(col)
  * CALC_NORMAL(mapFn, pos) & CALC_AO(mapFn, pos, nor) — requires float mapFn(vec3 q) returning float!
  * shadeStudio3D(rd, n, ao, surfCol, metalness, roughness, rimTint) -> complete Octane PBR + 3-point softbox reflection + rim + studioTone!
  * IMPORTANT: shadeStudio3D() & studioTone() ALREADY return display-ready sRGB color — NEVER apply pow(col, vec3(0.4545)) on top of them!
3D RAYMARCH IDIOM (use this exact studio pipeline for 3D concepts):
float map(vec3 q) { /* SDF union/smin of spheres/torus/boxes */ }
vec4 renderBackground(vec2 uv, vec2 p, float aspect) {
  vec3 ro = vec3(0.0, 0.0, 3.2 / max(u_scale, 0.4));
  vec3 rd = cameraRay(p, 1.65);
  float t = 0.0;
  for (int i = 0; i < 52; i++) { float d = map(ro + rd * t); if (d < 0.0015 || t > 9.0) break; t += d; }
  vec3 col = studioBackdrop(p, vec2(0.0), u_base, u_primary, u_accent, u_glow);
  if (t < 9.0) {
    vec3 pos = ro + rd * t;
    vec3 n = CALC_NORMAL(map, pos);
    float ao = CALC_AO(map, pos, n);
    col = shadeStudio3D(rd, n, ao, mix(u_primary, u_secondary, 0.5 + 0.5 * n.y), 0.88, 0.14, u_accent);
  }
  return vec4(col, 1.0);
}

CANVAS 2D CONTRACT (renderMode "canvas" or "hybrid"):
Write ONLY the inner JavaScript statements! NEVER wrap in \`(ctx, w, h, api) => { ... }\` or \`function(...) { ... }\`. Scale sizes via api.ps(...), coordinates via api.px/py or api.cx/cy, total draw ops <= 1800, NO DOM/getImageData.
- Backdrop: Call api.meshBackdrop(3) or api.fillBackground(1) in "canvas" mode (auto-respects api.transparent) — NEVER raw ctx.fillRect(0,0,w,h)! Never call backdrop helpers in "hybrid".
- Helpers on api: w, h, cx, cy, minDim, maxDim, s, px(nx), py(ny), ps(val), seed, rng(), range(a,b), density, scale, rotationDeg, rotationRad, warp, grain, lineWeight, glow, depth, transparent, palette { base, primary, secondary, accent, highlight, isLight }, rgba(hex,a), mix(h1,h2,t,a), hsl, clamp, lerp, noise, fbm, curl, ambientOrb(x,y,r,hex,a), isoBox(x,y,size,hr,top,left,right,edge), project3D(x,y,z,fov,dist), line, circle, polygon, withTransform.
- IMPORTANT: api.glowStroke(drawPathFn, hex, widthPx, glowBoost) calls ctx.beginPath() and ctx.stroke() automatically around drawPathFn! Do NOT call ctx.beginPath() or ctx.stroke() inside drawPathFn, and batch segments into 2-4 glowStroke calls per color tier.

SUPPORTS TRANSPARENCY: Set supportsTransparency=false for full-frame 3D scenes, Voronoi/low-poly, gradients, or architecture; true ONLY when empty pixels naturally have alpha=0.

REFERENCE IMAGE TRANSLATION:
When a reference image is attached, populate visualAnalysis FIRST with: exact visual family, surface finish & lighting, dark/light background polarity (if bright white/pastel background, keep paletteBase bright white/pastel!), focal layout, and 5 extracted hex colors (paletteBase -> paletteHighlight). Then choose the best renderMode and write bespoke math delivering that exact aesthetic genre, finish, and palette!

CODE DISCIPLINE: 22-60 crisp lines (< 3,500 chars), zero blank-line padding or long spaces.

CATALOG:
${FULL_BG_STYLE_CATALOG}`;

  function buildBgThinkUserPrompt(payload: {
    category: string;
    styleName?: string;
    prompt?: string;
    colorStyle: string;
    complexity: string;
    aspectLabel: string;
    count: number;
    recentConcepts?: string[];
    hasReferenceImage?: boolean;
    previousBlueprint?: any;
    refineInstruction?: string;
  }): string {
    const {
      category,
      styleName,
      prompt,
      colorStyle,
      complexity,
      aspectLabel,
      count,
      recentConcepts,
      hasReferenceImage,
      previousBlueprint,
      refineInstruction,
    } = payload;
    const isAutoCategory = !category || category.startsWith('Auto');
    const isAiFreeInvention = !styleName || styleName === 'ai-invention';

    if (previousBlueprint && refineInstruction?.trim()) {
      return `REFINE EXISTING CODE (${count} variation): "${refineInstruction.trim()}"
Color Direction: ${colorStyle} | Complexity: ${complexity} | Aspect: ${aspectLabel}
${hasReferenceImage ? 'Reference image attached for visual aesthetic guidance.' : ''}
Active Blueprint: ${previousBlueprint.conceptTitle || 'Active'} (${previousBlueprint.resolvedCategory || category}, ${previousBlueprint.renderMode || 'glsl'})
${previousBlueprint.glslCode ? `Current glslCode:\n${previousBlueprint.glslCode}\n` : ''}${previousBlueprint.canvasCode ? `Current canvasCode:\n${previousBlueprint.canvasCode}\n` : ''}
Apply refinement cleanly, keep all colors bound to palette uniforms/api.palette, and return valid JSON.`;
    }

    return `Generate ${count} commercial stock-grade procedural background blueprint(s).
${hasReferenceImage ? 'REFERENCE IMAGE ATTACHED: Dissect the image in visualAnalysis first (exact visual genre, 3D vs optical vs vector geometry, material & studio lighting, negative space, exact 5 hex colors). Then write procedural GLSL/Canvas code delivering a fresh commercial variation in that EXACT visual style and finish!' : ''}
- Category: ${isAutoCategory ? 'Choose the highest-demand commercial category from catalog' : category}
- Style Target: ${isAiFreeInvention ? 'AI Free Invention — craft an iconic studio composition' : `"${styleName}"`}
- Intent: ${prompt?.trim() ? `"${prompt.trim()}"` : 'Agency/Adobe Stock flagship visual depth & appeal'}
- Color Direction: ${hasReferenceImage && colorStyle === 'Random / AI-Curated' ? 'Extract the exact 5 tonal hex colors from the Reference Image' : `${colorStyle} (5 high-contrast #RRGGBB colors)`}
- Complexity: ${complexity} | Aspect: ${aspectLabel}
${recentConcepts && recentConcepts.length > 0 ? `- Avoid repeating: ${recentConcepts.slice(-10).join(' | ')}` : ''}`;
  }

  function extractCleanUpstreamError(err: any, fallbackMsg: string): string {
    let raw = String(err?.message || fallbackMsg || '').trim();
    if (raw.startsWith('{') || raw.includes('"error"')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.error?.message) raw = String(parsed.error.message);
        else if (parsed?.message) raw = String(parsed.message);
      } catch {
        const match = raw.match(/"message"\s*:\s*"([^"]+)"/);
        if (match?.[1]) raw = match[1];
      }
    }
    if (raw.includes('high demand') || raw.includes('UNAVAILABLE') || raw.includes('503')) {
      return 'Gemini AI servers are temporarily busy (503). Please try again in a moment.';
    }
    if (raw.includes('API_KEY_INVALID') || raw.includes('API key not valid')) {
      return 'Gemini API key is invalid or unauthorized. Please check your key in AI Configuration.';
    }
    if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED') || raw.includes('quota')) {
      const retryMatch = raw.match(/retry\s+in\s+([\d.]+)s/i);
      const retryHint = retryMatch ? ` (retry in ${Math.ceil(Number(retryMatch[1]))}s)` : '';
      return `Google Gemini API rate limit reached on your API key${retryHint}. Please wait a moment or add an additional key in AI Configuration.`;
    }
    if (
      raw.includes('Unterminated string') ||
      raw.includes('Unexpected end of JSON') ||
      raw.includes('did not contain valid JSON')
    ) {
      return 'AI response was truncated during generation. Please click AI Think & Generate to retry.';
    }
    if (raw.includes('TimeoutError') || raw.includes('aborted due to timeout') || raw.includes('operation was aborted')) {
      return 'AI request timed out under server load. Please retry in a moment.';
    }
    return raw || fallbackMsg;
  }

  const BG_BLUEPRINT_ITEM_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      visualAnalysis: {
        type: Type.STRING,
        description: "Pre-code plan: exact visual genre, material/lighting, depth layers, negative space, and palette breakdown (or exact analysis of attached Reference Image).",
      },
      conceptTitle: { type: Type.STRING, description: "2-5 word original concept title" },
      marketDemandInsight: { type: Type.STRING, description: "One crisp sentence on buyer demand and commercial use-case" },
      creativeRationale: { type: Type.STRING, description: "One crisp sentence on algorithm, lighting, and visual finish" },
      resolvedCategory: { type: Type.STRING, description: "Exact category name from the 10-domain catalog" },
      styleName: { type: Type.STRING, description: "Specific style name chosen or invented" },
      renderMode: { type: Type.STRING, description: "One of: glsl, canvas, hybrid" },
      supportsTransparency: { type: Type.BOOLEAN, description: "True only when empty pixels naturally have alpha 0" },
      negativeSpaceZone: { type: Type.STRING, description: "One of: left, right, top, bottom, center-halo, corners" },
      focalX: { type: Type.NUMBER, description: "Normalized focal X 0.2..0.8" },
      focalY: { type: Type.NUMBER, description: "Normalized focal Y 0.2..0.8" },
      lightAngleDeg: { type: Type.NUMBER, description: "Rotation / light angle 0..360" },
      geometryScale: { type: Type.NUMBER, description: "Scale multiplier 0.7..1.4" },
      densityFactor: { type: Type.NUMBER, description: "Density 0.25..0.95" },
      glowFactor: { type: Type.NUMBER, description: "Glow/lighting factor 0.2..0.9" },
      depthFactor: { type: Type.NUMBER, description: "Depth factor 0.3..0.95" },
      paletteBase: { type: Type.STRING, description: "Background hex #RRGGBB" },
      palettePrimary: { type: Type.STRING, description: "Primary tonal hex #RRGGBB" },
      paletteSecondary: { type: Type.STRING, description: "Secondary tonal hex #RRGGBB" },
      paletteAccent: { type: Type.STRING, description: "Accent hex #RRGGBB" },
      paletteHighlight: { type: Type.STRING, description: "Highlight hex #RRGGBB" },
      glslCode: { type: Type.STRING, description: "Valid GLSL ES 3.00 code (22-60 lines, <3500 chars) defining vec4 renderBackground(vec2 uv, vec2 p, float aspect) using u_base..u_highlight (no hardcoded colors). Empty string if renderMode is canvas." },
      canvasCode: { type: Type.STRING, description: "Valid inner JS Canvas 2D body statements ONLY (NO function wrapper, 22-60 lines, <3500 chars) using api.palette.* (no hardcoded hex strings). Empty string if renderMode is glsl." },
    },
    propertyOrdering: [
      "visualAnalysis",
      "conceptTitle",
      "marketDemandInsight",
      "creativeRationale",
      "resolvedCategory",
      "styleName",
      "renderMode",
      "supportsTransparency",
      "negativeSpaceZone",
      "focalX",
      "focalY",
      "lightAngleDeg",
      "geometryScale",
      "densityFactor",
      "glowFactor",
      "depthFactor",
      "paletteBase",
      "palettePrimary",
      "paletteSecondary",
      "paletteAccent",
      "paletteHighlight",
      "glslCode",
      "canvasCode",
    ],
    required: [
      "visualAnalysis",
      "conceptTitle",
      "marketDemandInsight",
      "creativeRationale",
      "resolvedCategory",
      "styleName",
      "renderMode",
      "supportsTransparency",
      "negativeSpaceZone",
      "focalX",
      "focalY",
      "lightAngleDeg",
      "geometryScale",
      "densityFactor",
      "glowFactor",
      "depthFactor",
      "paletteBase",
      "palettePrimary",
      "paletteSecondary",
      "paletteAccent",
      "paletteHighlight",
      "glslCode",
      "canvasCode",
    ],
  };

  function unwrapCanvasBodyServer(rawCode: string): string {
    let code = rawCode.trim().replace(/^```(?:javascript|js)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const wrapperMatch = code.match(
      /^(?:(?:export\s+default|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=)\s*)?(?:async\s+)?(?:function(?:\s+\w+)?\s*\([^)]*\)|(?:\([^)]*\)|ctx)\s*=>)\s*\{([\s\S]*)\}\s*;?\s*$/
    );
    if (wrapperMatch && typeof wrapperMatch[1] === 'string') {
      code = wrapperMatch[1].trim();
    }
    // Auto-close small unclosed trailing brace deficit from compact JSON generation
    if (validateCanvasCodeSyntax(code)) {
      let depth = 0;
      for (let i = 0; i < code.length; i++) {
        if (code[i] === "{") depth++;
        else if (code[i] === "}") depth--;
      }
      if (depth > 0 && depth <= 3) {
        const candidate = `${code}\n${"}".repeat(depth)}`;
        if (!validateCanvasCodeSyntax(candidate)) {
          code = candidate;
        }
      }
    }
    return code;
  }

  function validateCanvasCodeSyntax(code: unknown): string | null {
    if (typeof code !== "string" || !code.trim()) return "Empty canvasCode";
    try {
      new Function("ctx", "w", "h", "api", `"use strict";\n${code}`);
      return null;
    } catch (err: any) {
      return err?.message || "Invalid JS syntax";
    }
  }

  function validateGlslBasicStructure(code: unknown): string | null {
    if (typeof code !== "string" || !code.trim()) return "Empty glslCode";
    if (!/vec4\s+renderBackground\s*\(/.test(code)) {
      return "Missing vec4 renderBackground(vec2 uv, vec2 p, float aspect)";
    }
    let depth = 0;
    for (let i = 0; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") depth--;
      if (depth < 0) return "Unbalanced closing brace '}' in GLSL";
    }
    if (depth !== 0) return "Unclosed brace '{' in GLSL";
    return null;
  }

  app.post("/api/bg/think", async (req, res) => {
    try {
      const {
        category,
        styleName,
        prompt,
        colorStyle,
        complexity,
        aspectLabel,
        count = 1,
        recentConcepts = [],
        referenceImage,
        previousBlueprint,
        refineInstruction,
        apiKey,
      } = req.body || {};
      const customKey = typeof apiKey === "string" ? apiKey.trim() : "";

      if (!customKey) {
        return res.status(400).json({
          error: "API key required. Please add your Gemini API key in AI Configuration.",
        });
      }

      const safeCount = Math.max(1, Math.min(4, Number(count) || 1));
      const ai = getAiClient(customKey);
      const validRefImage =
        referenceImage &&
        typeof referenceImage.data === "string" &&
        referenceImage.data.trim().length > 32;

      const userPrompt = buildBgThinkUserPrompt({
        category: category || "Auto / Market Trend (AI Choice)",
        styleName: styleName || "ai-invention",
        prompt,
        colorStyle: colorStyle || "Random / AI-Curated",
        complexity: complexity || "Balanced",
        aspectLabel: aspectLabel || "16:9",
        count: safeCount,
        recentConcepts: Array.isArray(recentConcepts) ? recentConcepts : [],
        hasReferenceImage: Boolean(validRefImage),
        previousBlueprint,
        refineInstruction,
      });

      const contentsPayload: any = validRefImage
        ? {
            parts: [
              {
                inlineData: {
                  mimeType: String(referenceImage.mimeType || "image/jpeg"),
                  data: String(referenceImage.data),
                },
              },
              { text: userPrompt },
            ],
          }
        : userPrompt;

      // Primary: Gemini 4 Hydrogen (LOW thinking, 16s single / 26s batch cap)
      // Fallback: Gemini 3.1 Flash-Lite with instant switch (zero persistent key lockouts)
      const candidateConfigs: Array<{ model: string; thinkingConfig?: any; timeoutMs: number }> = [
        {
          model: "gemini-4-hydrogen",
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          timeoutMs: safeCount > 1 ? 26000 : 16000,
        },
        {
          model: "gemini-3.1-flash-lite",
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          timeoutMs: safeCount > 1 ? 28000 : 22000,
        },
      ];

      let blueprints: any[] = [];
      let lastErr: any = null;
      const maxTokens = safeCount === 1 ? 4608 : 10240;

      for (const cfg of candidateConfigs) {
        try {
          const response = await ai.models.generateContent({
            model: cfg.model,
            contents: contentsPayload,
            config: {
              systemInstruction: BG_SYSTEM_INSTRUCTION,
              ...(cfg.thinkingConfig ? { thinkingConfig: cfg.thinkingConfig } : {}),
              maxOutputTokens: maxTokens,
              abortSignal: AbortSignal.timeout(cfg.timeoutMs),
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  blueprints: {
                    type: Type.ARRAY,
                    items: BG_BLUEPRINT_ITEM_SCHEMA,
                  },
                },
                required: ["blueprints"],
              },
            },
          });

          const rawText = response?.text || "";
          if (!rawText) {
            throw new Error(`Model ${cfg.model} returned an empty response.`);
          }
          if (/[ \t]{45,}|\n{12,}/.test(rawText)) {
            throw new Error(`Model ${cfg.model} entered a whitespace repetition loop.`);
          }

          const parsed = safeParseJsonObject(rawText);
          const list = Array.isArray(parsed?.blueprints) ? parsed.blueprints : [];
          if (list.length === 0) {
            throw new Error(`Model ${cfg.model} returned an empty blueprint list.`);
          }
          blueprints = list;
          break;
        } catch (err: any) {
          lastErr = err;
          const msg = String(err?.message || err || "").toUpperCase();
          if (msg.includes("API_KEY") || msg.includes("PERMISSION_DENIED") || msg.includes("403")) {
            break;
          }
        }
      }

      if (blueprints.length === 0) {
        throw lastErr || new Error("Gemini Creative Director did not return a valid blueprint.");
      }

      // Normalize modes, unwrap Canvas wrappers, and perform instant syntax/structure repair when needed
      for (const bp of blueprints) {
        if (bp.renderMode !== "glsl" && bp.renderMode !== "canvas" && bp.renderMode !== "hybrid") {
          bp.renderMode = bp.glslCode?.trim() ? "glsl" : "canvas";
        }
        if (bp.renderMode === "glsl") bp.canvasCode = "";
        if (bp.renderMode === "canvas") bp.glslCode = "";

        if ((bp.renderMode === "canvas" || bp.renderMode === "hybrid") && bp.canvasCode) {
          bp.canvasCode = unwrapCanvasBodyServer(bp.canvasCode);
          const syntaxErr = validateCanvasCodeSyntax(bp.canvasCode);
          if (syntaxErr) {
            try {
              const repairRes = await ai.models.generateContent({
                model: "gemini-4-hydrogen",
                contents: `Fix ONLY the JavaScript syntax error in this Canvas 2D body statements receiving (ctx, w, h, api) (NO wrapper function). Keep palette references (api.palette.*) intact. Error: ${syntaxErr}\n\nCode:\n${bp.canvasCode}`,
                config: {
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                  abortSignal: AbortSignal.timeout(10000),
                  responseMimeType: "application/json",
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: { canvasCode: { type: Type.STRING } },
                    required: ["canvasCode"],
                  },
                },
              });
              const repaired = safeParseJsonObject(repairRes.text || "");
              const cleanRepaired = repaired?.canvasCode ? unwrapCanvasBodyServer(repaired.canvasCode) : "";
              if (cleanRepaired && !validateCanvasCodeSyntax(cleanRepaired)) {
                bp.canvasCode = cleanRepaired;
              }
            } catch {
              // Client runtime executes safely and triggers /api/bg/repair if needed
            }
          }
        }

        if ((bp.renderMode === "glsl" || bp.renderMode === "hybrid") && bp.glslCode) {
          const glslStructErr = validateGlslBasicStructure(bp.glslCode);
          if (glslStructErr) {
            try {
              const repairRes = await ai.models.generateContent({
                model: "gemini-4-hydrogen",
                contents: `Fix ONLY the GLSL ES 3.00 structural error (${glslStructErr}) defining vec4 renderBackground(vec2 uv, vec2 p, float aspect). No #version/uniform headers. Keep shadeStudio3D/palette uniforms intact:\n${bp.glslCode}`,
                config: {
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                  abortSignal: AbortSignal.timeout(10000),
                  responseMimeType: "application/json",
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: { glslCode: { type: Type.STRING } },
                    required: ["glslCode"],
                  },
                },
              });
              const repaired = safeParseJsonObject(repairRes.text || "");
              if (repaired?.glslCode && !validateGlslBasicStructure(repaired.glslCode)) {
                bp.glslCode = repaired.glslCode;
              }
            } catch {
              // WebGL2 compiler + /api/bg/repair handles exact compiler diagnostics
            }
          }
        }
      }

      res.json({ blueprints });
    } catch (err: any) {
      console.error("AI Creative Director error:", err);
      const cleanMsg = extractCleanUpstreamError(err, "Failed to generate creative direction.");
      const raw = String(err?.message || "");
      const isQuotaOrBusy = raw.includes("429") || raw.includes("503") || raw.includes("UNAVAILABLE") || raw.includes("high demand");
      const isAuth = raw.includes("API_KEY_INVALID") || raw.includes("PERMISSION_DENIED") || raw.includes("403");
      const status = isQuotaOrBusy ? 429 : isAuth ? 401 : 500;
      res.status(status).json({ error: cleanMsg });
    }
  });

  app.post("/api/bg/repair", async (req, res) => {
    try {
      const { glslCode, canvasCode, errorLog, conceptTitle, apiKey } = req.body || {};
      const customKey = typeof apiKey === "string" ? apiKey.trim() : "";
      if (!customKey) {
        return res.status(400).json({ error: "API key required. Please add your Gemini API key in AI Configuration." });
      }
      const ai = getAiClient(customKey);

      if (glslCode) {
        const repairPrompt = `Fix the WebGL2 GLSL ES 3.00 error in this fragment shader helper defining vec4 renderBackground(vec2 uv, vec2 p, float aspect).
DO NOT include #version, precision, out vec4, or uniform declarations.
Pre-declared stdlib: u_res, u_seed, u_density, u_scale, u_rotation, u_offset, u_warp, u_grain, u_lineWeight, u_glow, u_depth, u_transparent, u_isLight, u_base, u_primary, u_secondary, u_accent, u_highlight, hash11, hash21, hash22, vnoise, fbm, ridgedFbm, domainWarp, curl2, voronoi, hexGrid, causticsField, smin, smax, rot2, pal, sdSphere, sdBox, sdRoundBox, sdTorus, sdCylinder, sdCapsule, sdOctahedron, sdHexPrism, lineSeg, aaFill, aaStroke, glowCurve, bokehDisc, fresnelSchlick, iridescence, cameraRay, studioEnv, studioBackdrop, aces, studioTone, shadeStudio3D, CALC_NORMAL, CALC_AO, PI, TAU.
Remember strict GLSL ES 3.00 float literals (1.0 not 1), constant loop bounds, and float map(vec3 q) for CALC_NORMAL/CALC_AO.
Concept: ${conceptTitle || "Abstract Background"}
Compiler Error:
${errorLog}

Broken GLSL:
${glslCode}`;

        let parsed: any = null;
        for (const repairCfg of [
          { model: "gemini-4-hydrogen", thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
          { model: "gemini-3.1-flash-lite", thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
        ]) {
          try {
            const r = await ai.models.generateContent({
              model: repairCfg.model,
              contents: repairPrompt,
              config: {
                thinkingConfig: repairCfg.thinkingConfig,
                abortSignal: AbortSignal.timeout(12000),
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: { glslCode: { type: Type.STRING } },
                  required: ["glslCode"],
                },
              },
            });
            const p = safeParseJsonObject(r.text || "");
            if (p?.glslCode) {
              parsed = p;
              break;
            }
          } catch {
            // Try next fallback model
          }
        }
        if (!parsed?.glslCode) throw new Error("Failed to repair GLSL shader.");
        return res.json({ glslCode: parsed.glslCode });
      }

      if (canvasCode) {
        const repairPrompt = `Fix the JavaScript runtime/syntax error in this Canvas 2D body receiving (ctx, w, h, api). Keep all visual layers & api.palette bindings intact.
Error: ${errorLog}
Broken Code:
${canvasCode}`;
        const r = await ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: repairPrompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            abortSignal: AbortSignal.timeout(12000),
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: { canvasCode: { type: Type.STRING } },
              required: ["canvasCode"],
            },
          },
        });
        const parsed = safeParseJsonObject(r.text || "");
        if (!parsed?.canvasCode) throw new Error("Failed to repair Canvas code.");
        return res.json({ canvasCode: parsed.canvasCode });
      }

      res.status(400).json({ error: "No glslCode or canvasCode provided for repair." });
    } catch (err: any) {
      res.status(500).json({ error: extractCleanUpstreamError(err, "Repair failed") });
    }
  });


  // Never allow unmatched /api/* routes to fall through to Vite/static index.html
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Always return JSON for Express errors on /api/* (e.g. body-parser PayloadTooLargeError or SyntaxError)
  app.use("/api", (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    const rawStatus = Number(err?.status || err?.statusCode) || 500;
    const status = [403, 502, 503, 504].includes(rawStatus) ? 500 : rawStatus;
    const message =
      err?.type === "entity.too.large"
        ? "Uploaded image payload is too large for processing. Please try a smaller preview image."
        : err?.message || "Unexpected server API error.";
    res.status(status).json({ error: message });
  });

  // --- VITE DEV OR PROD MIDDLEWARE ---

  if (process.env.NODE_ENV !== "production") {
    const viteReadyPromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : { server: httpServer },
      },
      appType: "spa",
    });

    app.use(async (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        return res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
      }
      try {
        const vite = await viteReadyPromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api/")) {
        return res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
