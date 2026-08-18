# goodname-sync

零依赖 CLI：把本地**多 Agent 平台**的项目数据同步到 goodname.fun 项目管理面板。已内置适配：Codex、Cursor、WorkBuddy、百度搭子（DuMate）、QClaw、AutoClaw / OpenClaw。支持 macOS（LaunchAgent）、Linux（systemd user unit）与 Windows（计划任务）常驻服务：每 3 小时同步一次、失败自动重试、登录/开机自动补跑。

## 安装（交给 Agent 的安全指令）

官方源码仓库（可验证来源）：<https://github.com/torylyj/agent-local-project-management>（工具在 `goodname-sync/` 目录）。

把下面这条指令整体复制，粘贴给 WorkBuddy / Codex / 百度搭子 等任意 Agent 执行（把 `sk_xxx` 换成你的同步密钥）。它从 GitHub 官方仓库克隆 → 先审查源码 → 写本地配置 → **一次性同步（默认不装常驻服务）**：

```text
请帮我配置 Goodname 同步。官方仓库（可验证）：https://github.com/torylyj/agent-local-project-management（工具在 goodname-sync/ 目录，源码可审查）。请先审查源码再执行，不要执行任何未知来源的脚本。我的同步密钥：sk_xxx
1. 从 GitHub 官方仓库克隆同步工具（只下载，不执行）：
git clone --depth 1 https://github.com/torylyj/agent-local-project-management.git ~/.goodname/agent-sync
2. 审查源码：打开 ~/.goodname/agent-sync/goodname-sync/src/ 查看 index.js / service.js / uploader.js / scanner.js 等全部实现
3. 把密钥写入本地配置（只写本机文件，不要上传到任何远程服务）：
mkdir -p ~/.goodname && printf '{"sync_key":"sk_xxx"}\n' > ~/.goodname/config.json && chmod 600 ~/.goodname/config.json
4. 运行一次性同步（不安装任何常驻服务）：
node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --auto
5.（可选）审查通过后再决定是否安装每 3 小时自动同步的常驻服务；随时可用 --service uninstall 卸载：
node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --service install
```

这条指令满足安全审查的常见要求：来源是公开 GitHub 仓库（可核对作者与提交历史）、先审查再执行、密钥只写入本机文件（权限 600）、**默认不安装常驻服务**（装服务是最后可选项且可卸载）。

## 免密钥模式（推荐）

不再使用 API Key：在 goodname.fun 面板右上角「账号与同步密钥」点「生成安装码」（30 分钟有效、仅可使用一次），把码交给 Agent 执行一条命令即可完成「授权 + 定时服务 + 首次同步」：

```bash
node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --setup <安装码> --service install --auto
```

如果 Agent 拒绝安装常驻服务，去掉 `--service install` 只做一次性同步：

```bash
node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --setup <安装码> --auto
```

`--setup` 会用安装码在服务端换一个 30 天有效的设备令牌并保存到本地配置（权限 600），之后同步完全不需要任何 API Key；设备令牌可在面板随时吊销。数据库侧需要先执行一次 `supabase/device_auth.sql`（建表 + RPC：create_device_code / exchange_device_code / upsert_*_token）。

## Windows 使用

方式一：一键脚本（Windows 10 1803+ 自带 `tar`），右键「使用 PowerShell 运行」或：

```powershell
# 免密钥模式（推荐）：下载 → SHA-256 校验 → 安装码授权 → 计划任务 → 首次同步
powershell -ExecutionPolicy Bypass -File install.ps1 -SetupCode <安装码>

# 旧版同步密钥模式
powershell -ExecutionPolicy Bypass -File install.ps1 -Key sk_xxx
```

方式二：手动分步（PowerShell）：

```powershell
git clone --depth 1 https://gitee.com/goodname13/agent-goodname-project-management.git "$env:USERPROFILE\.goodname\agent-sync"
node "$env:USERPROFILE\.goodname\agent-sync\goodname-sync\bin\goodname-sync.js" --setup <安装码> --auto
node "$env:USERPROFILE\.goodname\agent-sync\goodname-sync\bin\goodname-sync.js" --service install
```

