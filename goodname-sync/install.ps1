# goodname-sync 一键安装（Windows PowerShell）
# 用法：右键「使用 PowerShell 运行」，或：
#   powershell -ExecutionPolicy Bypass -File install.ps1 [同步密钥]
# 密钥支持三种方式：环境变量 GOODNAME_SYNC_KEY、位置参数、交互输入。
# 流程：下载 → SHA-256 校验 → 解压 → 保存密钥 → 安装常驻服务（计划任务）→ 首次同步
$ErrorActionPreference = "Stop"

$Base = "https://goodname.fun/agent-sync"
$Dest = Join-Path $env:USERPROFILE ".goodname\agent-sync"
$TmpDir = Join-Path $env:TEMP "goodname-install"
$TmpTgz = Join-Path $TmpDir "agent-sync.tar.gz"
$TmpSha = Join-Path $TmpDir "agent-sync.tar.gz.sha256"
$Config = Join-Path $env:USERPROFILE ".goodname\config.json"

Write-Host "==> 1/6 检查环境..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "✗ 未检测到 Node.js（需要 >= 18）。请先安装 Node.js，再重试本命令。" -ForegroundColor Red
  exit 1
}

Write-Host "==> 2/6 下载同步工具（goodname.fun 官方源）..."
New-Item -ItemType Directory -Force -Path $TmpDir, (Split-Path $Dest -Parent) | Out-Null
Invoke-WebRequest -UseBasicParsing "$Base/agent-sync.tar.gz" -OutFile $TmpTgz
Invoke-WebRequest -UseBasicParsing "$Base/agent-sync.tar.gz.sha256" -OutFile $TmpSha

Write-Host "==> 3/6 校验 SHA-256..."
$expected = (Get-Content $TmpSha | Select-Object -First 1).Split(" ")[0].Trim().ToLower()
$actual = (Get-FileHash $TmpTgz -Algorithm SHA256).Hash.ToLower()
if ($expected -ne $actual) {
  Write-Host "✗ SHA-256 校验失败，已中止（防止下载被篡改）。" -ForegroundColor Red
  exit 1
}

Write-Host "==> 4/6 解压到 $Dest ..."
if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
tar -xzf $TmpTgz -C $Dest
Remove-Item $TmpTgz, $TmpSha -Force -ErrorAction SilentlyContinue

Write-Host "==> 5/6 配置同步密钥..."
$existing = ""
if (Test-Path $Config) {
  try { $existing = (Get-Content $Config -Raw | ConvertFrom-Json).sync_key } catch {}
}
$Key = ""
if ($env:GOODNAME_SYNC_KEY) { $Key = $env:GOODNAME_SYNC_KEY }
elseif ($args.Count -gt 0) { $Key = $args[0] }
elseif ($existing) { $Key = $existing }
if (-not $Key) {
  $Key = Read-Host "请粘贴同步密钥（goodname.fun 账号面板 → 生成同步密钥）"
}
$Key = ($Key -replace "\s", "")
if (-not $Key) {
  Write-Host "✗ 未输入密钥，已取消安装。可稍后用：node $Dest\bin\goodname-sync.js --save-key <密钥> 补配置。" -ForegroundColor Red
  exit 1
}
if (-not $Key.StartsWith("sk_")) {
  Write-Host "⚠ 密钥看起来不是 sk_ 开头，请确认粘贴的是「同步密钥」而不是登录密码。" -ForegroundColor Yellow
}
$cfg = @{ sync_key = $Key; saved_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") } | ConvertTo-Json
[System.IO.File]::WriteAllText($Config, $cfg)
Write-Host "    密钥已保存到 $Config"

Write-Host "==> 6/6 安装常驻同步服务（每 3 小时同步 · 失败重试 · 登录补跑）..."
node "$Dest\bin\goodname-sync.js" --service install

Write-Host ""
Write-Host "✅ 安装完成！正在执行首次同步..."
node "$Dest\bin\goodname-sync.js" --auto
Write-Host ""
Write-Host "   · 查看状态：node $Dest\bin\goodname-sync.js --service status"
Write-Host "   · 立即同步：node $Dest\bin\goodname-sync.js --auto"
Write-Host "   · 卸载服务：node $Dest\bin\goodname-sync.js --service uninstall"
Write-Host "   · 打开面板：https://goodname.fun/progress"
