import fs from 'fs';
import path from 'path';
import os from 'os';
import { DEFAULT_SEARCH_ROOTS, PANEL_FILENAMES, DATA_FILENAMES, WORKBUDDY_DIR, AGENT_ROOTS } from './config.js';

function expandPath(p) {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

// 稳定哈希：用于孤儿会话（无 sessionId）的稳定 ID，保证多次扫描/多台设备命名一致
function stableHash(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function walk(dir, depth, maxDepth, out) {
  if (depth > maxDepth) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.codex') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, depth + 1, maxDepth, out);
    } else {
      out.push(full);
    }
  }
}

// 在根目录下查找面板 HTML 或 data.json
export function findDataFile(customDir, customFile, verbose) {
  if (customFile) {
    const p = expandPath(customFile);
    if (!fs.existsSync(p)) throw new Error(`文件不存在: ${p}`);
    return p;
  }
  const roots = customDir
    ? [{ label: 'custom', paths: [customDir] }]
    : DEFAULT_SEARCH_ROOTS;
  const wants = [...PANEL_FILENAMES, ...DATA_FILENAMES];
  const found = [];
  for (const root of roots) {
    for (const rp of root.paths) {
      const base = expandPath(rp);
      if (!fs.existsSync(base)) continue;
      const files = [];
      walk(base, 0, 6, files);
      for (const f of files) {
        const name = path.basename(f);
        if (wants.includes(name)) {
          found.push({ file: f, root: root.label });
        }
      }
    }
  }
  if (found.length === 0) {
    throw new Error('未找到面板数据，请用 --file 指定 data.json 或面板 HTML 路径');
  }
  // 优先取 data.json，其次面板源文件（未转义，可解析），渲染壳最后兜底
  found.sort((a, b) => {
    const weight = (f) => {
      const name = path.basename(f);
      // 面板源文件是维护的唯一权威数据源，优先于任何散落的 data.json（避免被 ~/.workbuddy/data.json 等残留文件劫持）
      if (name === 'codex-project-tracker.html') return 0;
      if (DATA_FILENAMES.includes(name)) return 1;
      return 2;
    };
    const aw = weight(a.file);
    const bw = weight(b.file);
    if (aw !== bw) return aw - bw;
    return fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs;
  });
  const pick = found[0];
  if (verbose) console.log(`  数据源: ${pick.root} → ${pick.file}`);
  return pick.file;
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

// WorkBuddy trace 的 toolInput 里第一个 <user_query> 是系统上下文，最后一个才是真实提问
function lastUserQuery(input) {
  const start = input.lastIndexOf('<user_query>');
  if (start < 0) return '';
  const end = input.indexOf('</user_query>', start);
  if (end < 0) return '';
  return input.slice(start + '<user_query>'.length, end);
}

function sessionName(workDir, sid, updatedAt) {
  if (workDir) {
    const base = path.basename(workDir);
    if (base && !/^\d{4}-\d{2}-\d{2}(-\d{2}(-\d{2}(-\d{2})?)?)?$/.test(base) && base !== '.') {
      return 'WorkBuddy · ' + base;
    }
    const d = (updatedAt || '').slice(0, 10);
    return 'WorkBuddy 会话 · ' + (d || sid.slice(0, 8));
  }
  return 'WorkBuddy 会话 · ' + sid.slice(0, 8);
}

// 从会话内容（真实用户提问）提炼项目名：去掉请求套话、只取第一句、控制在 28 字内
export function deriveProjectName(summary) {
  if (!summary) return '';
  let s = String(summary)
    .replace(/["'“”‘’]/g, '')
    .replace(/@/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length < 4) return '';
  s = s.replace(/^(请帮我|请你|麻烦你|帮我一下|帮我|帮忙|拜托|能否|能不能|可以帮我|请)\s*/, '');
  s = s.replace(/^(把|将|给|为|对)\s*/, '');
  s = s.replace(/[。！？!?；;，,、][\s\S]*$/, ''); // 只取第一句
  s = s.trim();
  // 去掉路径前缀（如 /Users/xxx/...、C:\...、~...）只留最后一段
  s = s.replace(/^([/\\]|[A-Za-z]:[/\\]|~[/\\])[\s\S]*?([^/\\]+)$/, '$2');
  s = s.replace(/[么吗呢]$/, ''); // 去掉疑问语气词
  s = s.trim();
  if (s.length > 24) {
    const cut = s.slice(0, 24);
    const idx = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf(','), cut.lastIndexOf(' '), cut.lastIndexOf('：'), cut.lastIndexOf(':'));
    s = idx > 10 ? cut.slice(0, idx) : cut;
  }
  s = s.replace(/[，,、\s:：\-—]+$/, '').trim();
  return s.length >= 4 ? s : '';
}

function inferCat(dir, summary) {
  const s = String(dir || '') + ' ' + String(summary || '');
  if (/transcrib|转录|视频|动画|剪辑|配音/i.test(s)) return 'video';
  if (/简历|求职|作品集|面试/i.test(s)) return 'content';
  if (/研究|调研|报告|论文/i.test(s)) return 'research';
  if (/代码|开发|脚本|程序|bug|接口/i.test(s)) return 'tooling';
  return 'tooling';
}

// 项目进度估算：有完成标准按完成比例；否则按状态给基线（done=100）
function estimateProgress(status, criteria) {
  if (status === 'done') return 100;
  const arr = Array.isArray(criteria) ? criteria.filter(Boolean) : [];
  if (arr.length) {
    const done = arr.filter(c => c && c.done === true).length;
    return Math.min(99, Math.round((done / arr.length) * 100));
  }
  return { todo: 10, blocked: 40, hold: 20, doing: 50 }[status] || 0;
}

function fmtLocalTokens(n){
  if(!n) return '0';
  if(n >= 1e8) return (n / 1e8).toFixed(2).replace(/\.00$/, '') + ' 亿';
  if(n >= 1e4) return Math.round(n / 1e4) + ' 万';
  return String(n);
}

// 把 WorkBuddy 的 sessions.json + traces 解析为轻量项目（source=workbuddy）
export function findWorkBuddyProjects(verbose) {
  const wbRoot = WORKBUDDY_DIR.startsWith('~') ? path.join(os.homedir(), WORKBUDDY_DIR.slice(1)) : WORKBUDDY_DIR;
  if (!fs.existsSync(wbRoot)) return [];
  const projects = [];
  const seen = new Set();
  // 1) sessions.json：会话 ID / 工作目录 / 开始时间
  const sd = readJsonSafe(path.join(wbRoot, 'app', 'sessions.json'));
  const sessions = [];
  if (sd && Array.isArray(sd.sessions)) sessions.push(...sd.sessions);
  // 2) traces/**/*.json：按 sessionId 聚合 Token / 次数 / 最近时间 / span 数
  const bySession = new Map();
  const traceFiles = [];
  const noIdTraces = [];
  walk(path.join(wbRoot, 'traces'), 0, 6, traceFiles);
  for (const f of traceFiles) {
    if (!f.endsWith('.json')) continue;
    const d = readJsonSafe(f);
    if (!d || !d.trace) continue;
    const sid = d.trace.sessionId;
    const rec = bySession.get(sid) || { tokens: 0, count: 0, first: '', last: '', agent: d.trace.agentName || 'workbuddy', spans: 0, dates: [], items: [] };
    rec.tokens += Number(d.trace.totalTokens) || 0;
    rec.count += 1;
    rec.spans += Array.isArray(d.spans) ? d.spans.length : 0;
    if (d.trace.startedAt) rec.dates.push(d.trace.startedAt);
    if (d.trace.startedAt && (!rec.first || d.trace.startedAt < rec.first)) rec.first = d.trace.startedAt;
    if (d.trace.endedAt && d.trace.endedAt > rec.last) rec.last = d.trace.endedAt;
    // 每条 trace 提取真实操作内容（用户提问），作为「操作历史」里程碑
    let traceSummary = '';
    if (Array.isArray(d.spans)) {
      for (const s of d.spans) {
        const input = s && (s.toolInput || s.input);
        if (!input || typeof input !== 'string') continue;
        const clean = lastUserQuery(input).replace(/\s+/g, ' ').trim().slice(0, 120);
        if (clean && clean.length >= 4) { traceSummary = clean; break; }
      }
    }
    if (traceSummary && !rec.summary) rec.summary = traceSummary;
    if (traceSummary) rec.items.push({ date: d.trace.startedAt || '', summary: traceSummary });
    if (sid) bySession.set(sid, rec);
    else noIdTraces.push(rec);
  }
  // 无 sessionId 的 trace：按时间窗归属到最近会话，Token/次数不丢
  const windowOf = s => {
    const t0 = Date.parse(s.startedAt || '') || 0;
    const t1 = Date.parse(s.resumedAt || '') || t0;
    return [t0 - 2 * 3600 * 1000, t1 + 2 * 3600 * 1000];
  };
  for (const rec of noIdTraces) {
    const ts = Date.parse(rec.first || '') || 0;
    if (!ts) continue;
    let best = null, bestDist = Infinity;
    for (const s of sessions) {
      const win = windowOf(s);
      if (ts < win[0] || ts > win[1]) continue;
      const dist = Math.min(Math.abs(ts - win[0]), Math.abs(ts - win[1]));
      if (dist < bestDist) { bestDist = dist; best = s; }
    }
    const targetSid = best ? best.conversationId : null;
    if (targetSid) {
      const r = bySession.get(targetSid) || { tokens: 0, count: 0, first: '', last: '', agent: rec.agent, spans: 0, dates: [], items: [] };
      r.tokens += rec.tokens; r.count += rec.count; r.spans += rec.spans;
      if (rec.first && (!r.first || rec.first < r.first)) r.first = rec.first;
      if (rec.last && rec.last > r.last) r.last = rec.last;
      if (rec.dates) r.dates.push(...rec.dates);
      if (rec.items) r.items.push(...rec.items);
      if (!r.summary && rec.summary) r.summary = rec.summary;
      bySession.set(targetSid, r);
    } else if (rec.count) {
      // 孤儿会话：用内容稳定哈希做 ID（不再带 Math.random 随机后缀），
      // 保证同一会话多次扫描 / 多台设备生成的 key 一致，Agent 命名才能稳定匹配。
      const okey = 'orphan:' + stableHash((rec.first || '') + '|' + (rec.summary || '') + '|' + (rec.last || ''));
      const prev = bySession.get(okey);
      if (prev) {
        prev.tokens += rec.tokens;
        prev.count += rec.count;
        prev.spans += rec.spans;
        if (rec.first && (!prev.first || rec.first < prev.first)) prev.first = rec.first;
        if (rec.last && rec.last > prev.last) prev.last = rec.last;
        if (rec.dates) prev.dates.push(...(rec.dates || []));
        if (rec.items) prev.items.push(...(rec.items || []));
        if (!prev.summary && rec.summary) prev.summary = rec.summary;
      } else {
        bySession.set(okey, rec);
      }
    }
  }
  // 3) artifact-index：真实产出文件（按时间窗归属会话）
  const artifacts = [];
  const artFiles = [];
  walk(path.join(wbRoot, 'artifact-index'), 0, 3, artFiles);
  for (const f of artFiles) {
    if (!f.endsWith('.json')) continue;
    const d = readJsonSafe(f);
    if (!d || !Array.isArray(d.artifacts)) continue;
    for (const a of d.artifacts) {
      if (!a || !a.uri || !String(a.uri).startsWith('file://')) continue; // 过滤 file-changes:// 等虚拟 URI
      let pathVal = String(a.uri).slice(7);
      try { pathVal = decodeURIComponent(pathVal); } catch (e) {}
      if (!pathVal || !fs.existsSync(pathVal)) continue; // 只保留真实存在的产出文档
      const tRaw = a.updatedAt || a.createdAt || '';
      const tNum = Number(tRaw);
      const ts = /^\d+$/.test(String(tRaw)) ? tNum : (Date.parse(tRaw) || 0);
      artifacts.push({ name: a.name || path.basename(pathVal), path: pathVal, ts });
    }
  }
  const DAY = 86400000;
  const push = (sid, rec, s) => {
    if (!sid || seen.has(sid)) return;
    seen.add(sid);
    const updatedAt = rec && rec.last ? rec.last : (s && (s.resumedAt || s.startedAt));
    const startedAt = (s && s.startedAt) || (rec && rec.first);
    const updatedMs = Date.parse(updatedAt || '') || Date.now();
    const stale = Date.now() - updatedMs > 14 * DAY;
    // 里程碑 = 真实操作历史（每条 trace 的实际用户任务）；无内容时回退为会话执行记录
    // 同一会话可能拆成多个 trace，且每条 trace 的 span 里都重复记录同一提问，
    // 按提问文本去重后取最后 8 条，避免重复里程碑。
    const seenQ = new Set();
    const msItems = (rec && Array.isArray(rec.items) && rec.items.length)
      ? rec.items.filter(it => {
          const k = (it && it.summary) || '';
          if (!k || seenQ.has(k)) return false;
          seenQ.add(k);
          return true;
        }).slice(-8)
      : [];
    // 产出文档：真实存在、按时间窗归属、去重（前面 artifact 已过滤虚拟 URI）
    const files = [];
    if (startedAt || updatedAt) {
      const lo = (Date.parse(startedAt) || 0) - 2 * DAY;
      const up = Date.parse(updatedAt) || Date.now();
      const hi = up + 2 * DAY;
      const seenF = new Set();
      artifacts.forEach(a => {
        const f = a.path || a.name;
        if (a.ts && a.ts >= lo && a.ts <= hi && !seenF.has(f) && files.length < 8) { seenF.add(f); files.push(f); }
      });
    }
    // 里程碑：优先真实产出文档，其次提炼后的任务标题（不写原始提问「推进：问题」）
    const milestones = [];
    const seenMs = new Set();
    for (const f of files) {
      if (!seenMs.has(f)) {
        seenMs.add(f);
        milestones.push({ date: String(updatedAt || '').slice(0, 10), text: '产出：' + path.basename(String(f)).slice(0, 40), done: true });
      }
    }
    if (rec && Array.isArray(rec.items)) {
      for (const it of rec.items) {
        const t = deriveProjectName(it.summary);
        if (t && !seenMs.has(t)) {
          seenMs.add(t);
          milestones.push({ date: String(it.date || '').slice(0, 10), text: '任务：' + t.slice(0, 40), done: true });
        }
        if (milestones.length >= 8) break;
      }
    }
    if (!milestones.length) milestones.push({ date: String(updatedAt || '').slice(0, 10), text: '会话执行', done: true });
    const next = [];
    if (stale) next.push({ text: '该会话已超过 14 天未更新，请核对产出并决定继续或归档', p: 'low' });
    next.push({ text: '继续推进该项目，建议由 AI 依据会话内容补全下一步建议', p: 'mid' });
    const criteria = [];
    if (files.length) criteria.push({ text: '产出文档已归档（' + files.length + ' 个）', done: true });
    criteria.push({ text: '会话目标已记录，建议由 AI 依据会话补全验收标准', done: false });
    const decisions = rec ? [{
      date: String((rec.last || rec.first || '').slice(0, 10)),
      title: 'WorkBuddy 会话记录',
      reason: '共 ' + ((rec.count) || 1) + ' 次执行 · 约 ' + fmtLocalTokens(rec.tokens) + ' · 产出 ' + files.length + ' 个文档',
      tags: ['workbuddy']
    }] : [];
    projects.push({
      // 名称一律由 Agent 命名模块覆盖（project-names.json / Codex 生成）；
      // 未命名前只用中性日期占位，绝不把提问原文或文件夹名直接当项目名上传。
      name: sessionName(s && s.workDir, sid, updatedAt).slice(0, 40),
      sid,
      dir: (s && s.workDir) || '',
      source: 'workbuddy',
      device: os.hostname(),
      device_type: process.platform,
      cat: inferCat(s && s.workDir, rec && rec.summary),
      status: stale ? 'hold' : 'doing',
      progress: estimateProgress(stale ? 'hold' : 'doing', criteria),
      date: String(startedAt || '').slice(0, 10),
      updated: String(updatedAt || '').slice(0, 10),
      tokens: (rec && rec.tokens) || 0,
      conv: (rec && rec.count) || 1,
      intro: 'WorkBuddy 会话 · 共 ' + ((rec && rec.count) || 1) + ' 次执行 · 约 ' + fmtLocalTokens((rec && rec.tokens) || 0) + ' · 产出 ' + files.length + ' 个文档',
      agent: (rec && rec.agent) || 'workbuddy',
      milestones, next, files,
      criteria, topics: [], decisions,
    });
  };
  for (const s of sessions) {
    const rec = bySession.get(s.conversationId);
    push(s.conversationId, rec, s);
  }
  for (const [sid, rec] of bySession) {
    push(sid, rec, null);
  }
  if (verbose && projects.length) console.log(`  WorkBuddy 适配：解析到 ${projects.length} 个会话项目`);
  return projects;
}

// ---------- 通用多平台适配（防御式启发解析） ----------
// 对 Cursor / 百度搭子 DuMate / QClaw / AutoClaw·OpenClaw 等暂无官方稳定格式的平台，
// 用常见字段名启发式从会话/项目 JSON 中提取数据；只识别有明确 id + 时间或名称的结构，
// 避免把无关配置文件误判为项目。

const GENERIC_SUBDIRS = ['sessions', 'conversations', 'chats', 'chat', 'projects', 'logs', 'traces', 'history'];

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function num(v) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function genericTokens(rec) {
  const direct = num(pick(rec, ['totalTokens', 'tokens_used', 'tokenCount', 'token_count']));
  if (direct) return direct;
  const u = rec && (rec.tokenUsage || rec.usage || rec.token_usage);
  if (u && typeof u === 'object') {
    const t = num(pick(u, ['total_tokens', 'totalTokens'])) ||
      num(pick(u, ['prompt_tokens', 'promptTokens'])) + num(pick(u, ['completion_tokens', 'completionTokens']));
    return t;
  }
  return 0;
}

function genericFiles(rec) {
  const raw = pick(rec, ['artifacts', 'files', 'outputs', 'attachments']);
  if (!Array.isArray(raw)) return [];
  return raw.map(x => {
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object') return x.uri || x.path || x.name || x.title || '';
    return '';
  }).filter(Boolean).slice(0, 8);
}

function genericTime(rec, start) {
  const keys = start
    ? ['startedAt', 'started_at', 'createdAt', 'created_at', 'startTime', 'beginTime', 'date']
    : ['updatedAt', 'updated_at', 'endedAt', 'ended_at', 'lastActive', 'last_active', 'finishedAt'];
  const v = pick(rec, keys);
  if (v == null) return '';
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  return String(v);
}

function genericSummary(rec) {
  const s = pick(rec, ['summary', 'description', 'intro', 'objective', 'goal']);
  if (s && typeof s === 'string' && s.trim().length >= 4) {
    return s.trim().replace(/\s+/g, ' ').slice(0, 160);
  }
  const msgs = rec && (rec.messages || rec.chatHistory || rec.history);
  if (Array.isArray(msgs)) {
    for (const m of msgs) {
      const role = m && (m.role || m.type);
      const text = m && (m.content || m.text || m.message);
      if ((!role || /user|human/i.test(String(role))) && typeof text === 'string' && text.trim().length >= 4) {
        return text.replace(/\s+/g, ' ').slice(0, 160);
      }
    }
  }
  return '';
}

export function findGenericAgentProjects(label, roots, verbose) {
  const projects = [];
  const seen = new Set();
  for (const root of roots) {
    const base = expandPath(root);
    if (!fs.existsSync(base)) continue;
    const files = [];
    walk(base, 0, 5, files);
    for (const f of files) {
      const name = path.basename(f);
      if (!f.endsWith('.json')) continue;
      if (DATA_FILENAMES.includes(name) || name === 'panel-data.json') continue; // 面板数据交给 findDataFile 处理
      const parts = f.toLowerCase().split(path.sep);
      const inSub = GENERIC_SUBDIRS.some(s => parts.includes(s));
      const nameHit = /(session|conversation|chat|project|trace|history)/.test(name.toLowerCase());
      if (!inSub && !nameHit) continue;
      const d = readJsonSafe(f);
      if (!d) continue;
      const arr = Array.isArray(d.sessions) ? d.sessions
        : Array.isArray(d.conversations) ? d.conversations
        : Array.isArray(d.projects) ? d.projects
        : Array.isArray(d.chats) ? d.chats
        : Array.isArray(d) ? d
        : [d];
      for (const rec of arr) {
        if (!rec || typeof rec !== 'object') continue;
        const id = String(pick(rec, ['conversationId', 'sessionId', 'conversation_id', 'session_id', 'id', 'uuid']) || '');
        const name = String(pick(rec, ['title', 'name', 'subject']) || '').trim();
        const startedAt = genericTime(rec, true);
        const updatedAt = genericTime(rec, false) || startedAt;
        if (!id && !name) continue;
        if (!startedAt && !updatedAt && !name) continue;
        const key = (id || name) + '::' + (updatedAt || startedAt || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const tokens = genericTokens(rec);
        const msgs = rec && (rec.messages || rec.chatHistory || rec.history);
        const count = num(pick(rec, ['executionCount', 'execution_count', 'messageCount', 'turnCount', 'spans', 'count'])) ||
          (Array.isArray(msgs) ? msgs.length : 1);
        const files = genericFiles(rec);
        const summary = genericSummary(rec);
        const workDir = String(pick(rec, ['workDir', 'workdir', 'cwd', 'directory', 'workspace', 'workspaceFolder']) || '');
        const baseName = workDir ? path.basename(workDir) : '';
        const pname = name ||
          (baseName && baseName !== '.' ? label + ' · ' + baseName : label + ' 会话' + (startedAt ? ' · ' + startedAt.slice(0, 10) : ''));
        const stale = updatedAt ? Date.now() - Date.parse(updatedAt) > 14 * 86400000 : false;
        const milestones = (startedAt || updatedAt) ? [{
          date: String(updatedAt || startedAt).slice(0, 10),
          text: label + ' 会话执行（' + count + ' 次操作）',
          done: true
        }] : [];
        const next = [];
        if (stale) next.push({ text: '该会话超过 14 天未更新，请核对产出并决定继续或归档', p: 'low' });
        next.push({ text: '继续推进该项目，建议由 AI 依据会话内容补全下一步建议', p: 'mid' });
        const criteria = [];
        if (files.length) criteria.push({ text: '产出文档已归档（' + files.length + ' 个）', done: true });
        criteria.push({ text: '会话目标已记录，建议由 AI 依据会话补全验收标准', done: false });
        const decisions = [{
          date: String(updatedAt || startedAt || '').slice(0, 10),
          title: label + ' 会话记录',
          reason: '共 ' + Math.max(1, count) + ' 次操作 · 约 ' + fmtLocalTokens(tokens) + ' · 产出 ' + files.length + ' 个文档',
          tags: [label]
        }];
        projects.push({
          name: pname.slice(0, 60),
          sid: id,
          dir: workDir,
          source: label,
          device: os.hostname(),
          device_type: process.platform,
          cat: inferCat(workDir, summary),
          status: stale ? 'hold' : 'doing',
          progress: estimateProgress(stale ? 'hold' : 'doing', criteria),
          date: String(startedAt || updatedAt || '').slice(0, 10),
          updated: String(updatedAt || startedAt || '').slice(0, 10),
          tokens,
          conv: Math.max(1, count),
          intro: label + ' 会话 · 共 ' + Math.max(1, count) + ' 次操作 · 约 ' + fmtLocalTokens(tokens) + ' · 产出 ' + files.length + ' 个文档',
          agent: String(pick(rec, ['agentName', 'agent', 'platform']) || label).slice(0, 40),
          milestones, next, files, criteria, topics: [], decisions,
        });
      }
    }
  }
  if (verbose && projects.length) console.log(`  ${label} 适配：解析到 ${projects.length} 个会话/项目`);
  return projects;
}

// 除 WorkBuddy 深度解析外，对尚无专用解析器的平台走通用启发式解析
const GENERIC_PLATFORMS = (AGENT_ROOTS || []).filter(r => !['codex', 'workbuddy'].includes(r.label));

export function findAgentProjects(verbose) {
  const out = findWorkBuddyProjects(verbose);
  for (const g of GENERIC_PLATFORMS) {
    out.push(...findGenericAgentProjects(g.label, g.paths, verbose));
  }
  return out;
}

// 已删清单：网页删除的项目会记录到 ~/.goodname/deleted-projects.json，同步时跳过（防止复活）
export function loadDeletedKeys() {
  try {
    const p = path.join(os.homedir(), '.goodname', 'deleted-projects.json');
    const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (Array.isArray(arr)) {
      return new Set(arr.filter(x => x && x.name).map(x => x.name + '::' + (x.source || 'codex')));
    }
  } catch {}
  return new Set();
}

// 多平台轻量项目合并：保留面板既有条目，补充 WorkBuddy 等平台解析出的项目，跳过已删清单
export function mergeAgentProjects(panelProjects, agentProjects, extraDeleted) {
  const deleted = new Set([...loadDeletedKeys(), ...(extraDeleted || [])]);
  const seen = new Set();
  const indexByKey = new Map();
  const out = [];
  for (const p of panelProjects) {
    const key = (p.name || '') + '::' + (p.source || 'codex');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (deleted.has(key)) continue;
    out.push(p);
    indexByKey.set(key, out.length - 1);
  }
  for (const p of (agentProjects || [])) {
    const key = (p.name || '') + '::' + (p.source || 'agent');
    if (!key || deleted.has(key)) continue;
    // 同名会话（同属一个项目）累加合并，而不是丢弃：Token/对话数/文件/里程碑等全部合并
    if (indexByKey.has(key)) {
      mergeAgentProject(out[indexByKey.get(key)], p);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    indexByKey.set(key, out.length - 1);
  }
  return out;
}

function mergeAgentProject(base, p) {
  if (!base || !p || typeof p !== 'object') return base;
  base.tokens = (Number(base.tokens) || 0) + (Number(p.tokens) || 0);
  base.conv = (Number(base.conv) || 0) + (Number(p.conv) || 0);
  base.milestones = uniqArr([...(base.milestones || []), ...(p.milestones || [])], x => (x && x.text) || '');
  base.next = uniqArr([...(base.next || []), ...(p.next || [])], x => (x && x.text) || '');
  base.criteria = uniqArr([...(base.criteria || []), ...(p.criteria || [])], x => (x && x.text) || '');
  base.files = uniqArr([...(base.files || []), ...(p.files || [])], f => String(f || ''));
  base.topics = uniqArr([...(base.topics || []), ...(p.topics || [])], t => String(t || ''));
  base.decisions = uniqArr([...(base.decisions || []), ...(p.decisions || [])], x => (x && (x.title || x.decision)) || '');
  if (!base.intro && p.intro) base.intro = p.intro;
  if (String(p.updated || '').localeCompare(String(base.updated || '')) > 0) base.updated = p.updated;
  base.urgency = Math.max(Number(base.urgency || 0), Number(p.urgency || 0));
  return base;
}

// 合并历史：~/.goodname/merges.json（网页合并时由 hook 记录），供扫描时重新应用
export function loadMergeHistory() {
  try {
    const p = path.join(os.homedir(), '.goodname', 'merges.json');
    const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function uniqArr(arr, keyFn) {
  const seen = new Set();
  return (arr || []).filter(x => {
    const k = keyFn(x);
    if (k == null || k === '' || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// 把被合并项目的数据并进保留项目，并跳过被合并项目的重新生成
export function applyMergeHistory(list, extraMerges) {
  const seenM = new Set();
  const merges = [...loadMergeHistory(), ...(extraMerges || [])].filter(m => {
    const k = (m && m.keepName || '') + '|' + (m && m.removeName || '');
    if (!k || seenM.has(k)) return false;
    seenM.add(k);
    return true;
  });
  if (!merges.length || !Array.isArray(list)) return list;
  const removedKeys = new Set(
    merges.filter(m => m && m.removeName).map(m => m.removeName + '::' + (m.removeSource || 'codex'))
  );
  const out = [];
  for (const p of list) {
    const key = (p.name || '') + '::' + (p.source || 'codex');
    if (removedKeys.has(key)) continue; // 被合并项目不再单独出现
    for (const m of merges) {
      if (!m || m.keepName !== p.name || (m.keepSource || 'codex') !== (p.source || 'codex')) continue;
      const r = (m.removePayload && typeof m.removePayload === 'object') ? m.removePayload : {};
      p.milestones = uniqArr([...(p.milestones || []), ...(r.milestones || [])], x => (x && x.text) || '');
      p.next = uniqArr([...(p.next || []), ...(r.next || [])], x => (x && x.text) || '');
      p.criteria = uniqArr([...(p.criteria || []), ...(r.criteria || [])], x => (x && x.text) || '');
      p.files = uniqArr([...(p.files || []), ...(r.files || [])], f => String(f || ''));
      p.topics = uniqArr([...(p.topics || []), ...(r.topics || [])], t => String(t || ''));
      p.decisions = uniqArr([...(p.decisions || []), ...(r.decisions || [])], x => (x && (x.title || x.decision)) || '');
      p.tokens = Number(p.tokens || 0) + Number(r.tokens || 0);
      p.conv = Number(p.conv || 0) + Number(r.conv || 0);
      if (String(p.updated || '').localeCompare(String(r.updated || '')) < 0) p.updated = r.updated || p.updated;
      p.urgency = Math.max(Number(p.urgency || 0), Number(r.urgency || 0));
    }
    out.push(p);
  }
  return out;
}
