import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import crypto from "crypto";

dotenv.config();

const DB_PATH = path.join(process.cwd(), "database.json");

// Helper to hash passwords securely
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
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
}

let database: DbSchema = { users: [], assets: [] };

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

  // Pre-seed the requested admin account if it doesn't exist yet
  const adminEmail = "msany6117@gmail.com";
  const adminExists = database.users.some(u => u.email.toLowerCase() === adminEmail);
  if (!adminExists) {
    database.users.push({
      uid: "admin_msany6117",
      email: adminEmail,
      passwordHash: hashPassword("Admin@124390"),
      role: "admin",
      savedSettings: null,
      createdAt: new Date().toISOString()
    });
    saveDb();
    console.log("Pre-seeded master admin user successfully!");
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
  const PORT = 3000;

  // Middleware for parsing JSON with a larger limit for images/vector files
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

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

      // Automatically promote msany6117@gmail.com to admin
      const role = normalizedEmail === "msany6117@gmail.com" ? "admin" : "user";
      const uid = "u_" + Math.random().toString(36).substring(2, 15);

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

      // Return user without password hash
      const { passwordHash, ...userResponse } = newUser;
      res.status(201).json({ user: userResponse });
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

      const hashedInput = hashPassword(password);
      if (user.passwordHash !== hashedInput) {
        return res.status(401).json({ error: "Incorrect password." });
      }

      const { passwordHash, ...userResponse } = user;
      res.json({ user: userResponse });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Login failed." });
    }
  });

  // Update Settings Endpoint
  app.post("/api/users/update", (req, res) => {
    try {
      const { uid, email, savedSettings } = req.body;
      if (!uid) {
        return res.status(400).json({ error: "User ID is required." });
      }

      const userIndex = database.users.findIndex(u => u.uid === uid);
      if (userIndex === -1) {
        // If they don't exist (e.g. guest or newly synced session), create them
        const role = email?.toLowerCase().trim() === "msany6117@gmail.com" ? "admin" : "user";
        database.users.push({
          uid,
          email: email || "anonymous@lenslogic.ai",
          passwordHash: "",
          role: role as "user" | "admin",
          savedSettings: savedSettings || null,
          createdAt: new Date().toISOString()
        });
      } else {
        database.users[userIndex].savedSettings = savedSettings;
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
  app.get("/api/assets", (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required." });
      }

      const userAssets = database.assets.filter(a => a.userId === userId);
      res.json(userAssets);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load assets." });
    }
  });

  // Save/Update Asset
  app.post("/api/assets", (req, res) => {
    try {
      const { id, userId, name, type, preview, title, description, keywords, status, errorMsg, createdAt } = req.body;
      if (!id || !userId) {
        return res.status(400).json({ error: "Asset ID and User ID are required." });
      }

      const assetIndex = database.assets.findIndex(a => a.id === id);
      const assetData = {
        id,
        userId,
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
  app.delete("/api/assets/:id", (req, res) => {
    try {
      const { id } = req.params;
      const initialLength = database.assets.length;
      database.assets = database.assets.filter(a => a.id !== id);

      if (database.assets.length !== initialLength) {
        saveDb();
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Asset not found." });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete asset." });
    }
  });

  // Clear All Assets for a User
  app.post("/api/assets/clear", (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required." });
      }

      database.assets = database.assets.filter(a => a.userId !== userId);
      saveDb();
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to clear assets." });
    }
  });

  // --- ADMIN PANEL METRICS ---

  app.get("/api/admin/users", (req, res) => {
    try {
      // Map out sensitive info like passwords
      const safeUsers = database.users.map(({ passwordHash, ...u }) => u);
      res.json(safeUsers);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch admin users." });
    }
  });

  app.get("/api/admin/assets", (req, res) => {
    try {
      res.json(database.assets);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch admin assets." });
    }
  });


  // --- VITE DEV OR PROD MIDDLEWARE ---

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
