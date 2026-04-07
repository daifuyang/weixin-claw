const DEFAULT_BASE_URL = "http://127.0.0.1:4096";

function getBaseUrl(): string {
  return process.env.OPENCODE_URL || DEFAULT_BASE_URL;
}

function getPassword(): string {
  return process.env.OPENCODE_SERVER_PASSWORD || "";
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const pw = getPassword();
  if (pw) h["Authorization"] = `Bearer ${pw}`;
  return h;
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const controller = new AbortController();
  const timeout = timeoutMs
    ? setTimeout(() => controller.abort(), timeoutMs)
    : undefined;

  try {
    const resp = await fetch(url, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`opencode API ${method} ${path} → ${resp.status}: ${text.slice(0, 200)}`);
    }

    return resp.json() as Promise<T>;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`opencode API ${method} ${path} → 超时 (${Math.round((timeoutMs || 0) / 1000)}s)`);
    }
    throw err;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export interface HealthResponse {
  version: string;
  status: string;
}

export async function healthCheck(): Promise<HealthResponse> {
  return request<HealthResponse>("GET", "/global/health");
}

export interface Session {
  id: string;
  title?: string;
  parentID?: string;
  createdAt?: string;
}

export async function createSession(title?: string): Promise<Session> {
  return request<Session>("POST", "/session", title ? { title } : {});
}

export async function listSessions(): Promise<Session[]> {
  return request<Session[]>("GET", "/session");
}

export interface MessagePart {
  type: string;
  content?: string;
  text?: string;
}

export interface MessageInfo {
  id: string;
  timestamp?: string;
}

export interface SendMessageResponse {
  info: MessageInfo;
  parts: MessagePart[];
}

export interface SendMessageOptions {
  agent?: string;
  timeoutMs?: number;
}

export async function sendMessage(
  sessionId: string,
  text: string,
  opts?: SendMessageOptions,
): Promise<SendMessageResponse> {
  const body: Record<string, unknown> = {
    parts: [{ type: "text", text }],
  };
  if (opts?.agent) body.agent = opts.agent;
  return request<SendMessageResponse>("POST", `/session/${sessionId}/message`, body, opts?.timeoutMs);
}
