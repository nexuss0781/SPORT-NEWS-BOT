import { createBot } from "../src/index";

const bot = createBot();

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    res.status(200).json({ status: "ok", message: "Bot is running" });
    return;
  }

  if (req.method === "POST") {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error("Error handling update:", error);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
    return;
  }

  res.status(405).json({ ok: false, error: "Method not allowed" });
}
