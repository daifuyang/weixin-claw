import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DATA_DIR =
  process.env.WEIXIN_CLAW_HOME || path.join(os.homedir(), ".weixin-claw");

export const CREDENTIALS_FILE = path.join(DATA_DIR, "credentials.json");
export const SCHEDULES_FILE = path.join(DATA_DIR, "schedules.json");
export const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
export const CONFIG_FILE = path.join(DATA_DIR, "config.json");
export const ARTIFACTS_DIR = path.join(DATA_DIR, "artifacts");

export function userDataDir(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9@._-]/g, "_");
  return path.join(DATA_DIR, safe);
}

interface AppConfig {
  debug?: boolean;
}

let _config: AppConfig | null = null;

function loadConfig(): AppConfig {
  if (_config) return _config;
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      _config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      return _config!;
    }
  } catch {}
  _config = {};
  return _config;
}

export function isDebug(): boolean {
  return loadConfig().debug === true;
}
