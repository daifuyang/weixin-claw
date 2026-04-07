import { sendMessage, createSession } from "./client.js";
import type { SendMessageResponse } from "./client.js";

export interface RunOptions {
  sessionId?: string | null;
  timeoutMs?: number;
  cwd?: string;
  agent?: string;
}

export interface RunResult {
  sessionId: string;
  text: string;
  raw: SendMessageResponse;
}

export async function runOpencode(
  message: string,
  opts?: RunOptions,
): Promise<RunResult> {
  let sessionId = opts?.sessionId || "";

  if (!sessionId) {
    const session = await createSession();
    sessionId = session.id;
  }

  const resp = await sendMessage(sessionId, message, {
    agent: opts?.agent,
    timeoutMs: opts?.timeoutMs,
  });

  const textParts: string[] = [];
  for (const part of resp.parts ?? []) {
    const content = part.content || part.text || "";
    if (part.type === "text" && content) {
      textParts.push(content);
    }
  }

  if (textParts.length === 0) {
    console.log(`[opencode] ⚠️ 无 text 内容, parts=${JSON.stringify(resp.parts ?? []).slice(0, 500)}`);
  } else {
    console.log(`[opencode] 收到 ${textParts.length} 个 text part, 总长 ${textParts.reduce((a, b) => a + b.length, 0)} 字符`);
  }

  return {
    sessionId,
    text: textParts.join(""),
    raw: resp,
  };
}
