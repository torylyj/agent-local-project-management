import fs from 'fs';
import path from 'path';
import os from 'os';
import { DEFAULT_SEARCH_ROOTS, PANEL_FILENAMES, DATA_FILENAMES, WORKBUDDY_DIR } from './config.js';

function expandPath(p) {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
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
      if (DATA_FILENAMES.includes(name)) return 0;
      if (name === 'codex-project-tracker.html') return 1;
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
  // 2) traces/**/*.json：按 sessionId 聚合 Token / 次数 / 最近时间
  const bySession = new Map();
  const traceFiles = [];
  walk(path.join(wbRoot, 'traces'), 0, 6, traceFiles);
  for (const f of traceFiles) {
    if (!f.endsWith('.json')) continue;
    const d = readJsonSafe(f);
    if (!d || !d.trace || !d.trace.sessionId) continue;
    const sid = d.trace.sessionId;
    const rec = bySession.get(sid) || { tokens: 0, count: 0, first: '', last: '', agent: d.trace.agentName || 'workbuddy' };
    rec.tokens += Number(d.trace.totalTokens) || 0;
    rec.count += 1;
    if (d.trace.startedAt && (!rec.first || d.trace.startedAt < rec.first)) rec.first = d.trace.startedAt;
    if (d.trace.endedAt && d.trace.endedAt > rec.last) rec.last = d.trace.endedAt;
    bySession.set(sid, rec);
  }
  const push = (sid, rec, s) => {
    if (!sid || seen.has(sid)) return;
    seen.add(sid);
    const updatedAt = rec && rec.last ? rec.last : (s && (s.resumedAt || s.startedAt));
    const startedAt = (s && s.startedAt) || (rec && rec.first);
    projects.push({
      name: sessionName(s && s.workDir, sid, updatedAt),
      dir: (s && s.workDir) || '',
      source: 'workbuddy',
      status: 'doing',
      date: String(startedAt || '').slice(0, 10),
      updated: String(updatedAt || '').slice(0, 10),
      tokens: (rec && rec.tokens) || 0,
      conv: (rec && rec.count) || 1,
      intro: '来自 WorkBuddy 的会话，共 ' + ((rec && rec.count) || 1) + ' 次执行。',
      agent: (rec && rec.agent) || 'workbuddy',
      milestones: [], next: [], criteria: [], files: [], topics: [], decisions: [],
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

// 多平台轻量项目合并：保留面板既有条目，补充 WorkBuddy 等平台解析出的项目
export function mergeAgentProjects(panelProjects, agentProjects) {
  if (!agentProjects || !agentProjects.length) return panelProjects;
  const seen = new Set();
  const out = [];
  for (const p of panelProjects) {
    const key = (p.name || '') + '::' + (p.source || 'codex');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  for (const p of agentProjects) {
    const key = (p.name || '') + '::' + (p.source || 'agent');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
