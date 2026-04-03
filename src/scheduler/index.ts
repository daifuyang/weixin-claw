import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Cron } from "croner";

import { WeixinClient } from "../client/index.js";
import { md2wx, splitForWeChat } from "../utils/md2wx.js";
import { DATA_DIR, SCHEDULES_FILE } from "../utils/paths.js";

export interface ScheduledTask {
  id: number;
  cron: string;
  prompt: string;
  userId: string;
  description: string;
  createdAt: string;
}

function loadSchedules(): ScheduledTask[] {
  try {
    if (!fs.existsSync(SCHEDULES_FILE)) return [];
    return JSON.parse(fs.readFileSync(SCHEDULES_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveSchedules(tasks: ScheduledTask[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(tasks, null, 2), "utf-8");
}

function nextId(tasks: ScheduledTask[]): number {
  return tasks.length === 0 ? 1 : Math.max(...tasks.map((t) => t.id)) + 1;
}

const runningJobs = new Map<number, Cron>();

export function addSchedule(task: Omit<ScheduledTask, "id" | "createdAt">): ScheduledTask {
  const tasks = loadSchedules();
  const existing = tasks.find(
    (t) => t.userId === task.userId && t.cron === task.cron && t.prompt === task.prompt,
  );
  if (existing) return existing;

  const newTask: ScheduledTask = {
    ...task,
    id: nextId(tasks),
    createdAt: new Date().toISOString(),
  };
  tasks.push(newTask);
  saveSchedules(tasks);
  return newTask;
}

export function removeSchedule(id: number): boolean {
  const tasks = loadSchedules();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  tasks.splice(idx, 1);
  saveSchedules(tasks);

  const job = runningJobs.get(id);
  if (job) {
    job.stop();
    runningJobs.delete(id);
  }
  return true;
}

export function listSchedules(userId?: string): ScheduledTask[] {
  const tasks = loadSchedules();
  return userId ? tasks.filter((t) => t.userId === userId) : tasks;
}

function log(msg: string): void {
  const ts = new Date().toLocaleTimeString();
  console.log(`\x1b[90m[${ts}]\x1b[0m ${msg}`);
}

function runOpencode(prompt: string, timeoutMs = 24 * 60 * 60_000): Promise<string> {
  return new Promise((resolve) => {
    const escaped = prompt.replace(/'/g, "'\\''");
    const child = spawn("opencode", ["run", `${escaped}`], {
      shell: true,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        resolve(`执行失败 (code=${code}): ${stderr.trim() || stdout.trim()}`);
      }
    });

    child.on("error", (err) => {
      resolve(`执行出错: ${String(err)}`);
    });
  });
}


function executeTask(task: ScheduledTask, client: WeixinClient): void {
  log(`⏰ 执行定时任务 #${task.id}: ${task.description}`);

  runOpencode(task.prompt).then((result) => {
    const cleaned = md2wx(result);
    log(`✅ 任务 #${task.id} 完成 (${cleaned.length} 字符)`);

    const maxLen = 4000;
    const header = `⏰ 定时任务 #${task.id}\n📋 ${task.description}`;
    let chunks: string[];
    if (cleaned.trim()) {
      chunks = splitForWeChat(cleaned).map((chunk) =>
        chunk.length > maxLen ? chunk.slice(0, maxLen) + "\n...(已截断)" : chunk,
      );
      chunks[0] = `${header}\n\n${chunks[0]}`;
    } else if (result.trim()) {
      const preview = result.slice(0, 200).replace(/\n/g, " ");
      chunks = [`${header}\n\n⚠️ AI 未生成有效回复。原始输出片段:\n${preview}`];
    } else {
      chunks = [`${header}\n\n⚠️ AI 无回复，可能执行超时或内部异常。`];
    }

    client.sendChunks(task.userId, chunks).catch((err) => {
      log(`❌ 推送失败 #${task.id}: ${String(err)}`);
    });
  });
}

export function startAllSchedules(client: WeixinClient): void {
  for (const job of runningJobs.values()) {
    job.stop();
  }
  runningJobs.clear();

  const tasks = loadSchedules();
  for (const task of tasks) {
    try {
      const job = new Cron(task.cron, () => {
        executeTask(task, client);
      });
      runningJobs.set(task.id, job);
      log(`📅 已加载定时任务 #${task.id}: "${task.description}" (${task.cron})`);
    } catch (err) {
      log(`❌ 加载任务 #${task.id} 失败: ${String(err)}`);
    }
  }

  if (tasks.length > 0) {
    log(`📅 共加载 ${tasks.length} 个定时任务`);
  }
}

export function startSingleSchedule(task: ScheduledTask, client: WeixinClient): void {
  try {
    const job = new Cron(task.cron, () => {
      executeTask(task, client);
    });
    runningJobs.set(task.id, job);
  } catch (err) {
    log(`❌ 启动任务 #${task.id} 失败: ${String(err)}`);
  }
}

export function formatTaskList(tasks: ScheduledTask[]): string {
  if (tasks.length === 0) return "📋 暂无定时任务";

  const lines = tasks.map((t) => {
    return `  #${t.id} | ${t.cron} | ${t.description}`;
  });
  return `📋 定时任务列表:\n${lines.join("\n")}\n\n回复"取消任务"可管理任务`;
}

export function startReminder(
  opts: { delayMinutes: number; prompt: string; description: string; userId: string },
  client: WeixinClient,
): void {
  const fireAt = new Date(Date.now() + opts.delayMinutes * 60_000);
  const isoLocal = fireAt.toISOString();
  log(`⏳ 设定提醒: "${opts.description}" → ${isoLocal}`);

  new Cron(isoLocal, { maxRuns: 1 }, () => {
    log(`🔔 执行提醒: ${opts.description}`);

    runOpencode(opts.prompt).then((result) => {
      const cleaned = md2wx(result);
      log(`✅ 提醒任务完成 (${cleaned.length} 字符)`);

      const maxLen = 4000;
      const header = `🔔 提醒\n📋 ${opts.description}`;
      let chunks: string[];
      if (cleaned.trim()) {
        chunks = splitForWeChat(cleaned).map((chunk) =>
          chunk.length > maxLen ? chunk.slice(0, maxLen) + "\n...(已截断)" : chunk,
        );
        chunks[0] = `${header}\n\n${chunks[0]}`;
      } else if (result.trim()) {
        const preview = result.slice(0, 200).replace(/\n/g, " ");
        chunks = [`${header}\n\n⚠️ AI 未生成有效回复。原始输出片段:\n${preview}`];
      } else {
        chunks = [`${header}\n\n⚠️ AI 无回复，可能执行超时或内部异常。`];
      }

      client.sendChunks(opts.userId, chunks).catch((err) => {
        log(`❌ 提醒推送失败: ${String(err)}`);
      });
    });
  });
}


