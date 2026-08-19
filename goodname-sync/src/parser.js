import fs from 'fs';
import vm from 'vm';
import path from 'path';

// 同步工具版本：面板据此提示「工具版本过旧」；每次发布新功能时递增
export const SYNC_VERSION = '1.2.0';

// 从面板 HTML 中提取 JS 数组/对象字面量（仅限纯数据，无函数调用）
function extractValue(src, varName) {
  const re = new RegExp('(?:const|let|var)\\s+' + varName + '\\s*=\\s*');
  const m = re.exec(src);
  if (!m) return undefined;
  let i = m.index + m[0].length;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (i >= src.length) return undefined;
  const opener = src[i];
  if (!'{['.includes(opener)) {
    let j = i;
    while (j < src.length && !/[\n;]/.test(src[j])) j++;
    try {
      return vm.runInNewContext('(' + src.slice(i, j) + ')', Object.create(null), { timeout: 500 });
    } catch {
      return undefined;
    }
  }
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inStr = null;
  let esc = false;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) {
        const literal = src.slice(i, j + 1);
        try {
          return vm.runInNewContext('(' + literal + ')', Object.create(null), { timeout: 500 });
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function parseJson(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (raw && Array.isArray(raw.projects)) return raw;
  // 兼容 {data: {...}} 包裹
  if (raw && raw.data && Array.isArray(raw.data.projects)) return raw.data;
  throw new Error('data.json 缺少 projects 数组');
}

function parseHtml(file) {
  const src = fs.readFileSync(file, 'utf-8');
  const projects = extractValue(src, 'projects');
  const current = extractValue(src, 'current');
  const empty = extractValue(src, 'empty');
  const topics = extractValue(src, 'TOPICS');
  const monthly = extractValue(src, 'MONTHLY_TOKENS');
  return {
    templateVersion: 'sync',
    projects: Array.isArray(projects) ? projects : [],
    current: current ?? null,
    empty: Array.isArray(empty) ? empty : [],
    topics: Array.isArray(topics) ? topics : [],
    monthly: monthly && typeof monthly === 'object' ? monthly : {},
  };
}

export function parseDataFile(file) {
  if (!fs.existsSync(file)) throw new Error(`文件不存在: ${file}`);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') return parseJson(file);
  if (ext === '.html' || ext === '.htm') return parseHtml(file);
  throw new Error(`不支持的文件类型: ${ext}`);
}

// 把面板数据整理为上传负载
export function buildUploadPayload(data) {
  const allProjects = [];
  if (data.current && data.current.name) allProjects.push(data.current);
  (data.projects || []).forEach(p => allProjects.push(p));

  // 规范化 payload 数组：兼容字符串条目（旧版 data.json 格式）→ 统一为标准对象
  const normMs = (arr) => Array.isArray(arr) ? arr.filter(x => x).map(m => typeof m === 'string' ? { date: '', text: m, done: false } : m) : arr;
  const normNext = (arr) => Array.isArray(arr) ? arr.filter(n => n).map(n => typeof n === 'string' ? { text: n, p: 'mid' } : n) : arr;
  const normCr = (arr) => Array.isArray(arr) ? arr.filter(c => c).map(c => typeof c === 'string' ? { text: c, done: false } : c) : arr;
  const normDec = (arr) => Array.isArray(arr) ? arr.filter(d => d).map(d => typeof d === 'string' ? { date: '', title: d, reason: '', tags: [] } : d) : arr;
  allProjects.forEach(p => {
    if (p && typeof p === 'object') {
      if (Array.isArray(p.milestones)) p.milestones = normMs(p.milestones);
      if (Array.isArray(p.next)) p.next = normNext(p.next);
      if (Array.isArray(p.criteria)) p.criteria = normCr(p.criteria);
      if (Array.isArray(p.decisions)) p.decisions = normDec(p.decisions);
    }
  });

  const projects = allProjects.map((p) => ({
    name: p.name,
    description: p.intro || p.description || null,
    status: p.status || 'doing',
    category: p.cat || p.category || null,
    tokens_used: p.tokens || p.tokens_used || 0,
    started_at: p.date || p.started_at || null,
    source: p.source || 'codex',
    metadata: {
      conv: p.conv || 0,
      updated: p.updated || null,
      review: p.review || null,
      dir: p.dir || null,
      sync_version: SYNC_VERSION,
    },
    payload: p,
  }));

  const topics = (data.topics || []).map((t, i) => ({
    title: t.title,
    description: t.desc || t.description || null,
    status: 'idea',
    category: t.type || t.category || null,
    priority: typeof t.priority === 'number' ? t.priority : 0,
    metadata: {
      project: t.project || null,
      plan: Array.isArray(t.plan) ? t.plan : [],
    },
    payload: t,
  }));

  const monthly = Object.entries(data.monthly || {}).map(([year_month, tokens]) => ({
    year_month,
    tokens: Number(tokens) || 0,
    cost_estimate: parseFloat(((Number(tokens) || 0) * 0.3 / 1000000).toFixed(2)),
  }));

  return { projects, topics, monthly };
}
