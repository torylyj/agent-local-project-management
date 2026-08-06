---
slug: agent-local-project-management
version: 1.3.0
displayName: Agent 本地项目管理
summary: 让本地 Agent 把散落的对话自动整理成项目管理面板：扫描对话目录 → 填写 data.json → 自动渲染统计、时间线与选题，附校验器与完整使用文档。
description: 数据驱动的项目管理模板。本地 Agent 扫描自己的对话目录，按 schema 填写 data.json，页面自动渲染项目统计、Token 月度消耗、项目时间线（点击卡片展开介绍/完成标准/推进建议/产出文件）、创作选题与 AI 新闻。内置 validate.py 校验器、数据源状态条、删除撤销、空状态引导、多端适配与深色模式。维护约定：每次任务更新或收尾时由 Agent 同步刷新 data.json，页面刷新即更新。开箱即用：demo.json 可预览完整效果，data.example.json 是空白模板。
tags: [project-management, agent, dashboard, template, data-driven, productivity]
license: MIT
homepage: https://github.com/torylyj/agent-local-project-management
---

# 🗂️ Agent 本地项目管理

一个**数据驱动的项目管理模板**：让本地 AI Agent 把散落在各个对话里的工作，自动整理成一张清晰的项目管理面板。

你只需要做一件事——让 Agent 扫描对话目录、把结果写进 `data.json`；页面会自动生成统计、时间线、选题和新闻，刷新即可更新，完全不需要改页面代码。

---

## 🎯 这个技能解决什么问题

- 对话太多、项目进度混乱，不知道每个项目做到哪一步
- 项目「完成度」没有标准，无法判断是否真正闭环
- 想让 Agent 每次任务收尾时**自动维护**一份项目视图，而不是人工整理

## ✅ 适合谁用

- 日常使用 AI 对话完成多个项目、需要跟踪进度的个人用户
- 想给本地 Agent 建立「项目归集 + 进度维护」习惯的开发者

---

## 🚀 快速开始（3 步）

```bash
# 1. 复制空模板为你的数据文件
cp data.example.json data.json

# 2. 用演示数据先看效果（可选）
cp demo.json data.json

# 3. 启动本地服务，打开面板
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000
```

> ⚠️ 注意：直接双击 `template.html` 只会显示**示例数据**（页面顶部有橙色警示条）。真实数据必须通过 http 服务访问，因为浏览器禁止 `file://` 下读取 `data.json`。

---

## 📖 详细使用流程

### 第 1 步：扫描对话目录

让 Agent 遍历工作区（如 `Documents/Codex/<日期>/<会话>`），读取每个会话的 `outputs/` 或产出文件，判断这个对话实际做了什么。**没有产出的空会话**归入 `empty`，不计入项目。

### 第 2 步：合并成项目

把主题相关的多个对话归为一个项目，记录：名称、开始日期、月份、分类、状态、进度、Token、更新时间、里程碑、完成标准、推进建议、产出文件。

### 第 3 步：写完成标准

为每个项目定义「100% 的定义」（`criteria`）。**标准未全部达成的项目一律不算完成**——严格标准，宁可低估。可用 `review` 字段标记完成标准是否已由用户确认。

### 第 4 步：填写数据

把扫描结果写入 `data.json`（结构见 [README.md](README.md) 的 schema 表）。字段填错会导致页面显示异常，所以第 5 步很重要。

### 第 5 步：运行校验器

```bash
python3 validate.py data.json
```

必须输出 **0 个错误** 才算合格。校验器会检查：必填字段、id 唯一、状态枚举、进度范围、月份下标、优先级、新闻链接等。

### 第 6 步：打开面板

启动本地服务访问页面，即可看到：

| 模块 | 说明 |
| --- | --- |
| 顶部统计 | 已完成 / 进行中 / 已归档 / 累计 Token |
| Token 月度消耗 | 按月柱状图 |
| 本周优先推进 | 高优先级事项清单，可勾选完成 |
| 项目时间线 | 按月分组，点击卡片展开介绍、完成标准、时间线、推进建议、产出文件 |
| 创作选题 | 选题列表 + 每日灵感（每日轮换）+ AI 新闻 |

---

## 🔄 维护约定（重点）

**每次任务更新或收尾时，由 Agent 执行：**

1. 扫描工作区，找出受影响的对话
2. 更新 `data.json` 中对应项目的状态 / 进度 / 里程碑 / 下一步建议
3. 运行 `python3 validate.py data.json` 确认 0 错误
4. 保存 `data.json`（页面刷新即更新，无需重新部署）

> 这条约定可以直接写进项目的 `AGENTS.md`，让 Agent 每次收尾自动维护面板。

---

## ❓ 常见问题

**Q：打开页面显示橙色「示例数据」警示条？**
说明 `data.json` 没被读到。检查：① 文件是否已创建；② 是否通过 `python3 -m http.server` 访问而不是直接双击。

**Q：页面数据不是我改的内容？**
本地编辑会带时间戳；如果 `data.json` 的 `updatedAt` 更新，页面会以数据文件为准，避免旧修改覆盖新数据。

**Q：删除空对话后想恢复？**
删除后 6 秒内点 toast 上的「撤销」即可。

**Q：如何发布到线上？**
面板是纯静态文件，可部署到任意静态托管（GitHub Pages / Cloudflare R2 / Vercel 等），同时上传 `template.html`、`data.json` 即可。

---

## 📁 文件清单

| 文件 | 用途 |
| --- | --- |
| `SKILL.md` | 本说明文档 |
| `template.html` | 面板页面（v1.3，数据驱动） |
| `validate.py` | data.json 校验器 |
| `data.example.json` | 空白数据模板 |
| `demo.json` | 完整演示数据 |
| `README.md` | 制作流程蒸馏 + 数据口径 + 版本记录 |
