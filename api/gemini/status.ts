import { applyCors } from "../_geminiShared.js";

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  return res.status(200).json({
    configured: Boolean(process.env.GEMINI_API_KEY),
    model: "gemini-4-hydrogen",
  });
}
