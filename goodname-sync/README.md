# goodname-sync

零依赖 CLI：把本地**多 Agent 平台**的项目数据同步到 goodname.fun 项目管理面板。已内置适配：Codex、Cursor、WorkBuddy、百度搭子（DuMate）、QClaw、AutoClaw / OpenClaw。支持 macOS（LaunchAgent）与 Linux（systemd user unit）常驻服务：每 3 小时同步一次、失败自动重试、登录/开机自动补跑。

## 安装（交给 Agent 的安全指令）

把下面这条指令整体复制，粘贴给 WorkBuddy / Codex / 百度搭子 等任意 Agent 执行（把 `sk_xxx` 换成你的同步密钥）。它**不执行远程脚本、密钥不进命令**，只做「下载校验 → 写入本地配置 → 运行本地脚本」：

```text
请帮我配置 Goodname 同步（我的同步密钥：sk_xxx）。请按步骤执行，不要执行任何远程脚本：
1. 下载并校验同步工具（只下载解压，不运行远程代码）：
mkdir -p ~/.goodname/agent-sync && curl -fsSL https://goodname.fun/agent-sync/agent-sync.tar.gz -o /tmp/agent-sync.tar.gz && curl -fsSL https://goodname.fun/agent-sync/agent-sync.tar.gz.sha256 -o /tmp/agent-sync.tar.gz.sha256 && (cd /tmp && shasum -a 256 -c agent-sync.tar.gz.sha256) && tar -xzf /tmp/agent-sync.tar.gz -C ~/.goodname/agent-sync
2. 把密钥写入本地配置（只写本机文件，不要上传到任何远程服务）：
mkdir -p ~/.goodname && printf '{"sync_key":"sk_xxx"}\n' > ~/.goodname/config.json && chmod 600 ~/.goodname/config.json
3. 运行本地脚本安装常驻同步服务（源码在 ~/.goodname/agent-sync/src，可先审查）：
node ~/.goodname/agent-sync/bin/goodname-sync.js --service install
4. 执行首次同步：
node ~/.goodname/agent-sync/bin/goodname-sync.js --auto
```

这条指令满足安全审查的常见要求：没有 `curl | bash`、没有未知 npm 包、密钥只写入本机文件（权限 600）、安装的是本地可审查脚本的常驻服务（可随时 `--service uninstall` 卸载）。

> 提示：也可以在自己电脑的终端里手动完成同样的三步；官方一键脚本 `install.sh`（下载 → SHA-256 校验 → 交互输入密钥 → 装服务）仅供信任自己终端的人类用户使用，不推荐交给第三方 Agent 执行。

## 多 Agent 平台适配

工具会按顺序扫描以下目录，寻找面板兼容数据（`data.json` / `codex-project-tracker.html` / `项目进度总览.html` / `panel-data.json`）：

| 平台 | 扫描目录 | 说明 |
| --- | --- | --- |
| Codex | `~/.codex/visualizations`、`~/Documents/Codex` | 面板源文件直接读取 |
| Cursor | `~/.cursor`、`~/Documents/Cursor` | 面板兼容文件直接读取 |
| WorkBuddy | `~/.workbuddy` | **内置适配**：解析 `sessions.json` + `traces/*.json`，自动把会话聚合为项目（Token / 次数 / 时间 / 工作目录） |
| 百度搭子 DuMate | `~/.dumate`、`~/.du-mate`、`~/.baidu-dazhi`、`~/.baidu-dazi` | 发现面板兼容文件则读取 |
| QClaw | `~/.qclaw`、`~/.QClaw` | 发现面板兼容文件则读取 |
| AutoClaw / OpenClaw | `~/.openclaw`、`~/.autoclaw`、`~/.auto-claw` | 发现面板兼容文件则读取 |

任何平台只要在工作目录产出 `data.json`（`projects` / `topics` / `monthly` 结构），都可以用 `--dir <工作目录>` 指定同步；也可以把面板源文件复制到该平台工作区，工具会自动发现。

## 使用

安装前先完成：

1. 在 goodname.fun/progress 注册登录；
2. 右上角账号面板「生成同步密钥」；
3. 让**本机 Codex** 把密钥保存到 `~/.goodname/config.json`（不要粘贴进任何聊天）。

### 手动同步

```bash
node ~/.goodname/agent-sync/bin/goodname-sync.js --auto
node ~/.goodname/agent-sync/bin/goodname-sync.js --dry-run --verbose
node ~/.goodname/agent-sync/bin/goodname-sync.js --file /path/to/data.json
node ~/.goodname/agent-sync/bin/goodname-sync.js --dir /path/to/any-agent-workspace
```

### 常驻服务

```bash
node ~/.goodname/agent-sync/bin/goodname-sync.js --service install
node ~/.goodname/agent-sync/bin/goodname-sync.js --service status
node ~/.goodname/agent-sync/bin/goodname-sync.js --service uninstall
```

服务行为：

- 每 3 小时自动同步一次（可改环境变量 `PANEL_CLOUD_INTERVAL_HOURS`，仅 `--daemon` 模式生效）
- 失败后 10 分钟自动重试，不会死循环
- 电脑关机错过的时间点，开机/登录后立即补跑
- 进程崩溃自动拉起（macOS LaunchAgent / Linux systemd user unit）

日志：macOS `/tmp/goodname-agent-sync.log`。

## 密钥管理

密钥保存在 `~/.goodname/config.json`（本机专用，权限 600）。也可以设置环境变量 `CODEX_SYNC_KEY=sk_xxx` 临时指定。

## Agent 自动同步模式

```bash
# 自动模式：简洁输出，适合 Agent 调用（退出码 0 成功 / 1 失败）
node ~/.goodname/agent-sync/bin/goodname-sync.js --auto --verbose

# 查看云端同步状态（需先执行 fix_dynamic.sql 中的 get_sync_status 函数）
node ~/.goodname/agent-sync/bin/goodname-sync.js --status

# 监控数据目录变化，变化停止 5 秒后自动同步
node ~/.goodname/agent-sync/bin/goodname-sync.js --watch --verbose
```

Agent 触发词：用户说「帮我同步项目到 goodname」「更新一下我的 goodname 数据」「把当前项目同步到网页端」时，自动执行 `node ~/.goodname/agent-sync/bin/goodname-sync.js --auto --verbose` 并汇报结果。

## 数据来源

默认自动扫描上表所有 Agent 平台的本地数据目录；也可以直接指定 `data.json`（模板格式：`projects` / `topics` / `monthly`）。

## 上传内容

- 项目（含完整面板负载，`name` + `source` 去重，重复同步为更新）
- 创作选题（按 `title` 去重）
- 月度 Token 统计（成本按 $0.3/百万 token 估算）
- `--status` 可查询云端项目数 / 对话数 / Token 总量 / 上次同步时间

## 安全

- 数据库中只存密钥的 SHA-256 哈希，明文只在生成时显示一次
- 上传接口通过同步密钥鉴权，`user_id` 由服务端解析，调用方无法伪造
- anon key 是公开的，数据隔离由 Supabase RLS 行级安全保证
