# weixin-claw

独立的微信 clawbot AI 代理，通过微信收发消息、执行 AI 任务、管理定时任务和历史记忆。

## 定位

- **AI 代理**：配合 `opencode web` 执行 AI 任务，结果通过微信推送，支持多轮对话上下文
- **自然语言定时任务**：微信里说"帮我每天盯一下热点" → AI 识别意图并自动创建
- **历史记忆**：会话归档 + 按需加载，跨会话保持用户偏好
- **消息通知媒介**：支持 CLI 和编程式调用，适合 crontab 等场景

## 前提条件

- Node.js >= 22
- pnpm
- [opencode](https://github.com/opencode-ai/opencode)（AI 代理模式需要）

## 快速开始

```bash
pnpm install

# 1. 启动 opencode 服务（终端 1）
opencode web --port 4096

# 2. 启动 AI 代理（终端 2）
pnpm wx agent

# 其他命令
pnpm wx send --text "你好"       # 发送消息给自己
pnpm wx poll                      # 交互式监听消息
```

## PM2 部署

使用 pm2 可将 opencode web 和 weixin-claw agent 作为后台服务运行，支持自动重启和日志管理。

### 首次部署

```bash
# 安装 pm2（全局）
npm i -g pm2

# 构建项目
pnpm build

# 首次登录微信（获取凭证）
pnpm wx login

# 启动所有服务
pnpm pm2:start
```

### 日常管理

```bash
pnpm pm2:status              # 查看进程状态
pnpm pm2:logs                # 查看实时日志
pnpm pm2:restart              # 重启所有服务
pnpm pm2:stop                # 停止所有服务
```

### 更新代码后重启

```bash
git pull
pnpm install
pnpm build
pnpm pm2:restart
```

### 开机自启

```bash
pm2 startup                  # 生成系统启动脚本（按提示执行）
pnpm pm2:start               # 确保服务正在运行
pm2 save                     # 保存当前进程列表
```

### ecosystem.config.cjs

pm2 配置文件定义了两个进程：

| 进程 | 说明 | 重启策略 |
|------|------|---------|
| `opencode` | opencode web --port 4096 | 崩溃后 3s 自动重启，最多 10 次 |
| `weixin-claw` | dist/cli/index.js agent | 崩溃后 5s 自动重启，依赖 opencode |

## 项目结构

```
weixin-claw/
├── package.json
├── tsconfig.json
├── opencode.json                        # opencode agent 配置（角色 + subagent + 权限）
├── ecosystem.config.cjs                 # pm2 部署配置（opencode + weixin-claw）
├── .opencode/skills/
│   ├── weixin-assistant/SKILL.md        # 主 skill：意图路由 + 指令表 + 多轮引导
│   ├── weixin-format/SKILL.md           # 微信输出排版规范
│   ├── task-scheduler/SKILL.md          # 定时任务 + 提醒 ACTION
│   ├── memory-manager/SKILL.md          # 记忆管理 ACTION
│   └── project-navigator/SKILL.md       # 工作目录切换 ACTION
├── src/
│   ├── cli/
│   │   └── index.ts                     # 统一 CLI 入口 (login/send/poll/agent/task)
│   ├── client/
│   │   ├── types.ts                     # 协议类型定义
│   │   ├── api.ts                       # HTTP 请求封装
│   │   ├── auth.ts                      # 扫码登录 + 凭证持久化
│   │   └── index.ts                     # WeixinClient 类 (login/send/sendChunks/poll)
│   ├── opencode/
│   │   ├── client.ts                    # opencode web HTTP client
│   │   ├── runner.ts                    # 统一调用接口（创建会话 + 发消息 + 解析）
│   │   ├── parser.ts                    # ACTION 标签解析 + 错误友好化
│   │   └── index.ts                     # 统一导出
│   ├── poller/
│   │   └── index.ts                     # EventEmitter 消息轮询
│   ├── notifier/
│   │   └── index.ts                     # notify(text) 一行发微信通知
│   ├── session/
│   │   └── index.ts                     # 会话管理 + 记忆归档/加载
│   ├── scheduler/
│   │   └── index.ts                     # croner 定时任务调度 + 提醒
│   └── utils/
│       ├── md2wx.ts                     # Markdown → 微信友好排版转换
│       └── paths.ts                     # 统一路径管理 + 配置读取
```

## CLI 命令

统一入口：`pnpm wx <command> [options]`

### `pnpm wx agent`

AI 代理模式：监听微信消息 → `opencode web` 处理 → 自动回复。

**前提**：需要先启动 `opencode web --port 4096`，agent 启动时会检查连接。

**特性：**
- 每个用户独立会话上下文（多轮对话）
- 自然语言创建/取消定时任务、一次性提醒
- AI 意图识别加载历史记忆
- 长回复按板块拆分为多条微信消息
- Markdown 自动转微信友好排版
- 处理期间显示"正在输入..."状态
- 异步执行，不阻塞事件循环

**微信内可用指令：**

| 指令 | 别名 | 说明 |
|------|------|------|
| `/新会话` | `/new` | 归档当前对话并创建新会话 |
| `/新会话 路径` | `/new 路径` | 归档 + 切换到指定目录开始新会话 |
| `/任务` | `/tasks` | 查看定时任务列表 |
| `/记忆` | `/memory` | 查看历史记忆列表 |
| `/记忆 N` | `/memory N` | 加载第 N 条历史记忆 |
| `/会话` | `/sessions` | 查看所有会话记录 |
| `/cd 路径` | — | 切换 AI 工作目录 |
| `/pwd` | — | 查看当前工作目录 |

除指令外，也可用自然语言：
- "5分钟后提醒我开会" → 创建一次性提醒
- "帮我每天早上9点收集热点" → 创建定时任务
- "取消任务" → AI 列出任务让你选择
- "加载之前的对话" → AI 匹配并加载历史记忆
- "切换到XX目录" → 切换工作目录

### `pnpm wx send`

发送消息，默认发给登录账号自己。

```bash
pnpm wx send --text "消息内容"
pnpm wx send --to "other@im.wechat" --text "消息内容"
```

### `pnpm wx poll`

交互式消息监听 (REPL)。

### `pnpm wx login`

主动扫码登录微信。

### `pnpm wx task`

执行命令并推送结果到微信。

## 数据存储

```
~/.weixin-claw/                          # 数据目录（可通过 WEIXIN_CLAW_HOME 自定义）
├── config.json                          # 配置文件（debug 等）
├── credentials.json                     # 登录凭证（chmod 600）
├── sessions.json                        # userId → activeSessionId 映射
├── schedules.json                       # 定时任务列表
├── artifacts/                           # AI 产出文件（记录、报告等）
│   └── health/
│       └── 2026-04-03.md
└── {userId}/                            # 用户目录
    └── memory/                          # 历史记忆归档（/新会话 时 AI 生成总结）
        ├── 2026-04-03-13-08-热点新闻.md
        └── 2026-04-02-09-30-天气查询.md
```

运行时上下文文件：
```
.opencode/context.md                     # 动态用户上下文（记忆列表/任务列表等，AI 按需读取）
```

## 配置

配置文件位于 `~/.weixin-claw/config.json`：

```json
{
  "debug": true
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `debug` | boolean | `false` | 开启详细调试日志 |

环境变量：
- `WEIXIN_CLAW_HOME`：自定义数据目录路径
- `OPENCODE_URL`：opencode web 地址（默认 `http://127.0.0.1:4096`）
- `OPENCODE_SERVER_PASSWORD`：opencode web 认证密码

## AI 架构

### opencode.json

通过 `opencode.json` 配置 agent 角色和 subagent：

| Agent | 模式 | 用途 | 模型建议 |
|---|---|---|---|
| **default** | primary | 日常对话、复杂任务 | 主力模型 |
| **summarizer** | subagent | 会话归档总结 | 轻量模型（节省 token） |
| **scheduler** | subagent | 定时任务 + 提醒执行 | 轻量模型 |

### Skills

通过 `.opencode/skills/` 定义 AI 能力，每个 skill 单一职责，AI 按需加载：

| Skill | 职责 |
|---|---|
| `weixin-assistant` | 意图路由 + 指令表 + 多轮引导策略 |
| `weixin-format` | 微信消息排版规范 |
| `task-scheduler` | remind / schedule / cancel ACTION |
| `memory-manager` | memory ACTION + 加载策略 |
| `project-navigator` | cd ACTION + 目录切换 |

### ACTION 标签

| ACTION 标签 | 触发场景 |
|-------------|---------|
| `<!--ACTION:remind{...}-->` | 一次性延迟提醒 |
| `<!--ACTION:schedule{...}-->` | 周期性定时任务 |
| `<!--ACTION:cancel{...}-->` | 取消定时任务 |
| `<!--ACTION:memory{...}-->` | 加载历史记忆 |
| `<!--ACTION:cd{...}-->` | 切换工作目录 |

动态上下文通过 `.opencode/context.md` 传递，AI 按需读取，不污染 prompt。

## 编程式使用

### WeixinClient

```typescript
import { WeixinClient } from "./src/client/index.js";

const client = new WeixinClient();
await client.ensureLogin();
await client.send("user@im.wechat", "消息内容");
await client.sendChunks("user@im.wechat", ["第一条", "第二条"]);
```

### notify()

```typescript
import { notify } from "./src/notifier/index.js";

await notify("后台数据异常！请立即检查");
await notify("指定目标", { to: "other@im.wechat" });
```

### Scheduler

```typescript
import { addSchedule, startAllSchedules } from "./src/scheduler/index.js";
import { WeixinClient } from "./src/client/index.js";

const client = new WeixinClient();
addSchedule({
  cron: "0 9 * * *",
  prompt: "收集今日热点新闻",
  userId: "user@im.wechat",
  description: "每日热点",
});
startAllSchedules(client);
```

### opencode 调用

```typescript
import { runOpencode, parseActions, healthCheck } from "./src/opencode/index.js";

// 检查 opencode web 是否可用
const health = await healthCheck();
console.log(health.version, health.status);

// 执行 AI 任务（自动创建会话）
const result = await runOpencode("总结今日热点");
console.log(result.sessionId, result.text);

// 复用已有会话（多轮对话）
const result2 = await runOpencode("再详细说说第一条", {
  sessionId: result.sessionId,
});

// 使用 subagent（轻量模型）
const summary = await runOpencode("总结这段对话", { agent: "summarizer" });

// 提取 ACTION 标签
const { cleanText, actions } = parseActions(result.text);
```

## 凭证机制

1. 首次运行 → 自动弹出二维码 → 微信扫码 → 获取 `bot_token` → 保存到 `~/.weixin-claw/credentials.json`
2. 后续运行自动读取凭证，无需再次扫码
3. 凭证过期时需重新执行 `pnpm wx login`

## 微信 API 协议

| 接口 | 方法 | 路径 | 用途 |
|------|------|------|------|
| 获取二维码 | GET | `/ilink/bot/get_bot_qrcode` | 登录用二维码 |
| 轮询扫码状态 | GET | `/ilink/bot/get_qrcode_status` | 等待扫码确认 |
| 拉取消息 | POST | `/ilink/bot/getupdates` | 长轮询获取新消息 |
| 发送消息 | POST | `/ilink/bot/sendmessage` | 发送文本消息 |
| 获取配置 | POST | `/ilink/bot/getconfig` | 获取 typing_ticket |
| 输入状态 | POST | `/ilink/bot/sendtyping` | 显示/取消"正在输入..." |

## 技术选型

| 项目 | 选择 | 理由 |
|------|------|------|
| 运行时 | Node.js >= 22 | 内置 fetch |
| 模块系统 | ESM | 现代标准 |
| Markdown 转换 | marked | 自定义 renderer 转微信排版 |
| 定时调度 | croner | 轻量进程内 cron，零外部依赖 |
| CLI 参数 | Node.js `parseArgs` | 内置 API，零依赖 |
| 持久化 | JSON + Markdown | 轻量，无需数据库 |
