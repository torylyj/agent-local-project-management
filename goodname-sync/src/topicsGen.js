// 创作选题自动生成：新账号没有选题时，按已有项目自动生成「选题 + 创作步骤」，
// 让创作中心不再只有灵感库空壳。结构对齐面板 topic 渲染（plan 支持 {h} 标题与文本）。
const TOPIC_CATS = new Set(['content', 'video', 'research', 'ai-app', 'engineering']);

function pickCat(p) {
  const c = p && (p.cat || p.category);
  return TOPIC_CATS.has(c) ? c : 'content';
}

function firstNext(p) {
  const arr = p && p.next;
  if (!Array.isArray(arr) || !arr.length) return '';
  const n = arr[0];
  const t = typeof n === 'string' ? n : (n && (n.text || n.title)) || '';
  return String(t).trim();
}

export function generateTopicsFromProjects(projects, skipProjects) {
  const skip = new Set(skipProjects || []);
  const seen = new Set();
  const out = [];
  for (const p of projects || []) {
    if (!p || typeof p !== 'object' || !p.name) continue;
    const base = String(p.name).trim();
    if (base.length < 2 || skip.has(base) || seen.has(base)) continue;
    seen.add(base);
    const cat = pickCat(p); // 无法识别的分类统一按 content 出选题，保证每个项目都有对应选题
    const nextTip = firstNext(p);
    const ms = Array.isArray(p.milestones)
      ? p.milestones.filter(m => m && m.done && m.text).slice(0, 2).map(m => String(m.text))
      : [];
    const msLine = ms.length ? '，已完成「' + ms.join('」「') + '」' : '';
    const title = base + ' · 内容选题';
    const desc = '围绕「' + base + '」产出一条可发布内容，把项目进展、成果与踩坑沉淀为选题素材'
      + (ms.length ? '（已推进 ' + ms.length + ' 个里程碑）' : '') + '。';
    const plan = [
      { h: '目标与定位' },
      '把项目「' + base + '」的核心产出/经验整理成一条可传播内容' + msLine + '；目标平台按项目受众选择（抖音 / 小红书 / B 站 / 公众号）。',
      { h: '制作步骤' },
      '① 素材整理：从项目里程碑与产出文件中提取 3-5 个亮点（数据成果、踩坑经验、方法沉淀）' + (ms.length ? '，重点围绕「' + ms.join('」「') + '」展开' : '') + '。',
      '② 结构设计：钩子（成果前置或反差）→ 过程拆解 → 方法沉淀 → 结尾引导收藏/关注。',
      '③ 成稿制作：按平台规格产出图文或短视频，标题含项目关键词，封面突出数字或成果。',
      '④ 发布运营：选择活跃时段发布，评论区置顶补充细节，发布后 24h 内回收数据复盘。',
      { h: '排期建议' },
      'Day 1 素材整理与脚本；Day 2 制作；Day 3 发布与数据复盘。',
      { h: '验收标准' },
      '发布后 24h 内完成数据记录；完播/收藏/评论任一指标达到同类内容中位线即判定选题成立。',
      { h: '参考素材与落地' },
      '参考：项目「' + base + '」的里程碑（' + (ms.length ? ms.join('；') : '见项目详情') + '）、产出文件与决策日志。',
      nextTip ? '下一步：' + nextTip.slice(0, 80) + '，可同步作为选题素材补充。' : '',
      '落地：直接复用项目现有素材' + msLine + '，零新增拍摄成本。'
    ].filter(x => x !== '');
    out.push({ title, desc, project: base, cat, plan });
  }
  return out;
}
