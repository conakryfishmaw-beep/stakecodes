import { WebSocket } from "ws";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { logger } from "./logger";
import { sendPromoCode } from "./telegram";

const WS_URL = "wss://ws.lazybot.io/ws";
const RECONNECT_DELAY_BASE = 3000;
const RECONNECT_DELAY_MAX = 60000;
const HEARTBEAT_INTERVAL = 30000;
const SENT_CODES_PATH = "/data/sent-codes.json";

const IDENTIFY_PAYLOAD = JSON.stringify({
  type: "identify",
  data: {
    name: "YagmurGetiren",
    fingerprint: "1150c1261c6c22977d779b3ebcb8a5c08d814793be9642b1d667277166bffce6",
    buildTimestamp: 1762923607216,
    _v: "d77dea5a764d064ba4c8dde8a7b776891808e467b2b0ae982683f4e577e8dbe2",
  },
  _h: "ba83966a591a35b3a43ea0b65af7c44deb5db03a9843a19f46e83651511391e6",
});

let reconnectAttempts = 0;
let stopped = false;

function loadSentCodes(): Set<string> {
  try {
    if (existsSync(SENT_CODES_PATH)) {
      const raw = readFileSync(SENT_CODES_PATH, "utf-8");
      const arr = JSON.parse(raw) as string[];
      logger.info({ count: arr.length }, "Loaded sent codes from disk");
      return new Set(arr);
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load sent codes from disk — starting fresh");
  }
  return new Set();
}

function saveSentCodes(codes: Set<string>): void {
  try {
    mkdirSync("/data", { recursive: true });
    writeFileSync(SENT_CODES_PATH, JSON.stringify([...codes]), "utf-8");
  } catch (err) {
    logger.warn({ err }, "Failed to save sent codes to disk");
  }
}

const sentCodes = loadSentCodes();

function normalizeCode(code: string): string {
  return code.toLowerCase().replace(/^\d+-/, "");
}

function isNewCode(code: string): boolean {
  const normalized = normalizeCode(code);
  if (sentCodes.has(normalized)) return false;
  sentCodes.add(normalized);
  saveSentCodes(sentCodes);
  return true;
}

function getReconnectDelay(): number {
  const delay = Math.min(
    RECONNECT_DELAY_BASE * Math.pow(1.5, reconnectAttempts),
    RECONNECT_DELAY_MAX,
  );
  return delay + Math.random() * 1000;
}

function extractCode(data: Record<string, unknown>): string | null {
  if (typeof data.code === "string" && data.code.length > 0) return data.code;
  if (typeof data.promo === "string" && data.promo.length > 0) return data.promo;
  if (typeof data.hint === "string" && data.hint.length > 0) return data.hint;
  return null;
}

function extractDetails(data: Record<string, unknown>) {
  const type =
    typeof data.type === "string" ? data.type : undefined;
  const codeType =
    typeof data.codeType === "string"
      ? data.codeType
      : typeof data.category === "string"
        ? data.category
        : type && !["HINT", "hint", "code", "promo"].includes(type)
          ? type
          : undefined;
  const value =
    typeof data.value === "string"
      ? data.value
      : typeof data.amount === "string"
        ? data.amount
        : undefined;
  const requirement =
    typeof data.requirement === "string"
      ? data.requirement
      : typeof data.wager === "string"
        ? data.wager
        : undefined;
  const claimLimit =
    typeof data.claimLimit === "string"
      ? data.claimLimit
      : typeof data.maxClaims === "string"
        ? data.maxClaims
        : typeof data.limit === "number"
          ? String(data.limit)
          : undefined;
  return { codeType, value, requirement, claimLimit };
}

function connect(): void {
  if (stopped) return;

  logger.info({ url: WS_URL, attempt: reconnectAttempts }, "Connecting to LazyBot WS");

  const ws = new WebSocket(WS_URL);
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  ws.on("open", () => {
    logger.info("LazyBot WS connected — sending identify");
    reconnectAttempts = 0;

    ws.send(IDENTIFY_PAYLOAD, (err) => {
      if (err) {
        logger.error({ err }, "Failed to send identify payload");
      } else {
        logger.info("Identify payload sent");
      }
    });

    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, HEARTBEAT_INTERVAL);
  });

  ws.on("message", (raw) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    const msgType = String(data.type ?? "");

    if (msgType === "ack") {
      const ok = data.ok === true;
      const msg = String(data.message ?? "");
      if (ok) {
        logger.info({ msg }, "LazyBot WS identified successfully");
      } else {
        logger.error({ msg }, "LazyBot WS identify failed");
      }
      return;
    }

    if (["payment_info", "hello", "pong", "ping"].includes(msgType)) return;

    if (msgType === "bonusCheck") {
      const bonuses = Array.isArray(data.bonuses) ? data.bonuses : [];
      let seeded = 0;
      for (const entry of bonuses) {
        if (typeof entry !== "string") continue;
        const match = entry.match(/\?bonus=([^&\s]+)/);
        const code = match ? match[1] : null;
        if (!code) continue;
        const normalized = normalizeCode(code);
        if (!sentCodes.has(normalized)) {
          sentCodes.add(normalized);
          seeded++;
        }
      }
      if (seeded > 0) saveSentCodes(sentCodes);
      logger.info({ total: bonuses.length, seeded }, "bonusCheck — seeded existing codes, not forwarding to Telegram");
      return;
    }

    logger.info({ msgType, data }, "LazyBot WS message received");

    const code = extractCode(data);
    if (!code || !isNewCode(code)) return;

    const { codeType, value, requirement, claimLimit } = extractDetails(data);

    sendPromoCode({ code, type: codeType, value, requirement, claimLimit }).catch(
      (err) => logger.error({ err }, "Failed to forward code to Telegram"),
    );
  });

  ws.on("pong", () => {
    logger.debug("LazyBot WS pong");
  });

  ws.on("close", (code, reason) => {
    if (heartbeat) clearInterval(heartbeat);
    if (stopped) return;
    const delay = getReconnectDelay();
    reconnectAttempts++;
    logger.warn(
      { code, reason: reason.toString(), delay, reconnectAttempts },
      "LazyBot WS closed — reconnecting",
    );
    setTimeout(connect, delay);
  });

  ws.on("error", (err) => {
    logger.error({ err }, "LazyBot WS error");
    ws.terminate();
  });
}

export function startWsListener(): void {
  stopped = false;
  connect();
}

export function stopWsListener(): void {
  stopped = true;
}
