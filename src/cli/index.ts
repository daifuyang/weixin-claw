#!/usr/bin/env npx tsx

import { parseArgs } from "node:util";
import readline from "node:readline";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { WeixinClient, getAllContextTokens } from "../client/index.js";
import type { WeixinMessage } from "../client/types.js";
import { MessageType } from "../client/types.js";
import { WeixinPoller, formatMessage, extractText } from "../poller/index.js";
import { notify } from "../notifier/index.js";
import { md2wx, splitForWeChat } from "../utils/md2wx.js";
import { isDebug } from "../utils/paths.js";
import {
  runOpencode,
  healthCheck,
  parseActions,
  friendlyError,
} from "../opencode/index.js";
import {
  getActiveSession,
  setActiveSession,
  clearActiveSession,
  listSessions,
  saveMemory,
  listMemories,
  loadMemory,
  writeSessionContext,
  getUserCwd,
  setUserCwd,
} from "../session/index.js";
import {
  addSchedule,
  removeSchedule,
  listSchedules,
  startAllSchedules,
  startSingleSchedule,
  startReminder,
  formatTaskList,
} from "../scheduler/index.js";

const LOG_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "../../logs");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
let logStream: fs.WriteStream | null = null;
let logFilePath = "";

function getLogFileName(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  return `agent-${date}.log`;
}

function initLogStream(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  logFilePath = path.join(LOG_DIR, getLogFileName());
  logStream = fs.createWriteStream(logFilePath, { flags: "a" });
  logStream.write(`\n--- agent started at ${new Date().toISOString()} ---\n`);
}

function rotateIfNeeded(): void {
  const currentName = getLogFileName();
  const expectedPath = path.join(LOG_DIR, currentName);

  if (expectedPath !== logFilePath) {
    logStream?.end();
    logFilePath = expectedPath;
    logStream = fs.createWriteStream(logFilePath, { flags: "a" });
    logStream.write(`\n--- agent continued at ${new Date().toISOString()} ---\n`);
    return;
  }

  try {
    const stat = fs.statSync(logFilePath);
    if (stat.size >= MAX_LOG_SIZE) {
      logStream?.end();
      const ts = Date.now();
      fs.renameSync(logFilePath, logFilePath.replace(".log", `-${ts}.log`));
      logStream = fs.createWriteStream(logFilePath, { flags: "a" });
      logStream.write(`\n--- log rotated at ${new Date().toISOString()} ---\n`);
    }
  } catch { /* file may not exist yet */ }
}

const IS_DEBUG = isDebug();

function log(msg: string): void {
  const ts = new Date().toLocaleTimeString();
  console.log(`\x1b[90m[${ts}]\x1b[0m ${msg}`);
  rotateIfNeeded();
  const plain = msg.replace(/\x1b\[[0-9;]*m/g, "");
  logStream?.write(`[${ts}] ${plain}\n`);
}

function debug(msg: string): void {
  if (!IS_DEBUG) return;
  const ts = new Date().toLocaleTimeString();
  console.log(`\x1b[90m[${ts}] [DEBUG]\x1b[0m ${msg}`);
  rotateIfNeeded();
  const plain = msg.replace(/\x1b\[[0-9;]*m/g, "");
  logStream?.write(`[${ts}] [DEBUG] ${plain}\n`);
}

function printUsage(): never {
  console.log(`weixin-claw — 微信 clawbot 对话工具

用法: pnpm wx <command> [options]

命令:
  login                扫码登录微信
  send                 发送消息
  poll                 交互式消息监听 (REPL)
  agent                AI 代理模式 (收到消息 → opencode run → 回复)
  task                 执行命令并推送结果

所有命令在未登录时会自动弹出二维码扫码。

示例:
  pnpm wx send --text "你好"
  pnpm wx poll
  pnpm wx agent
  pnpm wx task --cmd "echo hello"

使用 pnpm wx <command> --help 查看具体命令的帮助。`);
  process.exit(0);
}

async function cmdLogin(): Promise<void> {
  const client = new WeixinClient();

  if (client.isLoggedIn) {
    const cred = client.credentials!;
    console.log(
      `\x1b[33m已有保存的凭证 (accountId=${cred.accountId}, saved=${cred.savedAt})\x1b[0m`,
    );
    console.log("如需强制重新登录，请删除凭证文件后重试。\n");
  }

  const cred = await client.login();
  console.log(`\n\x1b[32m登录成功！\x1b[0m`);
  console.log(`  accountId: ${cred.accountId}`);
  console.log(`  baseUrl:   ${cred.baseUrl}`);
  console.log(`  userId:    ${cred.userId ?? "(无)"}`);
  console.log(`  savedAt:   ${cred.savedAt}`);
}

async function cmdSend(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      to: { type: "string" },
      text: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`用法: pnpm wx send [--to <userId>] --text <消息内容>

选项:
  --to    目标用户 ID (可选，默认发给自己)
  --text  消息内容 (必填)`);
    process.exit(0);
  }

  if (!values.text) {
    console.error("❌ 缺少 --text 参数");
    process.exit(1);
  }

  await notify(values.text, { to: values.to });
  console.log(`✅ 消息已发送`);
}

