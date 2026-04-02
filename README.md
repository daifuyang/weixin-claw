# weixin-claw

独立的微信 clawbot 对话工具，用于通过微信发送消息通知、接收消息、执行 AI 任务、创建定时任务。

## 定位

- **AI 代理**：配合 `opencode run` 执行 AI 任务，结果通过微信推送，支持多轮对话上下文
- **自然语言定时任务**：微信里说"帮我每天盯一下热点" → 自动创建定时任务
- **消息通知媒介**：支持 CLI 和编程式调用，适合 crontab 等场景

典型场景：盯后台数据、盯热点消息、盯订阅 → 通过微信推送提醒

## 前提条件

- Node.js >= 22（需要内置 `fetch` 支持）
- pnpm

## 快速开始

```bash
pnpm install

# 所有命令统一入口: pnpm wx <command>
# 首次运行任何命令都会自动弹出二维码扫码登录，无需手动 login

# AI 代理模式（核心功能）：收到消息 → opencode 处理 → 自动回复
pnpm wx agent

# 发送消息给自己
pnpm wx send --text "你好"

# 交互式监听消息
pnpm wx poll
```

## 项目结构

```
weixin-claw/
├── package.json
├── tsconfig.json
├── src/
│   ├── client/                 # 微信 API 客户端
│   │   ├── types.ts            #   协议类型定义（含 TypingStatus）
│   │   ├── api.ts              #   HTTP 请求封装 (GET/POST + headers + timeout)
│   │   ├── auth.ts             #   扫码登录 + 凭证持久化
│   │   └── index.ts            #   WeixinClient 类 (login/send/poll/startTyping)
│   ├── poller/                 # 消息轮询
│   │   └── index.ts            #   EventEmitter 模式，事件: message / error / expired
│   ├── notifier/               # 通知推送
│   │   └── index.ts            #   一行代码发微信通知: notify(text, { to? })
│   ├── session/                # 会话管理
│   │   └── index.ts            #   userId→sessionId 映射 + 对话存档 (chat.md)
│   ├── scheduler/              # 定时任务调度
│   │   └── index.ts            #   croner 驱动，JSON 持久化，进程内调度
│   └── cli/
│       └── index.ts            #   统一 CLI 入口 (login/send/poll/agent)
└── scripts/
    └── cron-example.sh         # crontab 调用示例
```

## CLI 命令

统一入口：`pnpm wx <command> [options]`

所有命令在未登录时会**自动弹出二维码**扫码，无需手动先执行 login。

### `pnpm wx agent`

AI 代理模式：监听微信消息 → 交给 `opencode run` 处理 → 自动回复结果。

**特性：**
- 每个用户独立维护会话上下文（多轮对话）
- 自然语言创建定时任务（"帮我每天9点收集热点"）
- 处理期间显示"正在输入..."状态
- 回复超过 4000 字自动截断
- agent 启动时自动加载所有已保存的定时任务

**微信内可用指令：**

| 指令 | 效果 |
|------|------|
| 普通消息 | opencode 处理并回复（自动续接上下文） |
| 包含"每天/每小时/帮我盯"等 | 自动识别为定时任务，解析并创建 |
| `/new` | 重置会话，下条消息开始全新对话 |
| `/sessions` | 列出本用户所有历史会话 |
| `/tasks` | 列出本用户所有定时任务 |
| `/cancel <id>` | 取消指定定时任务 |

**定时任务意图关键词：**
`每天` `每日` `每周` `每月` `每小时` `每隔` `定时` `定期` `提醒我` `帮我盯` `帮我监控` `帮我关注`

**定时任务示例：**

```
微信发: "帮我每天早上9点收集热点新闻"
→ 系统解析: cron="0 9 * * *", prompt="收集今日热点新闻"
→ 回复: "✅ 定时任务已创建！ #1 每天09:00 收集今日热点新闻"
→ 每天 09:00 自动执行 opencode run → 结果推送回微信
```

### `pnpm wx login`

主动扫码登录微信，凭证保存到 `~/.weixin-claw.json`。

### `pnpm wx send`

发送消息，默认发给登录账号自己（凭证中的 `userId`）。

```bash
pnpm wx send --text "消息内容"
pnpm wx send --to "other@im.wechat" --text "消息内容"
```

| 参数 | 说明 |
|------|------|
| `--text` | 消息内容（必填） |
| `--to` | 目标用户 ID（可选，默认发给自己） |

### `pnpm wx poll`