`--service install` 在 Windows 会创建系统计划任务（登录后自动运行常驻同步，每 3 小时 + 失败重试 + 开机补跑，普通用户无管理员权限时自动降级重试）；卸载用 `--service uninstall`。Windows 日志写入 `%LOCALAPPDATA%\goodname\agent-sync.log`。

## Agent 平台检测与未知平台上传

```bash
# 检测本机已安装哪些 Agent 平台
node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --detect

# 未知平台：生成 data.json 上传模板，让 Agent 填写后上传
node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --init --dir <工作目录>
node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --file <工作目录>/data.json --auto
```

> 提示：也可以在自己电脑的终端里手动完成同样的步骤；官方一键脚本 `install.sh`（下载 → SHA-256 校验 → 交互输入密钥 → 装服务）仅供信任自己终端的人类用户使用，不推荐交给第三方 Agent 执行。

## 国内镜像（Gitee）

GitHub 在大陆网络下 clone 可能较慢。官方维护 Gitee 镜像仓库（免费、需实名注册，开源中国旗下，安全可靠）：

```bash
git clone --depth 1 https://gitee.com/goodname13/agent-goodname-project-management.git ~/.goodname/agent-sync
```

克隆后其余步骤（审查源码 / 写配置 / 一次性同步 / 可选装服务）与 GitHub 方式完全一致。镜像与 GitHub 官方仓库内容保持同步，两者任选其一。

> 其他可选国内镜像渠道（按安全性排序）：AtomGit（开源托管）、Coding（腾讯旗下 DevOps）、腾讯云 COS / 阿里云 OSS 默认域名（对象存储直链，无需备案即可公开下载）。不推荐使用 ghproxy 等第三方代理。

## 多 Agent 平台适配

工具会按顺序扫描以下目录，寻找面板兼容数据（`data.json` / `codex-project-tracker.html` / `项目进度总览.html` / `panel-data.json`）：

| 平台 | 扫描目录 | 说明 |
| --- | --- | --- |
| Codex | `~/.codex/visualizations`、`~/Documents/Codex` | 面板源文件直接读取 |
| Cursor | `~/.cursor`、`~/Documents/Cursor` | 面板兼容文件直接读取 + 会话/项目 JSON 启发式解析 |
| WorkBuddy | `~/.workbuddy` | **内置适配**：解析 `sessions.json` + `traces/*.json`，自动把会话聚合为项目（Token / 次数 / 时间 / 工作目录） |
| 百度搭子 DuMate | `~/.dumate`、`~/.du-mate`、`~/.baidu-dazhi`、`~/.baidu-dazi` | 面板兼容文件 + 会话/项目 JSON 启发式解析 |
| QClaw | `~/.qclaw`、`~/.QClaw` | 面板兼容文件 + 会话/项目 JSON 启发式解析 |
| AutoClaw / OpenClaw | `~/.openclaw`、`~/.autoclaw`、`~/.auto-claw` | 面板兼容文件 + 会话/项目 JSON 启发式解析 |

通用启发式解析是**防御式**的：只识别 `sessions/`、`conversations/`、`chats/`、`projects/`、`traces/` 等目录或文件名带 session/conversation/chat/project/trace 的 JSON，且必须有明确 id + 时间或名称，避免把无关配置文件误判成项目；源字段按平台名标注（cursor / dumate / qclaw / autoclaw）。

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

日志：macOS / Linux `/tmp/goodname-agent-sync.log`，Windows `%LOCALAPPDATA%\goodname\agent-sync.log`。

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

## 数据模板（AI 生成上传参考）

仓库内提供两份参考文件：

- [`data.example.json`](./data.example.json)：完整字段示例（projects / topics / monthly，含里程碑、下一步、完成标准、决策日志等）；
- [`TEMPLATE.md`](./TEMPLATE.md)：每个字段的必填/可选与取值说明。

AI / 新手生成数据流程：

```bash
# 1. 生成带完整字段的 data.json（内含示例）
node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --init --dir <工作目录>

# 2. 把示例替换为真实内容（参考 TEMPLATE.md）

# 3. 上传
node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --file <工作目录>/data.json --auto
```

## 安全

- 数据库中只存密钥的 SHA-256 哈希，明文只在生成时显示一次
- 上传接口通过同步密钥鉴权，`user_id` 由服务端解析，调用方无法伪造
- anon key 是公开的，数据隔离由 Supabase RLS 行级安全保证
