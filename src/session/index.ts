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

export function appendSummary(
  userId: string,
  sessionId: string,
  question: string,
  answer: string,
  actions: number,
): void {
  const dir = sessionDir(userId, sessionId);
  fs.mkdirSync(dir, { recursive: true });

  const chatFile = path.join(dir, "chat.md");
  const timestamp = new Date().toLocaleString();
  const q = question.length > 80 ? question.slice(0, 80) + "…" : question;
  const a = answer.length > 120 ? answer.slice(0, 120) + "…" : answer;
  const actionNote = actions > 0 ? ` | ${actions} action` : "";
  const entry = `- **${timestamp}**${actionNote}\n  Q: ${q}\n  A: ${a}\n`;

  fs.appendFileSync(chatFile, entry, "utf-8");
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

export function archiveSession(userId: string, sessionId: string): MemoryFile | null {
  const chatFile = path.join(sessionDir(userId, sessionId), "chat.md");
  if (!fs.existsSync(chatFile)) return null;

  const content = fs.readFileSync(chatFile, "utf-8").trim();
  if (!content) return null;

  const firstQ = content.match(/Q: (.+)/)?.[1] ?? "对话";
  const slug = firstQ.slice(0, 20).replace(/[\/\\:*?"<>|]/g, "").trim();
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = `${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
  const filename = `${date}-${time}-${slug}.md`;

  const dir = memoryDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const header = `# ${slug}\n\n`;
  fs.writeFileSync(path.join(dir, filename), header + content, "utf-8");

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
