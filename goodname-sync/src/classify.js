// 项目甄别：区分「真正的项目」与「过短的日常问答」，避免把闲聊当项目上传。
// 判定优先级：Agent 分类清单（project-classify.json）> 启发式（Token/次数/产出）。
import fs from 'fs';
import path from 'path';
import os from 'os';

const CLASSIFY_PATH = path.join(os.homedir(), '.goodname', 'project-classify.json');

export function classifyKey(p){
  return String(p && (p.sid || p.dir || p.name) || '').trim();
}

export function isLikelyProject(p){
  if(!p) return false;
  if(Number(p.tokens) >= 2000) return true;
  if(Number(p.conv) >= 2) return true;
  if(Array.isArray(p.files) && p.files.length) return true;
  const s = String(p.summary || '').trim();
  if(s.length >= 6 && !/[?？]|[吗么呢]$/.test(s)) return true;
  return false;
}

export function excludeReason(p){
  if(Number(p.tokens) < 2000 && Number(p.conv) < 2 && !(Array.isArray(p.files) && p.files.length)) {
    return '过短的日常问答（Token/次数/产出均不足）';
  }
  return '';
}

export function loadClassify(){
  try {
    const d = JSON.parse(fs.readFileSync(CLASSIFY_PATH, 'utf-8'));
    return (d && d.rules && typeof d.rules === 'object') ? d.rules : {};
  } catch {
    return {};
  }
}

export function saveClassify(rules){
  try {
    fs.mkdirSync(path.dirname(CLASSIFY_PATH), { recursive: true });
    fs.writeFileSync(CLASSIFY_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), rules }, null, 2), 'utf-8');
  } catch (e) {
    console.log('  ⚠ 分类清单保存失败: ' + (e.message || e));
  }
}

export function buildClassifyPrompt(projects){
  const lines = [
    '你是项目识别助手。请判断下面每个会话是「真正的项目」还是「过短的日常问答」。',
    '判定标准：有明确任务目标、产出物、多次执行或较高 Token 的算项目（include）；一句话闲聊、临时提问、无产出的算日常问答（exclude）。',
    '只输出 JSON：{"<key>": "include" 或 "exclude"}，不要输出其他内容。',
    '',
    '会话清单：'
  ];
  (projects || []).forEach((p, i) => {
    lines.push(`${i + 1}. key=${classifyKey(p) || '无'} | Token=${p.tokens || 0} | 次数=${p.conv || 1} | 产出=${(p.files || []).length}`);
    const s = String(p.summary || p.intro || '').slice(0, 120);
    if(s) lines.push(`   摘要：${s}`);
  });
  return lines.join('\n');
}
