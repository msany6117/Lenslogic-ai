import crypto from "crypto";
import { applyCors } from "../_geminiShared.js";

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const requestedUid =
    typeof req.body?.uid === "string" && /^guest_[a-z0-9_-]{4,32}$/i.test(req.body.uid)
      ? req.body.uid
      : `guest_${crypto.randomBytes(5).toString("hex")}`;

  const user = {
    uid: requestedUid,
    email: "guest@lenslogic.ai",
    role: "user",
    savedSettings: null,
    createdAt: new Date().toISOString(),
  };

  return res.status(200).json({ user, token: "" });
}
