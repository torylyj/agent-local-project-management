#!/usr/bin/env node

import { syncAction } from '../src/index.js';

function parseArgs(argv) {
  const options = { source: 'auto', dryRun: false, verbose: false, auto: false, status: false, watch: false, daemon: false, service: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--key' || a === '-k') options.key = argv[++i];
    else if (a === '--save-key') options.saveKey = argv[++i];
    else if (a === '--file' || a === '-f') options.file = argv[++i];
    else if (a === '--dir' || a === '-d') options.dir = argv[++i];
    else if (a === '--dry-run') options.dryRun = true;
    else if (a === '--verbose') options.verbose = true;
    else if (a === '--auto') options.auto = true;
    else if (a === '--status') options.status = true;
    else if (a === '--watch') options.watch = true;
    else if (a === '--daemon') options.daemon = true;
    else if (a === '--service') options.service = argv[++i];
    else if (a === '--help' || a === '-h') { options.help = true; }
    else if (a.startsWith('-')) { console.error('未知参数: ' + a); process.exit(1); }
    else positional.push(a);
  }
  if (positional.length) options.source = positional[0];
  return options;
}

console.log('─'.repeat(50));
console.log('  goodname-sync · 多 Agent 项目数据同步工具');
console.log('─'.repeat(50));

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(`
用法:
  node bin/goodname-sync.js [source] [选项]

选项:
  -k, --key <key>      同步密钥（sk_xxx），或设置环境变量 CODEX_SYNC_KEY
      --save-key <key>  保存密钥到 ~/.goodname/config.json（只需一次）
  -f, --file <path>    直接指定数据文件（data.json 或面板 HTML）
  -d, --dir <path>     自定义数据目录路径
      --dry-run        只扫描不上传
      --verbose        显示详细日志
      --auto           Agent 自动模式：简洁输出
      --status         查看云端同步状态
      --watch          监控数据变化自动同步
      --daemon         常驻模式：每 3 小时同步、失败重试、开机补跑
      --service <act>  安装/卸载常驻服务：install | uninstall | status
`);
  process.exit(0);
}

try {
  await syncAction(options.source, options);
} catch (err) {
  console.error('\n同步失败:', err.message);
  process.exit(1);
}
