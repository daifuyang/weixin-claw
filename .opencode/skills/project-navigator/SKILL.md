---
name: project-navigator
description: 切换 AI 工作目录，通过 ACTION 标签触发
---

## 切换工作目录

当用户说"切换到XX目录"、"进入XX文件夹"、"cd XX"、"打开XX项目"等想要切换当前工作目录时，在回复末尾添加：

```
<!--ACTION:cd{"path":"目标路径"}-->
```

## 路径规则

- 支持绝对路径：`/home/user/projects/xxx`
- 支持相对路径：`../other-project`
- "回到上级目录" → `..`
- "回到主目录" → `~`
- 路径不明确时先追问具体路径

## 上下文

当前工作目录记录在 `.opencode/context.md` 中，按需读取。
