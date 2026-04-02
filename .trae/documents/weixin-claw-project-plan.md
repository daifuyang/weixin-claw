# weixin-claw

独立的微信 clawbot 对话工具，用于通过微信发送消息通知、接收消息、执行定时任务。

## 定位

- **消息通知媒介**：作为定时任务（BullMQ / crontab）的消息推送通道
- **AI 任务集成**：配合 `opencode run` 执行 AI 任务，结果通过微信推送
- **模块化设计**：支持交互式（REPL）和编程式（crontab/BullMQ）两种使用方式

典型场景：盯后台数据、盯热点消息、盯订阅 → 通过微信推送提醒

## 前提条件

- Node.js >= 22（需要内置 `fetch` 支持）
- pnpm
- Redis（可选，BullMQ 任务队列需要）

## 快速开始

```bash
pnpm install

# 所有命令统一入口: pnpm wx <command>
# 首次运行任何命令都会自动弹出二维码扫码登录，无需手动 login

# 发送消息
pnpm wx send --to "user@im.wechat" --text "你好"

# 交互式监听消息
pnpm wx poll

# 执行命令并推送结果
pnpm wx task --cmd "opencode run '检查今日热点'" --to "user@im.wechat"
```

## 项目结构

```
weixin-claw/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── client/                 # 微信 API 客户端
│   │   ├── types.ts            #   协议类型定义
│   │   ├── api.ts              #   HTTP 请求封装 (GET/POST + headers + timeout)
│   │   ├── auth.ts             #   扫码登录 + 凭证持久化
│   │   └── index.ts            #   WeixinClient 类 (统一封装 login/poll/send)
│   ├── poller/                 # 消息轮询
│   │   └── index.ts            #   EventEmitter 模式，事件: message / error / expired
│   ├── notifier/               # 通知推送
│   │   └── index.ts            #   一行代码发微信通知: notify(text, { to })
│   ├── tasks/                  # BullMQ 任务队列
│   │   └── index.ts            #   createTaskQueue() / createTaskWorker()
│   └── cli/
│       └── index.ts            #   统一 CLI 入口 (login / send / poll / task)
└── scripts/
    └── cron-example.sh         # crontab 调用示例
```

## CLI 命令

统一入口：`pnpm wx <command> [options]`

所有命令在未登录时会**自动弹出二维码**扫码，无需手动先执行 login。

### `pnpm wx login`

主动扫码登录微信，凭证保存到 `~/.weixin-claw.json`。

### `pnpm wx send`

发送消息到指定用户。

```bash
pnpm wx send --to "user@im.wechat" --text "消息内容"
```

| 参数 | 说明 |
|------|------|
| `--to` | 目标用户 ID（可选，默认读取 `DEFAULT_NOTIFY_USER` 环境变量） |
| `--text` | 消息内容（必填） |

### `pnpm wx poll`

启动交互式消息监听 (REPL)。

| 输入 | 说明 |
|------|------|
| 文字 | 直接回复最近一条消息的发送者 |
| `@user123 你好` | 指定用户发送 |
| `/who` | 查看当前回复目标 |
| `/tokens` | 查看已缓存的 contextToken |
| `/quit` | 退出 |

### `pnpm wx task`

执行命令并将输出推送到微信。

```bash
pnpm wx task --cmd "opencode run '总结热点新闻'" --to "user@im.wechat"
```

| 参数 | 说明 |
|------|------|
| `--cmd` | 要执行的命令（必填） |
| `--to` | 目标用户 ID（可选） |
| `--timeout` | 命令超时时间，毫秒（默认 120000） |

## 编程式使用

### WeixinClient

```typescript
import { WeixinClient } from "./src/client/index.js";

const client = new WeixinClient();
await client.ensureLogin();  // 有凭证直接用，没有弹二维码
await client.send("user@im.wechat", "来自代码的消息");
```

### notify()

```typescript
import { notify } from "./src/notifier/index.js";

await notify("后台数据异常！请立即检查", { to: "user@im.wechat" });
```

### WeixinPoller (EventEmitter)

```typescript
import { WeixinClient } from "./src/client/index.js";
import { WeixinPoller } from "./src/poller/index.js";

const client = new WeixinClient();
const poller = new WeixinPoller(client);

poller.on("message", (msg) => {
  console.log(`收到消息: ${msg.from_user_id}`);
});
poller.on("expired", () => console.log("会话过期"));

poller.start();
```

### BullMQ 任务队列

```typescript
import { createTaskQueue, createTaskWorker } from "./src/tasks/index.js";

const queue = createTaskQueue();
await queue.add("daily-report", {
  type: "ai",
  cmd: "opencode run '生成日报'",
  to: "user@im.wechat",
});

const worker = createTaskWorker();
```

## Crontab 集成

```bash
# 每小时检查热点
0 * * * * cd /path/to/weixin-claw && npx tsx src/cli/index.ts task --cmd "opencode run '检查今日热点'"

# 每天早上 9 点发日报
0 9 * * * cd /path/to/weixin-claw && npx tsx src/cli/index.ts send --text "早安，今日待办已整理完毕"

# 每 30 分钟盯后台数据
*/30 * * * * cd /path/to/weixin-claw && npx tsx src/cli/index.ts task --cmd "opencode run '检查后台数据'"
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `WEIXIN_CREDENTIALS_PATH` | 凭证文件路径 | `~/.weixin-claw.json` |
| `DEFAULT_NOTIFY_USER` | 默认推送目标用户 | 无 |
| `REDIS_URL` | Redis 连接地址（BullMQ 用） | `redis://localhost:6379` |

## 凭证机制

1. 首次运行任何命令 → 自动弹出二维码 → 微信扫码 → 获取 `bot_token` → 保存到 `~/.weixin-claw.json`
2. 后续运行自动读取凭证文件，无需再次扫码
3. 凭证过期时（errcode=-14），需重新执行 `pnpm wx login`

凭证文件格式：

```json
{
  "token": "...",
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "accountId": "abc123@im.bot",
  "userId": "user456@im.wechat",
  "savedAt": "2026-04-02T15:43:54.000Z"
}
```

## 微信 API 协议

| 接口 | 方法 | 路径 | 用途 |
|------|------|------|------|
| 获取二维码 | GET | `/ilink/bot/get_bot_qrcode` | 登录用二维码 |
| 轮询扫码状态 | GET | `/ilink/bot/get_qrcode_status` | 等待扫码确认 |
| 拉取消息 | POST | `/ilink/bot/getupdates` | 长轮询获取新消息 |
| 发送消息 | POST | `/ilink/bot/sendmessage` | 发送文本消息 |

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
| 运行时 | Node.js >= 22 | 内置 fetch，与 sim.ts 保持一致 |
| 模块系统 | ESM | 与参考项目一致 |
| 任务队列 | BullMQ（可选） | 生产级任务调度 |
| CLI 参数 | Node.js `parseArgs` | 内置 API，零依赖 |
| contextToken | 内存 Map | 保证对话连贯 |
