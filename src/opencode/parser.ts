export interface AgentAction {
  type: string;
  payload: Record<string, unknown>;
}

export interface ParsedActions {
  cleanText: string;
  actions: AgentAction[];
}

export function parseActions(text: string): ParsedActions {
  const actions: AgentAction[] = [];
  const actionRegex = /<!--ACTION:(\w+)(\{[\s\S]*?\})-->/g;

  let cleanText = text;
  let match: RegExpExecArray | null;

  while ((match = actionRegex.exec(text)) !== null) {
    try {
      const payload = JSON.parse(match[2]);
      actions.push({ type: match[1], payload });
    } catch {}
  }

  cleanText = cleanText.replace(/\s*<!--ACTION:\w+\{[\s\S]*?\}-->\s*/g, "").trim();
  return { cleanText, actions };
}

export function friendlyError(err: unknown): string {
  const errStr = String(err);
  if (errStr.includes("ECONNREFUSED")) {
    return "⚠️ opencode web 未运行，请先启动: opencode web";
  }
  if (errStr.includes("ETIMEDOUT") || errStr.includes("timeout") || errStr.includes("超时")) {
    return "⚠️ AI 处理超时，请简化问题后重试。";
  }
  if (errStr.includes("401") || errStr.includes("Unauthorized")) {
    return "⚠️ opencode 认证失败，请检查 OPENCODE_SERVER_PASSWORD 环境变量。";
  }
  return `⚠️ AI 执行失败: ${errStr.slice(0, 200)}`;
}
