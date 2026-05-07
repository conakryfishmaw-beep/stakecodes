import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger";

const token = process.env["TELEGRAM_BOT_TOKEN"];
const chatId = process.env["TELEGRAM_CHAT_ID"];

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
}

if (!chatId) {
  throw new Error("TELEGRAM_CHAT_ID environment variable is required");
}

const bot = new TelegramBot(token);

export interface CodePayload {
  code: string;
  type?: string;
  shortName?: string;
  value?: string;
  requirement?: string;
  claimLimit?: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendPromoCode(payload: CodePayload): Promise<void> {
  const { code, type, shortName, value, requirement, claimLimit } = payload;

  const header = type
    ? `🎁 <b>${escapeHtml(type)}</b> 🎁`
    : `🎁 <b>Stake Promo Kodu</b> 🎁`;

  const lines: string[] = [header, ""];
  lines.push(`Code: <code>${escapeHtml(code)}</code>`);
  if (value) lines.push(`Value: ${escapeHtml(value)}`);
  if (requirement) lines.push(`Requirement: ${escapeHtml(requirement)}`);
  if (claimLimit) lines.push(`Claim limit: ${escapeHtml(claimLimit)}`);

  const message = lines.join("\n");
  const claimUrl = `https://playstake.club/drop?code=${encodeURIComponent(code)}`;

  try {
    await bot.sendMessage(chatId!, message, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔗 Code Link", url: claimUrl }],
        ],
      },
    });
    logger.info({ code, chatId }, "Promo code sent to Telegram");
  } catch (err) {
    logger.error({ err, code }, "Failed to send promo code to Telegram");
    throw err;
  }
}
