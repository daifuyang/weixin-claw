import crypto from "node:crypto";

const API_TIMEOUT_MS = 15_000;

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function buildHeaders(token?: string, body?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
  };
  if (body) {
    headers["Content-Length"] = String(Buffer.byteLength(body, "utf-8"));
  }
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export async function apiGet(
  baseUrl: string,
  endpoint: string,
  timeoutMs: number,
): Promise<string> {
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl));
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    if (!res.ok)
      throw new Error(`GET ${endpoint} ${res.status}: ${text.slice(0, 200)}`);
    return text;
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

export async function apiPost(
  baseUrl: string,
  endpoint: string,
  body: string,
  token?: string,
  timeoutMs = API_TIMEOUT_MS,
): Promise<string> {
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl));
  const headers = buildHeaders(token, body);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    if (!res.ok)
      throw new Error(
        `POST ${endpoint} ${res.status}: ${text.slice(0, 200)}`,
      );
    return text;
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}