async function cmdPoll(): Promise<void> {
  const client = new WeixinClient();
  const cred = await client.ensureLogin();
  const poller = new WeixinPoller(client);

  console.log("\x1b[36m");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  weixin-claw 消息监听");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\x1b[0m");
  console.log("  输入文字直接回复最近的消息发送者");
  console.log("  输入 @<用户ID> <消息> 指定发送目标");
  console.log("  输入 /who 查看当前目标");
  console.log("  输入 /tokens 查看已缓存的 contextToken");
  console.log("  输入 /quit 退出");
  console.log("");
  log(`已登录: accountId=${cred.accountId} baseUrl=${cred.baseUrl}`);
  log("开始监听消息...\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "",
  });

  function updatePrompt(): void {
    const target = poller.lastFrom
      ? `@${poller.lastFrom.split("@")[0]}`
      : "(无目标)";
    process.stdout.write(`\n\x1b[33m${target} >\x1b[0m `);
  }

  poller.on("message", (msg) => {
    console.log(`\n  📨 ${formatMessage(msg)}`);
    updatePrompt();
  });

  poller.on("expired", () => {
    log("⚠️  会话已过期，请重新运行: pnpm wx login");
    rl.close();
    process.exit(1);
  });

  poller.on("error", (err) => {
    log(`监听异常: ${String(err)}`);
  });

  poller.start().catch((err) => {
    log(`监听异常退出: ${String(err)}`);
  });

  updatePrompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      updatePrompt();
      return;
    }

    if (input === "/quit" || input === "/exit") {
      log("正在退出...");
      poller.stop();
      rl.close();
      process.exit(0);
    }

    if (input === "/who") {
      if (poller.lastFrom) {
        log(`当前回复目标: ${poller.lastFrom}`);
      } else {
        log("还没有收到过消息，暂无回复目标。");
      }
      updatePrompt();
      return;
    }

    if (input === "/tokens") {
      const tokens = getAllContextTokens();
      if (tokens.size === 0) {
        log("没有缓存的 contextToken。");
      } else {
        debug(`已缓存 ${tokens.size} 个 contextToken:`);
        for (const [uid, tok] of tokens) {
          debug(`  ${uid} → ${tok.slice(0, 20)}...`);
        }
      }
      updatePrompt();
      return;
    }

    let to: string;
    let text: string;

    const atMatch = input.match(/^@(\S+)\s+(.+)$/s);
    if (atMatch) {
      to = atMatch[1];
      text = atMatch[2];
    } else {
      if (!poller.lastFrom) {
        log("❌ 还没有收到过消息，无法自动识别目标。请使用 @<用户ID> <消息> 格式。");
        updatePrompt();
        return;
      }
      to = poller.lastFrom;
      text = input;
    }

    try {
      await client.send(to, text);
      log(`✅ 已发送 → ${to}`);
    } catch (err) {
      log(`❌ 发送失败: ${String(err)}`);
    }
    updatePrompt();
  });

  rl.on("close", () => {
    poller.stop();
    process.exit(0);
  });
}

