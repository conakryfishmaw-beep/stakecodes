import { Router } from "express";
import { sendPromoCode, type CodePayload } from "../lib/telegram";

const webhookRouter = Router();

webhookRouter.post("/webhook/code", async (req, res) => {
  const { code, type, shortName, value, requirement, claimLimit } = req.body as CodePayload;

  if (!code || typeof code !== "string" || code.trim() === "") {
    res.status(400).json({ error: "code field is required" });
    return;
  }

  try {
    await sendPromoCode({
      code: code.trim(),
      type,
      shortName,
      value,
      requirement,
      claimLimit,
    });
    res.json({ ok: true, code: code.trim() });
  } catch {
    res.status(500).json({ error: "Failed to send to Telegram" });
  }
});

export default webhookRouter;
