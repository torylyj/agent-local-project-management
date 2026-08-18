// Agent 命名模块：项目名由 AI 识别会话内容后生成，绝不直接使用提问原文/文件夹名上传。
// 命名来源优先级：~/.goodname/project-names.json（Agent 填写）> 本机 Codex CLI 自动生成 > 暂缓上传。
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';

const NAMES_PATH = path.join(os.homedir(), '.goodname', 'project-names.json');
const PENDING_PATH = path.join(os.homedir(), '.goodname', 'pending-names.json');

export function agentNameKey(p) {
  return String(p && (p.sid || p.dir || '')).trim();
}

export function loadAgentNames() {
  try {
    const d = JSON.parse(fs.readFileSync(NAMES_PATH, 'utf-8'));
    return (d && d.names && typeof d.names === 'object') ? d.names : {};
  } catch {
    return {};
  }
}

export function saveAgentNames(names) {
  try {
    fs.mkdirSync(path.dirname(NAMES_PATH), { recursive: true });
    fs.writeFileSync(NAMES_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), names }, null, 2), 'utf-8');
  } catch (e) {
    console.log('  ⚠ 命名表保存失败: ' + (e.message || e));
  }
}

export function lookupName(p, names) {
  if (!names) return '';
  for (const k of [p && p.sid, p && p.dir]) {
    if (k && names[k]) return String(names[k]).trim();
  }
  return '';
}

function summaryOf(p) {
  const s = (p && p.summary) || '';
  const intro = (p && p.intro) || '';
  return String(s || intro || '').slice(0, 160);
}

export function buildNamingPrompt(projects) {
  const lines = [
    '你是项目命名助手。请阅读下面每个 AI 会话的内容摘要，判断它实际在做哪个项目，',
    '并为每个会话生成一个简洁、正式的项目名称（4-20 个字，不要前缀、标点，不要照抄提问原文）。',
    '多个会话属于同一个项目时，使用完全相同的名称。',
    '只输出一个 JSON 对象，格式：{"<key>": "项目名称"}，不要输出任何其他内容。',
    '',
    '会话清单：'
  ];
  (projects || []).forEach((p, i) => {
    lines.push(`${i + 1}. key=${agentNameKey(p) || '无'} | 工作目录=${p.dir || '无'} | Token=${p.tokens || 0}`);
    const s = summaryOf(p);
    if (s) lines.push(`   摘要：${s}`);
    if (p.files && p.files.length) lines.push(`   产出文件：${String(p.files).slice(0, 120)}`);
  });
  return lines.join('\n');
}

export function writePendingNames(projects) {
  try {
    const entries = (projects || []).filter(p => agentNameKey(p)).map(p => ({
      key: agentNameKey(p),
      dir: p.dir || '',
      summary: summaryOf(p),
      tokens: p.tokens || 0,
      files: (p.files || []).slice(0, 8),
    }));
    fs.mkdirSync(path.dirname(PENDING_PATH), { recursive: true });
    fs.writeFileSync(PENDING_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      instructions: '把下面每个 key 对应的项目名填进 names 后，另存为 ~/.goodname/project-names.json；或让 Agent 直接生成该文件。',
      entries,
      names: {},
    }, null, 2), 'utf-8');
  } catch (e) {
    console.log('  ⚠ 待命名清单写入失败: ' + (e.message || e));
  }
}

export function findCodexBin() {
  const candidates = [
    'codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    path.join(os.homedir(), '.codex', 'bin', 'codex'),
  ];
  for (const c of candidates) {
    try {
      execFile(c, ['--version'], { timeout: 8000, stdio: 'ignore' });
      return c;
    } catch {
      /* 尝试下一个 */
    }
  }
  return '';
}

function extractJson(text) {
  let t = String(text || '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1];
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

// 调用本机 Codex CLI 为会话批量生成项目名（仅当项目名缺失时触发）
export function generateNamesWithCodex(projects, verbose) {
  return new Promise((resolve) => {
    const bin = findCodexBin();
    if (!bin) {
      if (verbose) console.log('  ⚠ 未找到本地 Codex，无法自动命名');
      return resolve({});
    }
    const prompt = buildNamingPrompt(projects);
    const args = [
      'exec',
      '-C',
      process.cwd(),
      '--skip-git-repo-check',
      '-s',
      'workspace-write',
      prompt,
    ];
    execFile(bin, args, { timeout: 90000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }, (err, stdout) => {
      if (err) {
        if (verbose) console.log('  ⚠ Codex 命名调用失败: ' + (err.message || err).slice(0, 160));
        return resolve({});
      }
      const obj = extractJson(stdout);
      if (!obj || typeof obj !== 'object') {
        if (verbose) console.log('  ⚠ Codex 未返回有效 JSON，命名失败');
        return resolve({});
      }
      const names = {};
      for (const [k, v] of Object.entries(obj)) {
        const n = String(v || '').trim();
        if (k && n.length >= 2 && n.length <= 40) names[k] = n;
      }
      resolve(names);
    });
  });
}
