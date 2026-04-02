import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SESSIONS_DIR = path.join(os.homedir(), "weixin-claw");

function userDir(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9@._-]/g, "_");
  return path.join(SESSIONS_DIR, safe);
}

function sessionDir(userId: string, sessionId: string): string {
  return path.join(userDir(userId), sessionId);
}

function indexPath(): string {
  return path.join(SESSIONS_DIR, "sessions.json");
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
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
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

export function appendChat(
  userId: string,
  sessionId: string,
  role: "user" | "assistant",
  content: string,
): void {
  const dir = sessionDir(userId, sessionId);
  fs.mkdirSync(dir, { recursive: true });

  const chatFile = path.join(dir, "chat.md");
  const timestamp = new Date().toLocaleString();
  const header = role === "user" ? "## 🧑 User" : "## 🤖 Assistant";
  const entry = `\n${header} (${timestamp})\n\n${content}\n\n---\n`;

  fs.appendFileSync(chatFile, entry, "utf-8");
}
