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
const LOG_PATH =
  process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'goodname', 'agent-sync.log')
    : '/tmp/goodname-agent-sync.log';
const WIN_TASK = 'goodname-sync';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (process.platform === 'win32') fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line, 'utf-8');
  } catch {}
  console.log(msg);
}

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

export function daemonLoop(syncFn, intervalHours, retryMinutes, taskFn, heartbeatFn) {
  const intervalMs = intervalHours * 3600 * 1000;
  const retryMs = retryMinutes * 60 * 1000;
  const heartbeatMs = 5 * 60 * 1000; // 每 5 分钟上报一次在线心跳
  let lastHeartbeat = 0;

  const maybeHeartbeat = async () => {
    if (typeof heartbeatFn !== 'function') return;
    const now = Date.now();
    if (now - lastHeartbeat < heartbeatMs) return;
    lastHeartbeat = now;
    try {
      await heartbeatFn();
    } catch {}
  };

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
      delete st.error; // 成功后清空上一次的失败信息，避免出现「ok（fetch failed）」矛盾状态
    } catch (err) {
      st.status = 'fail';
      st.error = String(err.message || err).slice(0, 300);
    }
    saveState(st);
  };

  (async () => {
    if (due()) {
      log(`catch-up run (first start or missed while off)`);
      await runOnce();
    }
    await maybeHeartbeat();
    while (true) {
      await new Promise((r) => setTimeout(r, 60000));
      await maybeHeartbeat();
      // 任务队列：面板入队的「立即同步 / 深度更新」优先执行
      if (typeof taskFn === 'function') {
        try { await taskFn(); } catch {}
      }
      if (due()) {
        log(`scheduled run (every ${intervalHours}h)`);
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
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
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
  const cfg = loadConfig();
  if (!cfg.sync_key && !cfg.device_token) {
    console.error('✗ 未配置同步凭证');
    console.error('  方式一（免密钥）：node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --setup <安装码>');
    console.error('  方式二（旧版）：让本机 Codex 把同步密钥保存到 ~/.goodname/config.json');
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
  } else if (process.platform === 'win32') {
    // Windows：用系统计划任务在登录时启动常驻进程（--daemon 内部处理 3 小时节奏/重试/补跑）
    const base = 'schtasks /Create /F /TN "' + WIN_TASK + '" /TR "\\"' + process.execPath + '\\" \\"' + here() + '\\" --daemon" /SC ONLOGON';
    let created = false;
    // 优先最高权限；普通用户无管理员权限时自动降级（默认 LIMITED），保证装得上
    for (const extra of [' /RL HIGHEST', '']) {
      try {
        execSync(base + extra, { stdio: 'ignore' });
        created = true;
        break;
      } catch {}
    }
    if (created) {
      let verified = false;
      try {
        const q = execSync('schtasks /Query /TN "' + WIN_TASK + '"', { stdio: 'pipe' }).toString();
        verified = q.includes(WIN_TASK) || q.toLowerCase().includes('goodname-sync');
      } catch {}
      console.log((verified ? '✓' : '⚠') + ' 常驻同步服务已安装（Windows 计划任务，登录后自动运行）');
      console.log('  每 3 小时同步一次 · 失败自动重试 · 登录/开机自动补跑');
      console.log('  日志：' + LOG_PATH);
      console.log('  卸载：node .../goodname-sync.js --service uninstall');
      if (!verified) console.log('  若计划任务被安全软件拦截，请手动创建：schtasks /Create /F /TN ' + WIN_TASK + ' /TR "' + process.execPath + ' ' + here() + ' --daemon" /SC ONLOGON');
    } else {
      // 回退：用户级注册表启动项（HKCU Run，无需管理员，不依赖 schtasks）
      let regOk = false;
      try {
        const cfgDir = path.join(os.homedir(), '.goodname');
        fs.mkdirSync(cfgDir, { recursive: true });
        const vbsPath = path.join(cfgDir, 'goodname-sync-daemon.vbs');
        const vbs = 'Set WshShell = CreateObject("WScript.Shell")\r\n'
          + 'WshShell.Run "cmd /c ""' + process.execPath + '" "' + here() + '" --daemon", 0, False\r\n'
          + 'Set WshShell = Nothing\r\n';
        fs.writeFileSync(vbsPath, vbs, 'utf-8');
        execSync('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v GoodnameSync /t REG_SZ /d "' + vbsPath.replace(/\\/g, '\\\\') + '" /f', { stdio: 'ignore' });
        regOk = true;
        console.log('✓ 常驻同步服务已安装（Windows 注册表启动项，登录后自动运行，无需管理员）');
        console.log('  每 3 小时同步一次 · 失败自动重试 · 登录/开机自动补跑');
        console.log('  日志：' + LOG_PATH);
        console.log('  卸载：node .../goodname-sync.js --service uninstall');
      } catch (e) {
        console.log('⚠ 计划任务与注册表启动项均失败：' + (e.message || e).slice(0, 120));
        console.log('  可手动运行：node "' + here() + '" --auto');
      }
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
  } else if (process.platform === 'win32') {
    try { execSync('schtasks /Delete /F /TN "' + WIN_TASK + '"', { stdio: 'ignore' }); } catch {}
    try { execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v GoodnameSync /f', { stdio: 'ignore' }); } catch {}
    try { fs.unlinkSync(path.join(os.homedir(), '.goodname', 'goodname-sync-daemon.vbs')); } catch {}
    console.log('✓ 常驻同步服务已卸载（计划任务 / 注册表启动项）');
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
  } else if (process.platform === 'win32') {
    try {
      const out = execSync('schtasks /Query /TN "' + WIN_TASK + '"', { stdio: 'pipe' }).toString();
      console.log('  服务已安装：' + (out.includes(WIN_TASK) ? '是' : '否'));
      console.log('  运行状态：登录后自动运行');
    } catch {
      console.log('  服务已安装：否');
    }
  }
  console.log('  上次同步：' + (st.last_success || '从未'));
  console.log('  最近状态：' + (st.status || '-') + (st.error ? '（' + st.error + '）' : ''));
  console.log('═══════════════════════════════════════');
}
