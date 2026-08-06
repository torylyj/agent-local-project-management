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

**v1.4 新增能力**：

- 全局搜索（⌘K）：项目 / 灵感 / 新闻 / 空对话 分组直达
- 看板视图：按状态分列（待启动 / 进行中 / 阻塞 / 搁置 / 已完成）
- 年份筛选 + 倒序时间线：只展示有内容的月份，项目按真实日期归位
- 紧急程度标记：卡片旗标一键切换，云端持久化
- 创作中心：灵感「想做 / 已做 / 放弃」标记、新闻收藏 / 已读
- 详细周报：复制内容 / 下载 .txt（沙箱 iframe 打印受限，不做 PDF 导出）
- JSON 导入 / 导出备份；顶部更新徽章；最近更新并入优先推进卡片
- 云端状态同步：状态 / 进度 / 紧急程度 / 灵感标记 / 新闻收藏统一走 `/api/state`
- 自动更新保障：全局 AGENTS.md 规则 + 活动监测看门狗 + 每日定时 / 开机补跑
- Token 用量自动回写：`update_tokens.py` 按 Codex 会话用量刷新项目 Token（含缓存输入）

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

- **v1.4**：沉淀实战经验——云端状态同步（`/api/state`）、三层自动更新保障（全局规则 / 看门狗 / 每日定时）、部署要点（R2 CORS、上传重试、绝对地址 fetch、CSP 注入）、已知坑（沙箱 iframe 无 localStorage、print 受限不做 PDF）、详细周报（复制 / 下载 txt）。面板侧新增全局搜索、看板、年份倒序时间线、紧急程度、灵感标记、新闻收藏、导入导出。
- **v1.3**：新增面向用户的 `SKILL.md` 说明文档，重写为详细教程（含快速开始、使用流程、维护约定、FAQ），并美化排版。
- **v1.2**：更名为「Agent本地项目管理」，数据源状态条支持手动关闭（关闭状态本地记忆）。
- **v1.1**：新增数据源状态栏（区分真实/示例数据）、schema 校验器 `validate.py`、本地编辑与数据文件的时间戳冲突处理、空状态引导、删除空对话撤销、完整数据导出（可回填）、完成标准评审字段 `review`、演示数据 `demo.json`。

## 九、云端同步与自动更新（v1.4 进阶）

模板默认本地数据驱动；若希望「修改状态跨设备保留」「任务收尾自动更新」，参考以下进阶配置（完整可复用描述见 `SKILL.md` 的「实战沉淀」章节）：

### 1. 本地 Hook 服务（云端状态同步）

```python
# 服务端（127.0.0.1:8787）提供：
# GET  /api/state  -> {"ok":true,"data":{urgency,topicMarks,newsFavs,newsRead,projects}}
# POST /api/state  -> 落盘 state.json
```

- `urgency`：`{项目id: 0|1|2}`
- `topicMarks`：`{选题: todo|done|skip}`
- `newsFavs / newsRead`：新闻收藏与已读
- `projects`：`{项目id: {status, progress}}`

页面加载：先请求 Hook 域名，失败回退静态 `state.json`；修改即 POST 同步。

### 2. 自动更新三层保障

1. **规则层**：`~/.codex/AGENTS.md`（全局）+ 工作区 `AGENTS.md` 写明「任务更新/收尾必须刷新面板」。
2. **看门狗层**：每 10 分钟扫描对话目录集合，发现新目录/产出且冷却结束（60 分钟）→ 自动完整更新。
3. **定时层**：每日 09:00 深度更新；关机错过则开机补跑。

### 3. 部署与避坑速查

- 页面内 JSON 请求一律用**绝对地址**（沙箱 iframe 相对路径 fetch 失效）。
- 静态托管需开 CORS（R2 用 `PutBucketCors` 配置 `Access-Control-Allow-Origin: *`）。
- 上传脚本逐对象**重试 3 次**（捕获全部异常）。
- 渲染后注入 favicon，并把 `connect-src` 补上 hook/静态域名。
- 沙箱 iframe 无 `localStorage`、`window.print()` 可能被拦截 → 持久化走云端、导出用复制/下载。

### 4. Token 绑定（防止「文档更新了、Token 还是旧的」）

`update_tokens.py` 读取 `~/.codex/sessions/**/*.jsonl` 的会话用量
（`payload.info.total_token_usage`），按会话工作目录归属到项目并回写 `tokens` 字段。
接入更新流程（每日定时 / 看门狗触发）后，每次更新文档时 Token 同步刷新。
口径：输入 + 缓存输入 + 缓存写入 + 输出 + 推理。

```bash
python3 update_tokens.py <面板源文件.html>
```
