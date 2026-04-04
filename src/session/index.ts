import fs from "node:fs";
import path from "node:path";

import { DATA_DIR, SESSIONS_FILE, userDataDir } from "../utils/paths.js";

function userDir(userId: string): string {
  return userDataDir(userId);
}

function sessionDir(userId: string, sessionId: string): string {
  return path.join(userDir(userId), sessionId);
}

function indexPath(): string {
  return SESSIONS_FILE;
}

interface SessionIndex {
  [userId: string]: {
    activeSessionId: string;
    createdAt: string;
  };
}

function loadIndex(): SessionIndex {
  try {
    if (!fs.existsSync(indexPath())) return {};
    return JSON.parse(fs.readFileSync(indexPath(), "utf-8"));
  } catch {
    return {};
  }
}

function saveIndex(index: SessionIndex): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(indexPath(), JSON.stringify(index, null, 2), "utf-8");
}

export function getActiveSession(userId: string): string | null {
  const index = loadIndex();
  return index[userId]?.activeSessionId ?? null;
}

export function setActiveSession(userId: string, sessionId: string): void {
  const index = loadIndex();
  index[userId] = {
    activeSessionId: sessionId,
    createdAt: index[userId]?.createdAt ?? new Date().toISOString(),
  };
  saveIndex(index);

  const dir = sessionDir(userId, sessionId);
  fs.mkdirSync(dir, { recursive: true });
}

export function clearActiveSession(userId: string): void {
  const index = loadIndex();
  delete index[userId];
  saveIndex(index);
}

export function listSessions(userId: string): string[] {
  const dir = userDir(userId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function memoryDir(userId: string): string {
  return path.join(userDir(userId), "memory");
}

export interface MemoryFile {
  index: number;
  filename: string;
  title: string;
  date: string;
}

export function saveMemory(userId: string, title: string, content: string): MemoryFile {
  const slug = title.slice(0, 20).replace(/[\/\\:*?"<>|]/g, "").trim() || "对话";
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = `${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
  const filename = `${date}-${time}-${slug}.md`;

  const dir = memoryDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), `# ${slug}\n\n${content}`, "utf-8");

  return { index: 0, filename, title: slug, date };
}

export function listMemories(userId: string): MemoryFile[] {
  const dir = memoryDir(userId);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .map((filename, i) => {
      const firstLine = fs.readFileSync(path.join(dir, filename), "utf-8")
        .split("\n")[0]
        .replace(/^#\s*/, "")
        .trim();
      const date = filename.slice(0, 10);
      return { index: i + 1, filename, title: firstLine || filename, date };
    });
}

export function loadMemory(userId: string, index: number): { title: string; content: string } | null {
  const memories = listMemories(userId);
  const mem = memories.find((m) => m.index === index);
  if (!mem) return null;

  const dir = memoryDir(userId);
  const raw = fs.readFileSync(path.join(dir, mem.filename), "utf-8");
  return { title: mem.title, content: raw };
}

export interface SessionContext {
  memories: MemoryFile[];
  tasks: { id: number; description: string; cron: string }[];
  loadedMemory?: string;
}

export function writeSessionContext(ctx: SessionContext): void {
  const sections: string[] = [];

  if (ctx.loadedMemory) {
    sections.push(`## 已加载的历史记忆\n\n${ctx.loadedMemory}`);
  }

  if (ctx.memories.length > 0) {
    const list = ctx.memories.map((m) => `- #${m.index} [${m.date}] ${m.title}`).join("\n");
    sections.push(`## 历史记忆列表\n\n${list}\n\n用户可发送 /记忆 <编号> 加载指定记忆。`);
  }

  if (ctx.tasks.length > 0) {
    const list = ctx.tasks.map((t) => `- #${t.id} ${t.description} (${t.cron})`).join("\n");
    sections.push(`## 当前定时任务\n\n${list}`);
  }

  const contextDir = path.join(process.cwd(), ".opencode");
  fs.mkdirSync(contextDir, { recursive: true });
  const content = sections.length > 0
    ? `# 用户上下文\n\n${sections.join("\n\n---\n\n")}\n`
    : "";
  fs.writeFileSync(path.join(contextDir, "context.md"), content, "utf-8");
}