启动交互式消息监听 (REPL)。

| 输入 | 说明 |
|------|------|
| 文字 | 直接回复最近一条消息的发送者 |
| `@user123 你好` | 指定用户发送 |
| `/who` | 查看当前回复目标 |
| `/tokens` | 查看已缓存的 contextToken |
| `/quit` | 退出 |

## 编程式使用

### WeixinClient

```typescript
import { WeixinClient } from "./src/client/index.js";

const client = new WeixinClient();
await client.ensureLogin();            // 有凭证直接用，没有弹二维码
await client.send("user@im.wechat", "来自代码的消息");

// 显示"正在输入..."，返回 stopTyping 函数
const stopTyping = await client.startTyping("user@im.wechat");
// ... 处理中 ...
await stopTyping();                    // 取消"正在输入..."
```

### notify()

```typescript
import { notify } from "./src/notifier/index.js";

// 不传 to，默认发给自己（凭证中的 userId）
await notify("后台数据异常！请立即检查");
await notify("指定目标", { to: "other@im.wechat" });
```

### WeixinPoller (EventEmitter)

```typescript
import { WeixinClient } from "./src/client/index.js";
import { WeixinPoller, extractText } from "./src/poller/index.js";

const client = new WeixinClient();
const poller = new WeixinPoller(client);

poller.on("message", (msg) => {
  const text = extractText(msg);        // 提取纯文本内容
  console.log(`收到: ${text}`);
});
poller.on("expired", () => console.log("会话过期"));

poller.start();
```

### Scheduler

```typescript
import { addSchedule, startAllSchedules } from "./src/scheduler/index.js";
import { WeixinClient } from "./src/client/index.js";

const client = new WeixinClient();

// 创建定时任务
addSchedule({
  cron: "0 9 * * *",
  prompt: "收集今日热点新闻",
  userId: "user@im.wechat",
  description: "每日热点",
});

// 启动所有定时任务
startAllSchedules(client);
```

## Crontab 集成

```bash
# 每小时检查热点
0 * * * * cd /path/to/weixin-claw && npx tsx src/cli/index.ts send --text "$(opencode run '检查今日热点')"

# 每天早上 9 点发日报
0 9 * * * cd /path/to/weixin-claw && npx tsx src/cli/index.ts send --text "早安，今日待办已整理完毕"
```

## 数据存储

```
~/.weixin-claw.json                                 # 登录凭证

~/weixin-claw/
├── sessions.json                                   # userId → activeSessionId 映射
├── schedules.json                                  # 定时任务列表
├── o9cq800rQXEnyWlFfRNzXYA5j80w@im.wechat/        # 用户目录
│   └── ses_2b2a55bf8ffeZFsCloyH440iku/             # 会话目录
│       └── chat.md                                 # Markdown 格式对话记录
```

## 凭证机制

1. 首次运行任何命令 → 自动弹出二维码 → 微信扫码 → 获取 `bot_token` → 保存到 `~/.weixin-claw.json`
2. 后续运行自动读取凭证文件，无需再次扫码
3. 凭证过期时（errcode=-14），需重新执行 `pnpm wx login`

## 微信 API 协议

| 接口 | 方法 | 路径 | 用途 |
|------|------|------|------|
| 获取二维码 | GET | `/ilink/bot/get_bot_qrcode` | 登录用二维码 |
| 轮询扫码状态 | GET | `/ilink/bot/get_qrcode_status` | 等待扫码确认 |
| 拉取消息 | POST | `/ilink/bot/getupdates` | 长轮询获取新消息 |
| 发送消息 | POST | `/ilink/bot/sendmessage` | 发送文本消息 |
| 获取配置 | POST | `/ilink/bot/getconfig` | 获取 typing_ticket |
| 输入状态 | POST | `/ilink/bot/sendtyping` | 显示/取消"正在输入..." |

请求头：

```
Content-Type: application/json
AuthorizationType: ilink_bot_token
Authorization: Bearer <token>
X-WECHAT-UIN: <random base64>
```

## 技术选型

| 项目 | 选择 | 理由 |
|------|------|------|
| 运行时 | Node.js >= 22 | 内置 fetch |
| 模块系统 | ESM | 现代标准 |
| 定时调度 | croner | 轻量进程内 cron，零外部依赖 |
| CLI 参数 | Node.js `parseArgs` | 内置 API，零依赖 |
| 会话/任务持久化 | JSON + Markdown | 轻量，无需数据库 |
