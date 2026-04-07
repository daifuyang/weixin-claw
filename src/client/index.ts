import crypto from "node:crypto";

import { isDebug } from "../utils/paths.js";

const IS_DEBUG = isDebug();

import { apiPost } from "./api.js";
import { loadCredentials, saveCredentials, qrLogin } from "./auth.js";
import type {
  SavedCredentials,
  WeixinMessage,
  GetUpdatesResp,
  GetConfigResp,
} from "./types.js";
import { MessageType, MessageState, TypingStatus } from "./types.js";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 10_000;
const RETRY_DELAY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type MessageHandler = (msg: WeixinMessage) => void | Promise<void>;

const contextTokens = new Map<string, string>();

export function setContextToken(userId: string, token: string): void {
  contextTokens.set(userId, token);
}

export function getContextToken(userId: string): string | undefined {
  return contextTokens.get(userId);
}

export function getAllContextTokens(): ReadonlyMap<string, string> {
  return contextTokens;
}

export class WeixinClient {
  private cred: SavedCredentials | null;

  constructor(credentials?: SavedCredentials) {
    this.cred = credentials ?? loadCredentials();
  }

  get credentials(): SavedCredentials | null {
    return this.cred;
  }

  get isLoggedIn(): boolean {
    return this.cred !== null;
  }

  async ensureLogin(): Promise<SavedCredentials> {
    if (!this.cred) {
      this.cred = await qrLogin();
    }
    return this.cred;
  }

  async login(): Promise<SavedCredentials> {
    this.cred = await qrLogin();
    return this.cred;
  }

  async send(to: string, text: string): Promise<void> {
    const cred = await this.ensureLogin();
    const contextToken = getContextToken(to);
    const clientId = `weixin-claw:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    if (IS_DEBUG) console.log(`\x1b[90m[send]\x1b[0m → ${to.split("@")[0]} (clientId=${clientId.slice(-12)})`);
    const body = JSON.stringify({
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: 1, text_item: { text } }],
        context_token: contextToken,
      },
    });
    await apiPost(cred.baseUrl, "ilink/bot/sendmessage", body, cred.token);
  }

  async sendChunks(to: string, chunks: string[], delayMs = 300): Promise<void> {
    for (let i = 0; i < chunks.length; i++) {
      await this.send(to, chunks[i]);
      if (i < chunks.length - 1) await sleep(delayMs);
    }
  }

  async getTypingTicket(userId: string): Promise<string | null> {
    const cred = await this.ensureLogin();
    const contextToken = getContextToken(userId);
    const body = JSON.stringify({
      ilink_user_id: userId,
      context_token: contextToken,
    });
    try {
      const raw = await apiPost(
        cred.baseUrl,
        "ilink/bot/getconfig",
        body,
        cred.token,
        10_000,
      );
      const resp: GetConfigResp = JSON.parse(raw);
      return resp.typing_ticket ?? null;
    } catch {
      return null;
    }
  }

  async startTyping(userId: string): Promise<() => Promise<void>> {
    const ticket = await this.getTypingTicket(userId);
    if (!ticket) return async () => {};

    const cred = this.cred!;
    const sendTypingReq = async (status: number) => {
      const body = JSON.stringify({
        ilink_user_id: userId,
        typing_ticket: ticket,
        status,
      });
      try {
        await apiPost(cred.baseUrl, "ilink/bot/sendtyping", body, cred.token, 10_000);
      } catch { /* best-effort */ }
    };

    await sendTypingReq(TypingStatus.TYPING);

    const interval = setInterval(() => {
      sendTypingReq(TypingStatus.TYPING);
    }, 5_000);

    return async () => {
      clearInterval(interval);
      await sendTypingReq(TypingStatus.CANCEL);
    };
  }

  async poll(
    handler: MessageHandler,
    signal?: AbortSignal,
  ): Promise<void> {
    const cred = await this.ensureLogin();
    let getUpdatesBuf = "";
    let consecutiveFailures = 0;
    let nextTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS;

    while (!signal?.aborted) {
      try {
        const body = JSON.stringify({ get_updates_buf: getUpdatesBuf });
        const raw = await apiPost(
          cred.baseUrl,
          "ilink/bot/getupdates",
          body,
          cred.token,
          nextTimeoutMs,
        );
        const resp: GetUpdatesResp = JSON.parse(raw);

        if (resp.longpolling_timeout_ms && resp.longpolling_timeout_ms > 0) {
          nextTimeoutMs = resp.longpolling_timeout_ms;
        }

        const isError =
          (resp.ret !== undefined && resp.ret !== 0) ||
          (resp.errcode !== undefined && resp.errcode !== 0);

        if (isError) {
          if (resp.errcode === -14 || resp.ret === -14) {
            throw new SessionExpiredError();
          }
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            consecutiveFailures = 0;
            await sleep(BACKOFF_DELAY_MS);
          } else {
            await sleep(RETRY_DELAY_MS);
          }
          continue;
        }

        consecutiveFailures = 0;

        if (resp.get_updates_buf) {
          getUpdatesBuf = resp.get_updates_buf;
        }

        for (const msg of resp.msgs ?? []) {
          if (msg.context_token && msg.from_user_id) {
            setContextToken(msg.from_user_id, msg.context_token);
          }

          await handler(msg);
        }
      } catch (err) {
        if (signal?.aborted) return;
        if (err instanceof SessionExpiredError) throw err;
        if (err instanceof Error && err.name === "AbortError") continue;

        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS);
        } else {
          await sleep(RETRY_DELAY_MS);
        }
      }
    }
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("微信会话已过期 (errcode=-14)，请重新登录");
    this.name = "SessionExpiredError";
  }
}

export { loadCredentials, saveCredentials, qrLogin } from "./auth.js";
export type { SavedCredentials, WeixinMessage } from "./types.js";