const DEFAULT_TIMEOUT_MS = 120_000;

async function cmdTask(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      cmd: { type: "string" },
      to: { type: "string" },
      timeout: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`用法: pnpm wx task --cmd <命令> [--to <userId>] [--timeout <ms>]

执行一条命令，并将输出通过微信推送。

选项:
  --cmd      要执行的命令 (必填)
  --to       目标用户 ID (可选，默认发给自己)
  --timeout  命令超时时间（毫秒，默认 120000）`);
    process.exit(0);
  }

  if (!values.cmd) {
    console.error("❌ 缺少 --cmd 参数");
    process.exit(1);
  }

  const timeoutMs = values.timeout
    ? parseInt(values.timeout, 10)
    : DEFAULT_TIMEOUT_MS;

  log(`执行命令: ${values.cmd}`);

  let output: string;
  try {
    output = execSync(values.cmd, {
      timeout: timeoutMs,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
    log(`命令执行成功 (${output.length} 字符)`);
  } catch (err) {
    output = `命令执行失败: ${String(err)}`;
    log(output);
  }

  const maxLen = 4000;
  const truncated =
    output.length > maxLen
      ? output.slice(0, maxLen) + "\n...(已截断)"
      : output;

  const message = truncated || "(命令无输出)";

  await notify(message, { to: values.to });
  log("✅ 结果已推送到微信");
}

const AGENT_TIMEOUT_MS = 5 * 60_000;

const LOCK_FILE = path.join(os.tmpdir(), "weixin-claw-agent.lock");

function acquireLock(): void {
  try {
    const existing = fs.readFileSync(LOCK_FILE, "utf-8").trim();
    const pid = parseInt(existing, 10);
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        console.error(`❌ 已有 agent 实例在运行 (PID ${pid})，请先停止它再启动。`);
        process.exit(1);
      } catch { /* 进程不存在，锁文件是残留的 */ }
    }
  } catch { /* 锁文件不存在 */ }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseLock(): void {
  try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
}

