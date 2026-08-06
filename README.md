# Agent本地项目管理 · 模板与制作流程

本目录是一套**通用模板**，不含任何真实业务数据。页面里展示的统计、时间线、选题、新闻全部来自 `data.json`——由使用方的本地 Agent 扫描自己的对话目录后填写，填好后刷新页面即可实时更新。本模板不包含任何部署配置，是否上线由使用方自行决定。

## 一、这个页面是什么

一个单文件静态面板（HTML + CSS + JS），让本地 Agent 把散落的对话自动合并成「项目」视图，包含：

- 顶部统计：已完成 / 进行中 / 已归档对话 / 累计 Token
- Token 月度消耗柱状图
- 本周优先推进清单（可勾选完成）
- 按月时间线：点击项目卡片展开「项目介绍 / 完成标准 / 产出文件 / 项目时间线 / 推进建议」
- 创作选题参考 + 每日灵感（按日期轮换）+ AI 新闻快讯
- 状态与完成度可直接修改，自动保存到浏览器本地
- 无产出的空对话可一键删除

## 二、制作流程（蒸馏后的 7 步）

1. **扫描对话目录**：遍历本地 Agent 工作区（如 `Documents/Codex/<日期>/<会话>`），读取每个会话的 `outputs/` 或产出文件，判断该对话实际做了什么。
2. **合并成项目**：把主题相关的多个对话归为同一个项目，记录：名称、开始日期、月份、分类、对话数、状态、进度、累计 Token、更新时间。
3. **写完成标准**：为每个项目定义「100% 的定义」（`criteria`）。标准未全部达成的项目一律不算完成——严格标准，宁可低估。
4. **建模时间线与建议**：`milestones`（已完成/待完成）、`next`（下一步推进建议，带高/中/低优先级）、`files`/`dir`（产出位置）。
5. **填写数据文件**：把扫描结果写入 `data.json`（结构见下）。`data.example.json` 是空白模板，直接复制改名即可。
6. **渲染与交互**：`template.html` 读取 `data.json` 自动渲染全部内容，无需改页面代码；支持点击展开、编辑状态/进度、删除空对话、选题展开、新闻展示。
7. **维护约定**：每次任务**更新或收尾**时，由本地 Agent 刷新 `data.json` ——这是面板保持实时有效的关键一步。

## 三、数据口径（先约定，再填数）

- **扫描范围**：默认扫描 `Documents/Codex/<日期>/<会话>` 及其 `outputs/`；目录为空、没有产出文件且无有效记录的会话归入 `empty`（空对话），不构成项目。
- **Token 口径**：项目 `tokens` 取该会话累计消耗（含缓存输入），以 Codex 会话统计为准；多对话项目求和，归档对话另计在 `archivedTokens`。
- **完成标准评审**：每个项目可带 `review` 字段，`agent_draft`（Agent 自评，待用户确认）/ `user_confirmed`（用户已确认）。未确认前不应标 100%。
- **更新触发器**：三种情况必须刷新 `data.json`——① 对话产生新产出文件；② 用户明确要求；③ 每周固定复盘。

## 四、校验环节（提交前必跑）

仓库提供校验器 [validate.py](validate.py)，Agent 每次改完 `data.json` 后执行：

```bash
python3 validate.py data.json
```

通过标准：**0 个错误**（警告可忽略，但应尽量清零）。校验器会检查：

- JSON 可解析；顶层字段 `updated / months / projects / topics / news` 齐全
- 项目必填字段完整；`id` 全局唯一；`status` ∈ done/doing/todo/hold；`progress` ∈ 0-100；`tokens` 为数字
- `month` 下标不越界（对应 `months` 数组）；`review` ∈ agent_draft/user_confirmed
- `milestones` 含 date/text/done；`next` 含 text 且优先级 p ∈ high/mid/low；`criteria` 含 done/text
- `empty` 的 id 唯一、month 不越界；`news` 的 url 为 http(s) 链接

页面侧同样有兜底：数据加载失败时会明确显示「示例数据」警示条，不会静默展示错误数据。

## 五、数据 schema（data.json）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| templateVersion | string | 模板版本号，如 `"1.1"` |
| updated | string | 数据更新时间，如 `"08-06"` |
| updatedAt | string | 数据更新的 ISO 时间，如 `"2026-08-06T10:00:00+08:00"`（用于判断本地编辑与数据文件谁更新） |
| pageTitle | string | 页面标题 |
| subtitle | string | 页面副标题 |
| months | string[] | 月份标签，如 `["5月","6月","7月","8月"]` |
| archivedTokens | number | 已归档对话的 Token 总量 |
| projects | Project[] | 项目数组 |
| current | Project \| null | 当前正在进行的项目（可空） |
| empty | Empty[] | 无产出的空对话 |
| topics | Topic[] | 创作选题 |
| news | News[] | AI 新闻 `{date, source, title, url}` |

**Project 字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 唯一标识，如 `"p1"` |
| name | string | 项目名称 |
| date / month | string / number | 开始日期与月份下标（对应 months） |
| cat | string | 分类，自动分配颜色 |
| conv | number | 归属对话数 |
| status | string | `done` / `doing` / `todo` / `hold` |
| progress | number | 完成度 0-100 |
| tokens | number | 该项目累计 Token |
| updated | string | 最近更新时间 |
| review | string | 完成标准评审：`agent_draft` / `user_confirmed`（可空） |
| intro | string | 项目介绍 |
| milestones | {date,text,done}[] | 项目时间线 |
| next | {text,p}[] | 推进建议，p 为 high/mid/low |
| criteria | {done,text}[] | 完成标准（100% 的定义） |
| files / dir | string[] / string | 产出文件与目录 |

## 六、给本地 Agent 的维护指令（可直接放进 AGENTS.md）

> 每次任务更新或收尾时，扫描工作区对话目录，对照 `data.json` 的 schema，更新受影响项目的状态、进度、里程碑与下一步建议，然后运行 `python3 validate.py data.json` 确认 0 错误后保存。页面刷新即可看到最新数据，无需部署。

## 七、本地预览

1. 把 `data.example.json` 复制为 `data.json`，按真实扫描结果填写。
2. 想先看完整效果：直接把 `demo.json` 复制为 `data.json`（内置多项目、选题、新闻的演示数据，已通过校验）。
3. 直接双击打开 `template.html`：会显示内置示例数据，并出现醒目的「示例数据」警示条。
4. 要看到 `data.json` 的真实数据，请在本目录启动本地服务后访问：`python3 -m http.server 8000` → `http://localhost:8000`（浏览器禁止 `file://` 下跨文件读取，必须走 http）。

## 八、版本记录

- **v1.2**：更名为「Agent本地项目管理」，数据源状态条支持手动关闭（关闭状态本地记忆）。
- **v1.1**：新增数据源状态栏（区分真实/示例数据）、schema 校验器 `validate.py`、本地编辑与数据文件的时间戳冲突处理、空状态引导、删除空对话撤销、完整数据导出（可回填）、完成标准评审字段 `review`、演示数据 `demo.json`。
