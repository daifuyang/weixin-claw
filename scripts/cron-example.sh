#!/usr/bin/env bash
# weixin-claw crontab 示例
#
# 编辑 crontab: crontab -e
# 将以下内容添加到 crontab 中 (根据实际路径修改):

PROJECT_DIR="/Users/bytedance/workspce/ai/weixin-claw"

# ── 定时发送通知 ──

# 每天早上 9 点发送日报提醒
# 0 9 * * * cd $PROJECT_DIR && npx tsx src/cli/index.ts send --text "早安，今日待办已整理完毕"

# 每小时检查一次 (自定义消息)
# 0 * * * * cd $PROJECT_DIR && npx tsx src/cli/index.ts send --text "每小时巡检完成，一切正常"

# ── 执行命令并推送结果 ──

# 每小时通过 opencode 检查热点
# 0 * * * * cd $PROJECT_DIR && npx tsx src/cli/index.ts task --cmd "opencode run '总结最近一小时的热点新闻'"

# 每天早上 8 点跑 AI 日报
# 0 8 * * * cd $PROJECT_DIR && npx tsx src/cli/index.ts task --cmd "opencode run '生成今日工作日报'"

# 每 30 分钟盯后台数据
# */30 * * * * cd $PROJECT_DIR && npx tsx src/cli/index.ts task --cmd "opencode run '检查后台数据是否有异常'"

# ── 指定推送目标 ──
# 如果不设置 DEFAULT_NOTIFY_USER 环境变量，可以用 --to 参数指定
# 0 9 * * * cd $PROJECT_DIR && npx tsx src/cli/index.ts send --to "user123@im.wechat" --text "测试消息"
