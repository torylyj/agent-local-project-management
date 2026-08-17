#!/usr/bin/env bash
# goodname-sync 一键安装
# 流程：下载 → SHA-256 校验 → 解压 → 保存密钥（交互式输入一次）→ 安装常驻服务 → 首次同步
# 源码可见：https://goodname.fun/agent-sync/install.sh
set -euo pipefail

BASE="https://goodname.fun/agent-sync"
DEST="$HOME/.goodname/agent-sync"
TMP_DIR="${TMPDIR:-/tmp}"
TMP_TGZ="$TMP_DIR/agent-sync.tar.gz"
TMP_SHA="$TMP_DIR/agent-sync.tar.gz.sha256"
CONFIG="$HOME/.goodname/config.json"

echo "==> 1/6 检查环境..."
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未检测到 Node.js（需要 >= 18）。请先安装 Node.js，再重试本命令。" >&2
  exit 1
fi
mkdir -p "$DEST" "$HOME/.goodname"

echo "==> 2/6 下载同步工具（goodname.fun 官方源）..."
curl -fsSL "$BASE/agent-sync.tar.gz" -o "$TMP_TGZ"
curl -fsSL "$BASE/agent-sync.tar.gz.sha256" -o "$TMP_SHA"

echo "==> 3/6 校验 SHA-256..."
if command -v shasum >/dev/null 2>&1; then
  (cd "$TMP_DIR" && shasum -a 256 -c "$(basename "$TMP_SHA")")
elif command -v sha256sum >/dev/null 2>&1; then
  (cd "$TMP_DIR" && sha256sum -c "$(basename "$TMP_SHA")")
else
  echo "✗ 缺少 shasum / sha256sum，请安装后重试（macOS 自带 shasum；Linux 装 coreutils）。" >&2
  exit 1
fi

echo "==> 4/6 解压到 $DEST ..."
tar -xzf "$TMP_TGZ" -C "$DEST"
rm -f "$TMP_TGZ" "$TMP_SHA"

echo "==> 5/6 配置同步密钥..."
if [ -f "$CONFIG" ] && grep -q '"sync_key"' "$CONFIG" 2>/dev/null; then
  echo "    检测到已保存的密钥，跳过输入。"
else
  # 支持三种方式传入密钥：环境变量 GOODNAME_SYNC_KEY、位置参数（bash -s -- sk_xxx）、交互输入
  KEY="${GOODNAME_SYNC_KEY:-${1:-}}"
  if [ -z "$KEY" ] && [ -t 0 ]; then
    printf "    请粘贴同步密钥（goodname.fun 账号面板 → 生成同步密钥）："
    read -r KEY || true
  elif [ -z "$KEY" ]; then
    printf "    请粘贴同步密钥（goodname.fun 账号面板 → 生成同步密钥）："
    read -r KEY < /dev/tty || true
  fi
  KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
  if [ -z "$KEY" ]; then
    echo "✗ 未输入密钥，已取消安装。可稍后用：node $DEST/bin/goodname-sync.js --save-key <密钥> 补配置。" >&2
    exit 1
  fi
  if [ "${KEY#sk_}" = "$KEY" ]; then
    echo "⚠ 密钥看起来不是 sk_ 开头，请确认粘贴的是「同步密钥」而不是登录密码。" >&2
  fi
  umask 077
  printf '{\n  "sync_key": "%s",\n  "saved_at": "%s"\n}\n' "$KEY" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$CONFIG"
  chmod 600 "$CONFIG"
  echo "    密钥已保存到 ${CONFIG}（权限 600，仅本机可读）"
fi

echo "==> 6/6 安装常驻同步服务（每 3 小时同步 · 失败重试 · 开机补跑）..."
node "$DEST/bin/goodname-sync.js" --service install

echo ""
echo "✅ 安装完成！正在执行首次同步..."
node "$DEST/bin/goodname-sync.js" --auto || echo "⚠ 首次同步未成功，服务会在后台自动重试。"
echo ""
echo "   · 查看状态：node $DEST/bin/goodname-sync.js --service status"
echo "   · 立即同步：node $DEST/bin/goodname-sync.js --auto"
echo "   · 卸载服务：node $DEST/bin/goodname-sync.js --service uninstall"
echo "   · 打开面板：https://goodname.fun/progress"
