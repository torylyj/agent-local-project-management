# Goodname 数据模板说明（给 AI / Agent 参考）

面板需要三种数据：`projects`（项目）、`topics`（创作选题）、`monthly`（月度 Token）。
完整示例见同目录 [`data.example.json`](./data.example.json)。新手/AI 生成数据时：

1. 复制 `data.example.json` 为 `data.json`；
2. 把示例内容替换为真实内容（示例项目可整条删除）；
3. 运行 `node .../goodname-sync.js --file data.json --auto` 上传。

也可以直接用工具生成模板：`node .../goodname-sync.js --init --dir <工作目录>`（会生成带完整字段的 `data.json`）。

## projects（项目数组）

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| name | ✅ | 项目名称（同一名称 + source 会去重更新） |
| intro | ✅ | 项目简介/详情，面板详情页展示 |
| status | ✅ | `todo`(待启动) / `doing`(进行中) / `blocked`(阻塞) / `hold`(搁置) / `done`(已完成) |
| cat | ✅ | 分类：工程实验 / AI 应用 / 内容创作 / 工具脚本 / 研究报告 / 视频处理 / 基础设施 |
| progress | 否 | 完成度 0-100 |
| tokens | 否 | 该项目累计 Token |
| conv | 否 | 对话/会话次数 |
| date | 否 | 开始日期 `YYYY-MM-DD` |
| updated | 否 | 最近更新日期 `YYYY-MM-DD` |
| urgency | 否 | 紧急程度：0 普通 / 1 紧急 / 2 非常紧急 |
| source | 否 | 数据来源平台：`codex` / `workbuddy` / `cursor` / `dumate` / `qclaw` / `openclaw` / `other` |
| dir | 否 | 工作目录路径（用于显示来源设备/Agent） |
| milestones | 否 | 里程碑数组 `[{date:"YYYY-MM-DD", text:"描述", done:true/false}]` |
| next | 否 | 下一步建议数组：字符串，或 `{text, p:"high|mid|low"}` |
| criteria | 否 | 完成标准 `[{text, done:true/false}]` |
| files | 否 | 产出文件路径数组 |
| topics | 否 | 关联选题标题数组 |
| decisions | 否 | 决策日志 `[{date, title, reason, tags:[]}]` |

## topics（创作选题数组）

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| title | ✅ | 选题标题（按标题去重） |
| type | 否 | 选题类型，如 内容创作 / 短视频 / 图文 |
| desc | 否 | 选题简介 |
| project | 否 | 关联项目名称 |
| mark | 否 | `todo` / `doing` / `done` |
| platforms | 否 | 发布平台数组 |
| plan | 否 | 创作步骤：字符串，或 `{h:"小节标题"}` 对象 |

## monthly（月度 Token 数组）

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| year_month | ✅ | `YYYY-MM`（按 user+月份 去重更新） |
| tokens | ✅ | 当月 Token 总量 |
| cost_estimate | 否 | 当月成本估算（元） |

## 上传方式

```bash
node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --file ./data.json --auto
```

> 免密钥模式：先在面板生成安装码并执行 `--setup <安装码>`（30 分钟有效），之后 `--auto` 不再需要任何 API Key。
