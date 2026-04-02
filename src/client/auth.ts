import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { apiGet } from "./api.js";
import type {
  QRCodeResponse,
  StatusResponse,
  SavedCredentials,
} from "./types.js";

const FIXED_QR_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const BOT_TYPE = "3";

function defaultCredentialsPath(): string {
  return path.join(os.homedir(), ".weixin-claw.json");
}

export function loadCredentials(
  filePath?: string,
): SavedCredentials | null {
  const p = filePath ?? defaultCredentialsPath();
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as SavedCredentials;
  } catch {
    return null;
  }
}

export function saveCredentials(
  cred: SavedCredentials,
  filePath?: string,
): void {
  const p = filePath ?? defaultCredentialsPath();
  fs.writeFileSync(p, JSON.stringify(cred, null, 2), "utf-8");
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* best-effort */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(msg: string): void {
  const ts = new Date().toLocaleTimeString();
  console.log(`\x1b[90m[${ts}]\x1b[0m ${msg}`);
}

export async function qrLogin(): Promise<SavedCredentials> {
  log("正在获取登录二维码...");
  const qrRaw = await apiGet(
    FIXED_QR_BASE_URL,
    `ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`,
    10_000,
  );
  const qr: QRCodeResponse = JSON.parse(qrRaw);

  console.log("\n\x1b[36m请使用微信扫描以下二维码：\x1b[0m\n");
  try {
    // @ts-ignore qrcode-terminal has no type declarations
    const qrterm = await import("qrcode-terminal");
    await new Promise<void>((resolve) => {
      qrterm.default.generate(
        qr.qrcode_img_content,
        { small: true },
        (qrStr: string) => {
          console.log(qrStr);
          resolve();
        },
      );
    });
  } catch {
    // fallback
  }
  console.log(
    `\x1b[90m如果二维码无法显示，请在浏览器打开：\x1b[0m\n${qr.qrcode_img_content}\n`,
  );

  let currentBaseUrl = FIXED_QR_BASE_URL;
  const deadline = Date.now() + 5 * 60_000;

  while (Date.now() < deadline) {
    try {
      const statusRaw = await apiGet(
        currentBaseUrl,
        `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qr.qrcode)}`,
        35_000,
      );
      const status: StatusResponse = JSON.parse(statusRaw);

      switch (status.status) {
        case "wait":
          break;
        case "scaned":
          log("👀 已扫码，请在微信上确认...");
          break;
        case "scaned_but_redirect":
          if (status.redirect_host) {
            currentBaseUrl = `https://${status.redirect_host}`;
            log(`IDC 重定向到 ${currentBaseUrl}`);
          }
          break;
        case "expired":
          log("❌ 二维码已过期，请重新运行程序。");
          process.exit(1);
          break;
        case "confirmed": {
          if (!status.bot_token || !status.ilink_bot_id) {
            throw new Error("登录确认但缺少 bot_token 或 ilink_bot_id");
          }
          const cred: SavedCredentials = {
            token: status.bot_token,
            baseUrl: status.baseurl || DEFAULT_BASE_URL,
            accountId: status.ilink_bot_id,
            userId: status.ilink_user_id,
            savedAt: new Date().toISOString(),
          };
          saveCredentials(cred);
          log(`✅ 登录成功！ accountId=${cred.accountId}`);
          return cred;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        continue;
      }
      log(`轮询状态出错: ${String(err)}，重试中...`);
    }
    await sleep(1000);
  }

  throw new Error("登录超时");
}
