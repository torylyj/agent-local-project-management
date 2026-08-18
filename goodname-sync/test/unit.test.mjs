import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveProjectName, mergeAgentProjects } from '../src/scanner.js';
import { aggregateMonthly } from '../src/fieldMerge.js';
import { generateTopicsFromProjects } from '../src/topicsGen.js';
import { lookupName } from '../src/agentNaming.js';

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

test('aggregateMonthly：Agent 平台 Token 计入月度且不双计 Codex', () => {
  const payload = {
    monthly: [{ year_month: '2026-07', tokens: 100 }],
    projects: [
      { source: 'codex', tokens_used: 500, payload: { updated: '2026-07-20' } },
      { source: 'workbuddy', tokens_used: 300, payload: { updated: '2026-07-10' } },
      { source: 'qclaw', tokens_used: 200, payload: { date: '2026-08-01' } }
    ]
  };
  const out = aggregateMonthly(payload);
  const map = Object.fromEntries(out.map(x => [x.year_month, x.tokens]));
  assert.equal(map['2026-07'], 400);
  assert.equal(map['2026-08'], 200);
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
