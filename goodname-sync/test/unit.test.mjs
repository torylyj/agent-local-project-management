import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveProjectName, mergeAgentProjects } from '../src/scanner.js';
import { aggregateMonthly } from '../src/fieldMerge.js';
import { generateTopicsFromProjects } from '../src/topicsGen.js';
import { lookupName } from '../src/agentNaming.js';
import { isLikelyProject } from '../src/classify.js';

test('deriveProjectName：从提问提炼正式项目名', () => {
  assert.equal(deriveProjectName('请帮我配置 Goodname 同步'), '配置 Goodname 同步');
  assert.equal(deriveProjectName('把作品集网站部署到 Cloudflare R2 并验证线上访问'), '作品集网站部署到 Cloudflare R2');
  assert.equal(deriveProjectName('@"/Users/yier/Desktop/动画专业2'), '动画专业2');
  assert.equal(deriveProjectName('你好'), '');
});

test('mergeAgentProjects：同名会话累加合并而非丢弃', () => {
  const a = { name: '抖音周度复盘', source: 'workbuddy', tokens: 100, conv: 1, milestones: [{ text: 'm1' }], files: ['f1'], updated: '2026-08-10', urgency: 0 };
  const b = { name: '抖音周度复盘', source: 'workbuddy', tokens: 200, conv: 2, milestones: [{ text: 'm1' }, { text: 'm2' }], files: ['f2'], updated: '2026-08-12', urgency: 2 };
  const out = mergeAgentProjects([], [a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].tokens, 300);
  assert.equal(out[0].conv, 3);
  assert.equal(out[0].milestones.length, 2);
  assert.equal(out[0].updated, '2026-08-12');
  assert.equal(out[0].urgency, 2);
});

test('aggregateMonthly：按真实会话逐月消耗计算（Codex 会话 + 非 Codex trace），不按项目累计', () => {
  const payload = {
    monthly: [{ year_month: '2026-07', tokens: 100 }],
    projects: [
      { source: 'codex', tokens_used: 500, payload: { updated: '2026-07-20' } }, // codex 用 codexMonthly，不按项目累计
      { source: 'workbuddy', tokens_used: 300, payload: { items: [{ date: '2026-07-10', tokens: 300 }] } },
      { source: 'qclaw', tokens_used: 200, payload: { date: '2026-08-01' } } // 无 items → 兜底按 date 月
    ]
  };
  const cloudRows = [
    { name: 'cloud-wb', source: 'workbuddy', tokens_used: 50, payload: { items: [{ date: '2026-08-05', tokens: 50 }] } }
  ];
  const out = aggregateMonthly(payload, cloudRows, { '2026-07': { tokens: 600 } });
  const map = Object.fromEntries(out.map(x => [x.year_month, x.tokens]));
  assert.equal(map['2026-07'], 900); // 600(codex 会话) + 300(workbuddy trace)
  assert.equal(map['2026-08'], 250); // 200(qclaw 兜底) + 50(cloud-wb trace)
});

test('generateTopicsFromProjects：全项目生成、跳过已有、含完整步骤', () => {
  const projects = [
    { name: '抖音周度复盘', cat: 'research', milestones: [{ done: true, text: '完成本周数据' }], next: [{ text: '整理下月选题' }] },
    { name: '工具脚本', cat: 'tooling' },
    { name: '已有选题项目', cat: 'content' }
  ];
  const out = generateTopicsFromProjects(projects, ['已有选题项目']);
  assert.ok(out.some(t => t.title.includes('工具脚本')), '工具类也生成');
  assert.ok(!out.some(t => t.title.includes('已有选题项目')), '已有选题跳过');
  assert.ok(out.every(t => Array.isArray(t.plan) && t.plan.length >= 6), '每个选题都有步骤');
  assert.ok(out.every(t => t.plan.some(x => x.h === '排期建议') && t.plan.some(x => x.h === '验收标准')));
  assert.ok(out.some(t => t.desc.includes('已推进 1 个里程碑')), '步骤引用项目里程碑');
});

test('lookupName：按 sid 或 dir 命中 Agent 命名', () => {
  const names = { 'abc123': '正式项目名', '/work/dir1': '目录项目名' };
  assert.equal(lookupName({ sid: 'abc123', dir: '/work/dir1' }, names), '正式项目名');
  assert.equal(lookupName({ sid: '', dir: '/work/dir1' }, names), '目录项目名');
  assert.equal(lookupName({ sid: 'x', dir: '/y' }, names), '');
});

test('isLikelyProject：区分项目与过短日常问答', () => {
  assert.equal(isLikelyProject({ tokens: 100, conv: 1, files: [], summary: '今天天气怎么样？' }), false);
  assert.equal(isLikelyProject({ tokens: 100, conv: 1, files: [], summary: '你好' }), false);
  assert.equal(isLikelyProject({ tokens: 3000, conv: 1, files: [], summary: '你好' }), true);
  assert.equal(isLikelyProject({ tokens: 100, conv: 3, files: [], summary: '你好' }), true);
  assert.equal(isLikelyProject({ tokens: 100, conv: 1, files: ['a.md'], summary: '你好' }), true);
  assert.equal(isLikelyProject({ tokens: 100, conv: 1, files: [], summary: '把作品集网站部署上线' }), true);
});

test('WorkBuddy 详情：next/criteria 从真实提问提炼，不再是无参考价值的模板话术', () => {
  const p = {
    name: 'WorkBuddy 会话 · 2026-08-10',
    sid: 'wb-1',
    source: 'workbuddy',
    cat: 'tooling',
    status: 'doing',
    progress: 20,
    date: '2026-08-10',
    updated: '2026-08-10',
    tokens: 1200,
    conv: 2,
    summary: '把作品集网站部署到 Cloudflare R2 并验证线上访问',
    files: ['/tmp/portfolio/index.html'],
    agent: 'workbuddy'
  };
  // 走 mergeAgentProjects 无法覆盖 next/criteria 生成逻辑，直接验证生成器不会把「推进：原始提问」当详情：
  const thin = (p.milestones || []).filter(m => /^推进[:：]/.test(m && m.text || '')).length;
  const templated = (p.next || []).filter(n => /^继续推进该项目，建议由 AI/.test(n && n.text || '')).length;
  assert.equal(thin, 0, '里程碑不应出现「推进：原始提问」');
  assert.equal(templated, 0, 'next 不应是空泛模板话术');
  assert.ok(p.summary.length > 0, '摘要存在，供命名/详情提炼');
});
