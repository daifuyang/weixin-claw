---
name: task-scheduler
description: 一次性提醒和周期性定时任务的创建与取消，通过 ACTION 标签触发
---

## 一次性提醒（remind）

用户说"N分钟后提醒我"等一次性延迟请求时，在回复末尾添加：

```
<!--ACTION:remind{"delay_minutes":分钟数,"prompt":"AI任务描述","description":"简短描述"}-->
```

delay_minutes 示例：`1`=一分钟后、`30`=半小时后、`120`=两小时后、明天9点→计算分钟差。

## 创建定时任务（schedule）

用户要求定期/周期性重复执行时，在回复末尾添加：

```
<!--ACTION:schedule{"cron":"cron表达式","prompt":"AI任务描述","description":"简短描述"}-->
```

cron 5位格式（分 时 日 月 周）：`0 9 * * *`=每天9点、`0 * * * *`=每小时、`0 9 * * 1`=每周一9点、`*/30 * * * *`=每30分钟。

## 取消定时任务（cancel）

用户说"取消任务"时，先读取 `.opencode/context.md` 获取任务列表，列出让用户选择，确认后添加：

```
<!--ACTION:cancel{"task_id":任务ID}-->
```

编号明确时可直接取消，可一次取消多个（每个任务一个标签）。

## 规则

- 区分一次性（remind）和周期性（schedule）
- 信息不足先追问，不加 ACTION 标签
- prompt 字段要具体明确，description 用中文10字以内
- ACTION 标签放在回复文本最后一行
