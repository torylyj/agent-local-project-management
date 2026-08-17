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

function inferCat(dir, summary) {
  const s = String(dir || '') + ' ' + String(summary || '');
  if (/transcrib|转录|视频|动画|剪辑|配音/i.test(s)) return 'video';
  if (/简历|求职|作品集|面试/i.test(s)) return 'content';
  if (/研究|调研|报告|论文/i.test(s)) return 'research';
  if (/代码|开发|脚本|程序|bug|接口/i.test(s)) return 'tooling';
  return 'tooling';
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
    const rec = bySession.get(sid) || { tokens: 0, count: 0, first: '', last: '', agent: d.trace.agentName || 'workbuddy', spans: 0, dates: [] };
    rec.tokens += Number(d.trace.totalTokens) || 0;
    rec.count += 1;
    rec.spans += Array.isArray(d.spans) ? d.spans.length : 0;
    if (d.trace.startedAt) rec.dates.push(d.trace.startedAt);
    if (d.trace.startedAt && (!rec.first || d.trace.startedAt < rec.first)) rec.first = d.trace.startedAt;
    if (d.trace.endedAt && d.trace.endedAt > rec.last) rec.last = d.trace.endedAt;
    if (!rec.summary && Array.isArray(d.spans)) {
      for (const s of d.spans) {
        const input = s && (s.toolInput || s.input);
        if (!input || typeof input !== 'string') continue;
        const clean = lastUserQuery(input).replace(/\s+/g, ' ').trim().slice(0, 120);
        if (clean && clean.length >= 4) { rec.summary = clean; break; }
      }
    }
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
      const r = bySession.get(targetSid) || { tokens: 0, count: 0, first: '', last: '', agent: rec.agent, spans: 0, dates: [] };
      r.tokens += rec.tokens; r.count += rec.count; r.spans += rec.spans;
      if (rec.first && (!r.first || rec.first < r.first)) r.first = rec.first;
      if (rec.last && rec.last > r.last) r.last = rec.last;
      if (rec.dates) r.dates.push(...rec.dates);
      if (!r.summary && rec.summary) r.summary = rec.summary;
      bySession.set(targetSid, r);
    } else if (rec.count) {
      bySession.set('orphan:' + (rec.first || Date.now()) + ':' + Math.random().toString(36).slice(2, 6), rec);
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
      if (a && (a.uri || a.name || a.title)) {
        const uri = a.uri || '';
        let pathVal = uri.replace(/^file:\/\//, '');
        try { pathVal = decodeURIComponent(pathVal); } catch (e) {}
        const tRaw = a.updatedAt || a.createdAt || '';
        const tNum = Number(tRaw);
        const ts = /^\d+$/.test(String(tRaw)) ? tNum : (Date.parse(tRaw) || 0);
        artifacts.push({ name: a.name || a.title || pathVal, path: pathVal || a.name || '', ts });
      }
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
    const milestones = (rec && Array.isArray(rec.dates) ? rec.dates : []).slice(-5).map(dt => ({
      date: String(dt || '').slice(0, 10),
      text: 'WorkBuddy 会话执行（' + ((rec && rec.spans && rec.count) ? Math.max(1, Math.round(rec.spans / rec.count)) : 1) + ' 次操作）',
      done: true
    }));
    const next = [];
    if (rec && rec.summary) next.push({ text: '继续推进会话目标：' + rec.summary.slice(0, 90), p: 'mid' });
    if (stale) next.push({ text: '该会话已超过 14 天未更新，请核对产出并决定继续或归档', p: 'low' });
    if (!next.length) next.push({ text: '查看会话产出并推进下一步', p: 'mid' });
    const files = [];
    if (startedAt || updatedAt) {
      const lo = (Date.parse(startedAt) || 0) - 2 * DAY;
      const up = Date.parse(updatedAt) || Date.now();
      const hi = up + 2 * DAY;
      artifacts.forEach(a => {
        if (a.ts && a.ts >= lo && a.ts <= hi && files.length < 8) files.push(a.path || a.name);
      });
    }
    const criteria = [];
    if (rec && rec.summary) criteria.push({ text: '完成会话目标：' + rec.summary.slice(0, 70), done: false });
    if (files.length) criteria.push({ text: '会话产出文件已归档', done: true });
    if (!criteria.length) criteria.push({ text: '会话执行完成（建议由 AI 依据会话补全验收标准）', done: false });
    const decisions = rec ? [{
      date: String((rec.last || rec.first || '').slice(0, 10)),
      title: 'WorkBuddy 会话',
      reason: rec.summary ? '会话要点：' + rec.summary.slice(0, 90) : '会话追踪记录',
      tags: ['workbuddy']
    }] : [];
    projects.push({
      name: sessionName(s && s.workDir, sid, updatedAt),
      dir: (s && s.workDir) || '',
      source: 'workbuddy',
      cat: inferCat(s && s.workDir, rec && rec.summary),
      status: stale ? 'hold' : 'doing',
      date: String(startedAt || '').slice(0, 10),
      updated: String(updatedAt || '').slice(0, 10),
      tokens: (rec && rec.tokens) || 0,
      conv: (rec && rec.count) || 1,
      intro: (rec && rec.summary)
        ? '来自 WorkBuddy 的会话：' + rec.summary
        : '来自 WorkBuddy 的会话，共 ' + ((rec && rec.count) || 1) + ' 次执行。',
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
  const out = [];
  for (const p of panelProjects) {
    const key = (p.name || '') + '::' + (p.source || 'codex');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (deleted.has(key)) continue;
    out.push(p);
  }
  for (const p of (agentProjects || [])) {
    const key = (p.name || '') + '::' + (p.source || 'agent');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (deleted.has(key)) continue;
    out.push(p);
  }
  return out;
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
