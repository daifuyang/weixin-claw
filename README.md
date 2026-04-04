# weixin-claw

独立的微信 clawbot AI 代理，通过微信收发消息、执行 AI 任务、管理定时任务和历史记忆。

## 定位

- **AI 代理**：配合 `opencode run` 执行 AI 任务，结果通过微信推送，支持多轮对话上下文
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

# 所有命令统一入口: pnpm wx <command>
# 首次运行任何命令都会自动弹出二维码扫码登录

# AI 代理模式（核心功能）
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
├── .opencode/skills/weixin-assistant/
│   └── SKILL.md                         # AI 能力定义（意图识别 + ACTION 标签）
├── src/
│   ├── cli/
│   │   └── index.ts                     # 统一 CLI 入口 (login/send/poll/agent/task)
│   ├── client/
│   │   ├── types.ts                     # 协议类型定义
│   │   ├── api.ts                       # HTTP 请求封装
│   │   ├── auth.ts                      # 扫码登录 + 凭证持久化
│   │   └── index.ts                     # WeixinClient 类 (login/send/sendChunks/poll)
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

AI 代理模式：监听微信消息 → `opencode run` 处理 → 自动回复。

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
| `/任务` | `/tasks` | 查看定时任务列表 |
| `/记忆` | `/memory` | 查看历史记忆列表 |
| `/记忆 N` | `/memory N` | 加载第 N 条历史记忆 |
| `/会话` | `/sessions` | 查看所有会话记录 |

除指令外，也可用自然语言：
- "5分钟后提醒我开会" → 创建一次性提醒
- "帮我每天早上9点收集热点" → 创建定时任务
- "取消任务" → AI 列出任务让你选择
- "加载之前的对话" → AI 匹配并加载历史记忆

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

## AI 能力（Skills）

通过 `.opencode/skills/weixin-assistant/SKILL.md` 定义 AI 能力，使用 ACTION 标签触发系统操作：

| ACTION 标签 | 触发场景 |
|-------------|---------|
| `<!--ACTION:remind{...}-->` | 一次性延迟提醒 |
| `<!--ACTION:schedule{...}-->` | 周期性定时任务 |
| `<!--ACTION:cancel{...}-->` | 取消定时任务 |
| `<!--ACTION:memory{...}-->` | 加载历史记忆 |

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
