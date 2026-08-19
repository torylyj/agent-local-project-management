// 字段所有权矩阵 + 按字段合并（Linear 式属性级 LWW）+ 冲突备份（Obsidian 式不静默覆盖）
// 设计：管理字段（status/progress/urgency/cat）云端优先——网页在云端改的最后写入胜出；
//       内容字段（intro/milestones/next/criteria/files/decisions/topics）本地优先——Agent 扫描生成；
//       本地为空的内容字段用云端补全，避免网页补充的数据被覆盖丢失。
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const STATE_PATH = path.join(os.homedir(), '.goodname', 'sync-merge-state.json');
const REVISIONS_DIR = path.join(os.homedir(), '.goodname', 'revisions');

export const CLOUD_MANAGED = ['status', 'progress', 'urgency', 'cat'];
export const CONTENT_FIELDS = ['intro', 'description', 'milestones', 'next', 'criteria', 'files', 'decisions', 'topics'];

function keyOf(p) {
  return (p && p.name ? p.name : '') + '::' + (p && p.source ? p.source : 'codex');
}

function fieldHash(p) {
  const obj = {};
  for (const f of CONTENT_FIELDS) {
    if (p && p[f] !== undefined) obj[f] = p[f];
  }
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

export function loadMergeState() {
  try {
    const d = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    return (d && d.projects) || {};
  } catch {
    return {};
  }
}

export function saveMergeState(projects) {
  try {
    const state = { updatedAt: new Date().toISOString(), projects: {} };
    for (const p of projects || []) {
      if (!p || !p.name) continue;
      state.projects[keyOf(p)] = { contentHash: fieldHash(p), at: new Date().toISOString() };
    }
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    console.log('  ⚠ 合并状态保存失败: ' + (e.message || e));
  }
}

function backupCloud(payload, key) {
  try {
    fs.mkdirSync(REVISIONS_DIR, { recursive: true });
    const safe = String(key).replace(/[^\w\u4e00-\u9fa5.-]/g, '_').slice(0, 60);
    const file = path.join(REVISIONS_DIR, safe + '-' + Date.now() + '.json');
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
    return file;
  } catch (e) {
    return null;
  }
}

function isEmpty(v) {
  return v == null || (Array.isArray(v) && !v.length) || (typeof v === 'string' && !String(v).trim());
}

function pick(p, f) {
  if (!p || typeof p !== 'object') return undefined;
  if (f === 'cat') return p.cat ?? p.category;
  if (f === 'category') return p.category ?? p.cat;
  return p[f];
}

export function mergeCloudFields(localProjects, cloudRows, verbose) {
  const cloudMap = {};
  for (const r of cloudRows || []) {
    cloudMap[(r.name || '') + '::' + (r.source || 'codex')] = r;
  }
  const prevState = loadMergeState();
  const conflicts = [];
  const merged = (localProjects || []).map(p => {
    if (!p || typeof p !== 'object' || !p.name) return p;
    const key = keyOf(p);
    const cloud = cloudMap[key];
    if (!cloud) return p;
    const cp = (cloud.payload && typeof cloud.payload === 'object') ? cloud.payload : {};
    const next = { ...p };

    // 1) 管理字段：云端优先（网页最后写入胜出）
    for (const f of CLOUD_MANAGED) {
      const cv = pick(cp, f);
      if (cv !== undefined && cv !== null && cv !== '') next[f] = cv;
    }
    if (cloud.status && !next.status) next.status = cloud.status; // 表列兜底

    // 2) 内容字段：本地非空优先，本地为空用云端补全
    for (const f of CONTENT_FIELDS) {
      if (isEmpty(p[f]) && !isEmpty(cp[f])) next[f] = cp[f];
    }

    // 3) 冲突检测：上次同步后本地与云端内容都变过 → 备份云端旧版，不静默丢失
    const prev = prevState[key];
    if (prev && prev.contentHash) {
      const localHash = fieldHash(p);
      const cloudHash = fieldHash(cp);
      if (localHash !== prev.contentHash && cloudHash !== prev.contentHash && localHash !== cloudHash) {
        const backup = backupCloud(cp, key);
        conflicts.push({ key, name: p.name, backup });
        if (verbose) console.log(`  ⚠ 内容冲突（本地与云端都改过）→ 云端旧版已备份: ${backup || '失败'} · ${key}`);
      }
    }

    // 4) tokens 取较大值、updated 取较新值，避免跨设备互相覆盖
    next.tokens = Math.max(Number(p.tokens) || 0, Number(cloud.tokens_used) || 0);
    const cloudDay = String(cloud.updated_at || '').slice(0, 10);
    if (cloudDay > String(next.updated || '')) next.updated = cloudDay;
    return next;
  });
  if (verbose && conflicts.length) {
    console.log(`  ⚠ 共 ${conflicts.length} 个项目存在内容冲突，云端旧版已备份到 ~/.goodname/revisions/`);
  }
  return { projects: merged, conflicts };
}

// 上传后核对：本地合并结果 vs 云端实际存储
export function verifyDiff(localProjects, cloudRows, verbose) {
  const cloudMap = {};
  for (const r of cloudRows || []) {
    cloudMap[(r.name || '') + '::' + (r.source || 'codex')] = r;
  }
  const lines = [];
  let bad = 0;
  for (const p of localProjects || []) {
    if (!p || !p.name) continue;
    const key = keyOf(p);
    const r = cloudMap[key];
    if (!r) {
      lines.push('· 云端缺失: ' + key);
      bad++;
      continue;
    }
    const cp = (r.payload && typeof r.payload === 'object') ? r.payload : {};
    for (const f of ['status', 'progress', 'urgency', 'cat']) {
      const lv = pick(p, f);
      const cv = pick(cp, f);
      if (String(lv ?? '') !== String(cv ?? '')) {
        lines.push(`· ${key} 字段差异 ${f}: 本地=${lv ?? '空'} 云端=${cv ?? '空'}`);
        bad++;
      }
    }
    for (const f of CONTENT_FIELDS) {
      if (!isEmpty(p[f]) && isEmpty(cp[f])) {
        lines.push(`· ${key} 云端缺少内容字段 ${f}`);
        bad++;
      }
    }
  }
  if (verbose) {
    console.log(`  差异核对：${bad ? bad + ' 处差异' : '本地与云端一致'}（项目 ${(localProjects || []).length} 个）`);
    lines.slice(0, 20).forEach(x => console.log('  ' + x));
    if (lines.length > 20) console.log('  … 共 ' + lines.length + ' 行');
  }
  return { bad, lines };
}

// 月度 Token：真实「会话逐月消耗」，而不是「项目累计按启动月归因」。
// - Codex：来自 scanCodexSessionMonthly（每个会话取最终累计 total_tokens，含缓存输入）
// - WorkBuddy / 其他平台：按每条 trace 的真实 token 归月（items 里带 tokens+date）
// - 无 items 时兜底用项目累计按 date 月归入（近似，避免漏计）
export function aggregateMonthly(payload, cloudRows, codexMonthly) {
  const monthlyMap = new Map();
  for (const [ym, rec] of Object.entries(codexMonthly || {})) {
    monthlyMap.set(ym, (monthlyMap.get(ym) || 0) + (rec.tokens || 0));
  }
  const seen = new Set();
  const addProject = (p) => {
    if (!p) return;
    const key = (p.name || '') + '::' + (p.source || 'codex');
    if (seen.has(key) || (p.source || 'codex') === 'codex') return; // Codex 由 codexMonthly 覆盖，避免双计
    seen.add(key);
    const pp = (p.payload && typeof p.payload === 'object') ? p.payload : p;
    const items = Array.isArray(pp.items) ? pp.items : [];
    let added = false;
    for (const it of items) {
      const t = Number(it && it.tokens) || 0;
      const ym = String((it && it.date) || '').slice(0, 7);
      if (!t || !/^\d{4}-\d{2}$/.test(ym)) continue;
      monthlyMap.set(ym, (monthlyMap.get(ym) || 0) + t);
      added = true;
    }
    if (!added) {
      const t = Number(p.tokens_used) || Number(pp.tokens) || 0;
      const ym = String(pp.date || pp.updated || '').slice(0, 7);
      if (t && /^\d{4}-\d{2}$/.test(ym)) monthlyMap.set(ym, (monthlyMap.get(ym) || 0) + t);
    }
  };
  for (const p of (payload.projects || [])) addProject(p);
  for (const r of (cloudRows || [])) {
    if ((r.source || 'codex') === 'codex') continue;
    addProject({ name: r.name, source: r.source, tokens_used: r.tokens_used, payload: r.payload });
  }
  return [...monthlyMap].sort((a, b) => a[0].localeCompare(b[0])).map(([year_month, tokens]) => ({
    year_month,
    tokens,
    cost_estimate: parseFloat(((tokens || 0) * 0.3 / 1000000).toFixed(2)),
  }));
}