async function cmdAgent(): Promise<void> {
  acquireLock();
  initLogStream();
  process.on("exit", () => { releaseLock(); logStream?.end(); });
  process.on("SIGINT", () => { releaseLock(); process.exit(0); });
  process.on("SIGTERM", () => { releaseLock(); process.exit(0); });

  const client = new WeixinClient();
  const cred = await client.ensureLogin();
  const poller = new WeixinPoller(client);

  console.log("\x1b[36m");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  weixin-claw AI 代理模式");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\x1b[0m");
  console.log("  收到微信消息 → opencode web 处理 → 自动回复结果");
  console.log("");
  console.log("  \x1b[33m指令:\x1b[0m");
  console.log("    /新会话 [路径]   归档当前会话，可选切换工作目录");
  console.log("    /任务            查看定时任务");
  console.log("    /记忆 [编号]     查看/加载历史记忆");
  console.log("    /cd <路径>       切换工作目录");
  console.log("    /pwd             查看当前工作目录");
  console.log("");
  console.log("  按 Ctrl+C 退出");
  console.log("");
  log(`已登录: accountId=${cred.accountId}`);

  try {
    const health = await healthCheck();
    log(`✅ opencode web 已连接 (v${health.version})`);
  } catch (err) {
    log(`❌ 无法连接 opencode web: ${String(err).slice(0, 100)}`);
    log(`   请先启动: opencode web`);
    log(`   或设置 OPENCODE_URL 环境变量指向正确地址`);
    process.exit(1);
  }

  startAllSchedules(client);

  if (cred.userId) {
    const welcome = [
      "🤖 weixin-claw 已上线",
      "",
      "可用指令:",
      "  /新会话 [路径] — 新建会话（可指定工作目录）",
      "  /任务 — 查看定时任务",
      "  /记忆 [编号] — 查看/加载历史记忆",
      "  /cd <路径> — 切换工作目录",
      "  /pwd — 查看当前工作目录",
      "",
      "也可以直接发消息与 AI 对话。",
    ].join("\n");
    client.send(cred.userId, welcome).catch(() => {});
  }

  log("等待消息...\n");

  const activeMemory = new Map<string, string>();

  poller.on("message", async (msg) => {
    const text = extractText(msg);
    const from = msg.from_user_id;
    const isBotMsg = msg.message_type === MessageType.BOT;

    if (isBotMsg) {
      if (text && from) {
        debug(`🤖 [BOT→${msg.to_user_id?.split("@")[0] ?? "?"}]: ${text.slice(0, 200)}`);
      }
      return;
    }

    if (!text || !from) return;

    try {
      log(`👤 ${from}: ${text}`);

      const input = text.trim();

      const newMatch = input.match(/^\/(new|新会话)(?:\s+(.+))?$/);
      if (newMatch) {
        const pathArg = newMatch[2]?.trim();
        const prevSession = getActiveSession(from);
        clearActiveSession(from);
        activeMemory.delete(from);

        if (pathArg) {
          const expanded = pathArg.replace(/^~/, os.homedir());
          const currentCwd = getUserCwd(from);
          const resolved = path.resolve(currentCwd || process.cwd(), expanded);
          if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
            setUserCwd(from, resolved);
          } else {
            await client.send(from, `❌ 目录不存在: ${resolved}`);
            return;
          }
        }

        if (prevSession) {
          await client.send(from, "🔄 正在归档当前会话...");
          try {
            const result = await runOpencode(
              "请用3-5句话总结这次对话的关键内容和用户偏好，第一行是10字以内的标题。只输出总结，不要其他内容。",
              { sessionId: prevSession, timeoutMs: 60_000, agent: "summarizer" },
            );
            const text = result.text.trim();
            if (text) {
              const lines = text.split("\n");
              const title = lines[0].replace(/^#+\s*/, "").slice(0, 20);
              const mem = saveMemory(from, title, text);
              const cwdInfo = pathArg ? `\n📂 工作目录: ${getUserCwd(from)}` : "";
              await client.send(from, `✅ 新会话已创建。\n💾 已归档: ${mem.title}${cwdInfo}\n\n直接发消息开始对话，或使用指令:\n/记忆 [编号] · /任务 · /cd <路径> · /pwd`);
              log(`💾 归档记忆: ${mem.title}`);
              return;
            }
          } catch (e) {
            log(`⚠️ 归档总结失败: ${String(e)}`);
          }
        }

        const cwdInfo = pathArg ? `\n📂 工作目录: ${getUserCwd(from)}` : "";
        await client.send(from, `✅ 新会话已创建。${cwdInfo}\n\n直接发消息开始对话，或使用指令:\n/记忆 [编号] · /任务 · /cd <路径> · /pwd`);
        return;
      }

      if (input === "/sessions" || input === "/会话") {
        const sessions = listSessions(from);
        const reply = sessions.length
          ? `📋 你的会话记录:\n${sessions.map((s) => `  • ${s}`).join("\n")}`
          : "📋 暂无会话记录";
        await client.send(from, reply);
        log(`🤖 回复: ${reply}`);
        return;
      }

      if (input === "/tasks" || input === "/任务") {
        const tasks = listSchedules(from);
        const reply = formatTaskList(tasks);
        await client.send(from, reply);
        log(`🤖 回复: ${reply}`);
        return;
      }

      if (input === "/memory" || input === "/记忆") {
        const memories = listMemories(from);
        if (memories.length === 0) {
          await client.send(from, "📂 暂无历史记忆。对话结束后发送 /new 会自动归档。");
        } else {
          const loaded = activeMemory.has(from) ? "\n\n✅ 当前已加载记忆" : "";
          const list = memories.map((m) => `  ${m.index}. [${m.date}] ${m.title}`).join("\n");
          await client.send(from, `📂 历史记忆:\n${list}\n\n回复 /记忆 <编号> 加载到当前会话${loaded}`);
        }
        return;
      }

      const memoryLoadMatch = input.match(/^\/(memory|记忆)\s+(\d+)$/);
      if (memoryLoadMatch) {
        const idx = parseInt(memoryLoadMatch[2], 10);
        const mem = loadMemory(from, idx);
        if (mem) {
          activeMemory.set(from, mem.content);
          await client.send(from, `✅ 已加载记忆「${mem.title}」到当前会话上下文。`);
          log(`💾 ${from} 加载了记忆: ${mem.title}`);
        } else {
          await client.send(from, `❌ 未找到编号 ${idx} 的记忆，请发送 /记忆 查看列表。`);
        }
        return;
      }

      if (input === "/pwd") {
        const cwd = getUserCwd(from);
        const reply = cwd
          ? `📂 当前工作目录: ${cwd}`
          : "📂 当前工作目录: (默认项目目录)";
        await client.send(from, reply);
        return;
      }

      const cdMatch = input.match(/^\/cd\s+(.+)$/);
      if (cdMatch) {
        const targetPath = cdMatch[1].trim().replace(/^~/, os.homedir());
        const currentCwd = getUserCwd(from);
        const resolved = path.resolve(currentCwd || process.cwd(), targetPath);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          setUserCwd(from, resolved);
          await client.send(from, `📂 工作目录已切换到: ${resolved}`);
          log(`📂 ${from} 切换目录: ${resolved}`);
        } else {
          await client.send(from, `❌ 目录不存在: ${resolved}`);
        }
        return;
      }

      const existingSession = getActiveSession(from);
      const userCwd = getUserCwd(from) ?? undefined;
      log(
        `📨 opencode 处理中...` +
          (existingSession ? ` [续接 ${existingSession.slice(0, 16)}...]` : " [新会话]") +
          (userCwd ? ` [cwd=${userCwd}]` : ""),
      );

      const stopTyping = await client.startTyping(from);

      writeSessionContext({
        memories: listMemories(from),
        tasks: listSchedules(from).map((t) => ({ id: t.id, description: t.description, cron: t.cron })),
        loadedMemory: activeMemory.get(from),
        cwd: userCwd,
      });

      debug(`🔧 opencode web → session=${existingSession || "(new)"}${userCwd ? ` cwd=${userCwd}` : ""} timeout=${AGENT_TIMEOUT_MS / 1000}s`);
      const t0 = Date.now();
      let result: Awaited<ReturnType<typeof runOpencode>>;
      try {
        result = await runOpencode(text, { sessionId: existingSession, timeoutMs: AGENT_TIMEOUT_MS, cwd: userCwd });
      } catch (err) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        await stopTyping();
        const friendlyMsg = friendlyError(err);
        log(`❌ opencode 失败 (${elapsed}s): ${friendlyMsg}`);
        debug(`❌ 原始错误: ${String(err)}`);
        await client.send(from, friendlyMsg);
        return;
      }

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      await stopTyping();

      const { sessionId, text: replyText } = result;
      const { cleanText, actions } = parseActions(replyText);
      log(`✅ opencode 完成 (${elapsed}s, session=${sessionId.slice(0, 16)}..., ${cleanText.length} 字符, ${actions.length} 个 action)`);

      if (sessionId) {
        setActiveSession(from, sessionId);
      }

      for (const action of actions) {
        if (action.type === "schedule") {
          const { cron, prompt, description } = action.payload as {
            cron: string;
            prompt: string;
            description: string;
          };
          if (cron && prompt) {
            const task = addSchedule({
              cron,
              prompt,
              userId: from,
              description: description || "定时任务",
            });
            startSingleSchedule(task, client);
            log(`📅 ${from} 创建了任务 #${task.id}: "${task.description}" (${task.cron})`);
          }
        } else if (action.type === "remind") {
          const { delay_minutes, prompt, description } = action.payload as {
            delay_minutes: number;
            prompt: string;
            description: string;
          };
          if (delay_minutes && prompt) {
            startReminder(
              { delayMinutes: delay_minutes, prompt, description: description || "提醒", userId: from },
              client,
            );
            log(`⏳ ${from} 设定了提醒: "${description}" (${delay_minutes}分钟后)`);
          }
        } else if (action.type === "cancel") {
          const { task_id } = action.payload as { task_id: number };
          if (task_id) {
            const removed = removeSchedule(task_id);
            log(removed
              ? `🗑️ ${from} 取消了任务 #${task_id}`
              : `❌ ${from} 尝试取消不存在的任务 #${task_id}`);
          }
        } else if (action.type === "memory") {
          const { index } = action.payload as { index: number };
          if (index) {
            const mem = loadMemory(from, index);
            if (mem) {
              activeMemory.set(from, mem.content);
              log(`💾 AI 加载了记忆 #${index}: ${mem.title}`);
            }
          }
        } else if (action.type === "cd") {
          const { path: targetPath } = action.payload as { path: string };
          if (targetPath) {
            const expanded = targetPath.replace(/^~/, os.homedir());
            const currentCwd = getUserCwd(from);
            const resolved = path.resolve(currentCwd || process.cwd(), expanded);
            if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
              setUserCwd(from, resolved);
              log(`📂 AI 切换目录: ${resolved}`);
            } else {
              log(`❌ AI 尝试切换到不存在的目录: ${resolved}`);
            }
          }
        }
      }

      const stripped = md2wx(cleanText);
      const maxLen = 4000;
      let chunks: string[];
      if (stripped.trim()) {
        chunks = splitForWeChat(stripped).map((chunk) =>
          chunk.length > maxLen ? chunk.slice(0, maxLen) + "\n...(已截断)" : chunk,
        );
      } else if (replyText.trim()) {
        const preview = replyText.slice(0, 200).replace(/\n/g, " ");
        chunks = [`⚠️ AI 未生成有效回复。原始输出片段:\n${preview}`];
      } else {
        chunks = ["⚠️ AI 无回复，可能执行超时或内部异常，请稍后重试。"];
      }

      await client.sendChunks(from, chunks);
      log(`🤖 回复 (${chunks.length} 条): ${chunks.map((c) => c.slice(0, 60)).join(" | ")}`);
      log(`📤 已回复 → ${from}`);
    } catch (err) {
      const errMsg = `⚠️ 处理异常: ${String(err)}`;
      log(`❌ ${errMsg}`);
      try {
        await client.send(from, errMsg);
      } catch { /* ignore send failure */ }
    }
  });

  poller.on("expired", () => {
    log("⚠️  会话已过期，请重新运行: pnpm wx login");
    process.exit(1);
  });

  poller.on("error", (err) => {
    log(`监听异常: ${String(err)}`);
  });

  await poller.start();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  switch (command) {
    case "login":
      await cmdLogin();
      break;
    case "send":
      await cmdSend(rest);
      break;
    case "poll":
      await cmdPoll();
      break;
    case "agent":
      await cmdAgent();
      break;
    case "task":
      await cmdTask(rest);
      break;
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      console.error(`❌ 未知命令: ${command}\n`);
      printUsage();
  }
}

main().catch((err) => {
  console.error(`\n❌ ${String(err)}`);
  process.exit(1);
});
