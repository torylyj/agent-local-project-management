import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadConfig, saveConfig } from './config.js';

const STATE_PATH = path.join(os.homedir(), '.goodname', 'state.json');
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.goodname.agent-sync.plist');
const LEGACY_PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.goodname.codex-sync.plist');
const SYSTEMD_PATH = path.join(os.homedir(), '.config', 'systemd', 'user', 'goodname-agent-sync.service');
const LEGACY_SYSTEMD_PATH = path.join(os.homedir(), '.config', 'systemd', 'user', 'goodname-codex-sync.service');
const LOG_PATH = '/tmp/goodname-agent-sync.log';

function here() {
  return fileURLToPath(new URL('../bin/goodname-sync.js', import.meta.url));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveState(obj) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(obj, null, 2), 'utf-8');
}

export function daemonLoop(syncFn, intervalHours, retryMinutes) {
  const intervalMs = intervalHours * 3600 * 1000;
  const retryMs = retryMinutes * 60 * 1000;

  const due = () => {
    const st = loadState();
    const now = Date.now();
    const lastSuc = st.last_success ? new Date(st.last_success).getTime() : null;
    const lastAt = st.last_at ? new Date(st.last_at).getTime() : null;
    if (lastSuc == null || now - lastSuc >= intervalMs) {
      if (lastAt == null || now - lastAt >= retryMs) return true;
    }
    return false;
  };

  const runOnce = async () => {
    const st = loadState();
    st.last_at = new Date().toISOString();
    try {
      await syncFn();
      st.last_success = new Date().toISOString();
      st.status = 'ok';
    } catch (err) {
      st.status = 'fail';
      st.error = String(err.message || err).slice(0, 300);
    }
    saveState(st);
  };

  (async () => {
    if (due()) {
      console.log(`[${new Date().toLocaleString()}] catch-up run (first start or missed while off)`);
      await runOnce();
    }
    while (true) {
      await new Promise((r) => setTimeout(r, 60000));
      if (due()) {
        console.log(`[${new Date().toLocaleString()}] scheduled run (every ${intervalHours}h)`);
        await runOnce();
      }
    }
  })();
}

function writePlist() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.goodname.agent-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${here()}</string>
    <string>--daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/goodname-agent-sync.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/goodname-agent-sync.log</string>
</dict>
</plist>
`;
  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.writeFileSync(PLIST_PATH, plist, 'utf-8');
  return PLIST_PATH;
}

function writeSystemd() {
  const unit = `[Unit]
Description=Goodname agent-sync daemon
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${process.execPath} ${here()} --daemon
Restart=always

[Install]
WantedBy=default.target
`;
  fs.mkdirSync(path.dirname(SYSTEMD_PATH), { recursive: true });
  fs.writeFileSync(SYSTEMD_PATH, unit, 'utf-8');
  return SYSTEMD_PATH;
}

export async function installService() {
  const key = loadConfig().sync_key;
  if (!key) {
    console.error('✗ 请先让本机 Codex 把同步密钥保存到 ~/.goodname/config.json');
    process.exit(1);
  }
  // 迁移旧版服务（com.goodname.codex-sync），避免新老服务重复拉起
  if (process.platform === 'darwin') {
    try { execSync('launchctl bootout "gui/$(id -u)/com.goodname.codex-sync"', { stdio: 'ignore' }); } catch {}
    try { fs.unlinkSync(LEGACY_PLIST_PATH); } catch {}
  } else if (process.platform === 'linux') {
    try { execSync('systemctl --user disable --now goodname-codex-sync.service', { stdio: 'ignore' }); } catch {}
    try { fs.unlinkSync(LEGACY_SYSTEMD_PATH); } catch {}
  }
  if (process.platform === 'darwin') {
    const p = writePlist();
    try {
      execSync(`launchctl bootstrap "gui/$(id -u)" ${p}`, { stdio: 'ignore' });
    } catch {
      try { execSync(`launchctl kickstart -k "gui/$(id -u)/com.goodname.agent-sync"`, { stdio: 'ignore' }); } catch {}
    }
    console.log('✓ 常驻同步服务已安装（macOS LaunchAgent）');
    console.log('  每 3 小时同步一次 · 失败自动重试 · 登录/开机自动补跑 · 崩溃自动拉起');
    console.log('  日志：' + LOG_PATH);
    console.log('  卸载：node ~/.goodname/agent-sync/bin/goodname-sync.js --service uninstall');
  } else if (process.platform === 'linux') {
    const p = writeSystemd();
    try {
      execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
      execSync('systemctl --user enable --now goodname-agent-sync.service', { stdio: 'ignore' });
      console.log('✓ 常驻同步服务已安装（systemd user unit）');
    } catch (e) {
      console.log('⚠ 已生成 unit 文件：' + p);
      console.log('  请手动执行：systemctl --user daemon-reload && systemctl --user enable --now goodname-agent-sync.service');
    }
  } else {
    console.log('⚠ 当前平台暂不支持自动安装常驻服务，请用系统计划任务定时运行：');
    console.log('  node ~/.goodname/agent-sync/bin/goodname-sync.js --auto');
  }
}

export async function uninstallService() {
  if (process.platform === 'darwin') {
    try { execSync('launchctl bootout "gui/$(id -u)/com.goodname.agent-sync"', { stdio: 'ignore' }); } catch {}
    try { execSync('launchctl bootout "gui/$(id -u)/com.goodname.codex-sync"', { stdio: 'ignore' }); } catch {}
    try { fs.unlinkSync(PLIST_PATH); } catch {}
    try { fs.unlinkSync(LEGACY_PLIST_PATH); } catch {}
    console.log('✓ 常驻同步服务已卸载');
  } else if (process.platform === 'linux') {
    try { execSync('systemctl --user disable --now goodname-agent-sync.service', { stdio: 'ignore' }); } catch {}
    try { execSync('systemctl --user disable --now goodname-codex-sync.service', { stdio: 'ignore' }); } catch {}
    try { fs.unlinkSync(SYSTEMD_PATH); } catch {}
    try { fs.unlinkSync(LEGACY_SYSTEMD_PATH); } catch {}
    console.log('✓ 常驻同步服务已卸载');
  } else {
    console.log('当前平台无自动安装的服务');
  }
}

export function statusService() {
  const cfg = loadConfig();
  const st = loadState();
  console.log('═══════════════════════════════════════');
  console.log('  goodname-sync 常驻服务状态');
  console.log('═══════════════════════════════════════');
  console.log('  密钥已配置：' + (cfg.sync_key ? '是' : '否'));
  if (process.platform === 'darwin') {
    console.log('  服务已安装：' + (fs.existsSync(PLIST_PATH) ? '是' : '否'));
    try {
      const out = execSync('launchctl print "gui/$(id -u)/com.goodname.agent-sync"', { stdio: 'pipe' }).toString();
      console.log('  运行状态：' + (/state = running/.test(out) ? '运行中' : '未运行'));
    } catch {
      console.log('  运行状态：未运行');
    }
  }
  console.log('  上次同步：' + (st.last_success || '从未'));
  console.log('  最近状态：' + (st.status || '-') + (st.error ? '（' + st.error + '）' : ''));
  console.log('═══════════════════════════════════════');
}
