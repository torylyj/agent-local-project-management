import { findDataFile, findAgentProjects, mergeAgentProjects, applyMergeHistory } from './scanner.js';
import { parseDataFile, buildUploadPayload } from './parser.js';
import { mergeCloudFields, saveMergeState, verifyDiff, aggregateMonthly } from './fieldMerge.js';
import { loadAgentNames, saveAgentNames, lookupName, agentNameKey, buildNamingPrompt, writePendingNames, generateNamesWithCodex } from './agentNaming.js';
import { generateTopicsFromProjects } from './topicsGen.js';
import { loadClassify, saveClassify, classifyKey, isLikelyProject, excludeReason, buildClassifyPrompt } from './classify.js';
import { uploadWithKey, uploadWithToken, exchangeDeviceCode, getSyncStatus, listProjects, listDeletedProjectsToken, listMergeHistoryToken, expireHiddenProjectsToken, listProjectsToken, cleanupDeviceTokensToken, deleteProjectToken, recordSyncEvent, claimSyncTask, completeSyncTask } from './uploader.js';
import { loadConfig, saveConfig, AGENT_ROOTS } from './config.js';
import { daemonLoop, installService, uninstallService, statusService } from './service.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveKey(options) {
  const config = loadConfig();
  const key = options.key || process.env.CODEX_SYNC_KEY || config.sync_key;
  if (!key) {
    console.error('错误: 请提供同步密钥');
    console.error('用法: node ~/.goodname/agent-sync/bin/goodname-sync.js [source] [选项]');
    console.error('或设置环境变量: export CODEX_SYNC_KEY=sk_xxx');
    console.error('或让本机 Codex 把密钥保存到 ~/.goodname/config.json');
    process.exit(1);
  }
  return key;
}

// 优先使用设备令牌（免密钥模式），其次兼容旧版同步密钥
function resolveCredential(options) {
  const config = loadConfig();
  if (options.key || process.env.CODEX_SYNC_KEY) {
    return { type: 'key', value: options.key || process.env.CODEX_SYNC_KEY };
  }
  if (config.device_token) return { type: 'token', value: config.device_token };
  if (config.sync_key) return { type: 'key', value: config.sync_key };
  console.error('错误: 未配置同步凭证');
  console.error('方式一（推荐，无需 API Key）：在面板生成一次性安装码，然后运行 node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --setup <安装码>');
  console.error('方式二（兼容旧版）：让本机 Codex 把同步密钥保存到 ~/.goodname/config.json');
  process.exit(1);
}

export async function syncAction(source, options) {
  if (options.saveKey) {
    const p = saveConfig({ sync_key: options.saveKey, saved_at: new Date().toISOString() });
    console.log('✓ 密钥已保存到 ' + p);
  }

  if (options.service && !options.setup) {
    if (options.service === 'install') await installService();
    else if (options.service === 'uninstall') await uninstallService();
    else if (options.service === 'status') statusService();
    else {
      console.error('未知操作: ' + options.service + '（install | uninstall | status）');
      process.exit(1);
    }
    process.exit(0);
  }

  if (options.setup) {
    console.log('🔑 正在兑换一次性安装码（30 分钟有效，仅可使用一次）...');
    const token = await exchangeDeviceCode(options.setup);
    const p = saveConfig({ device_token: token, saved_at: new Date().toISOString() });
    console.log('✓ 设备授权成功！已保存本地设备令牌（30 天有效，可在面板吊销）');
    console.log('  配置: ' + p);
    if (options.service === 'install') {
      console.log('⚙️  正在安装常驻同步服务（每 3 小时自动同步 · 失败重试 · 开机补跑）...');
      await installService();
    } else if (options.service && options.service !== 'uninstall' && options.service !== 'status') {
      console.error('未知操作: ' + options.service + '（install | uninstall | status）');
      process.exit(1);
    }
    if (!options.auto) {
      console.log('  现在可运行：node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --auto');
      process.exit(0);
    }
  }

  if (options.detect) {
    detectAgents();
    process.exit(0);
  }

  if (options.generateNames) {
    const agentProjects = findAgentProjects(options.verbose);
    const withKeys = (agentProjects || []).filter(p => agentNameKey(p));
    if (!withKeys.length) {
      console.log('未发现需要命名的 Agent 会话项目。');
      process.exit(0);
    }
    writePendingNames(withKeys);
    console.log('═══════════════════════════════════════');
    console.log('  Agent 项目命名清单（请把下面内容交给任意 Agent 生成项目名）');
    console.log('═══════════════════════════════════════');
    console.log('');
    console.log(buildNamingPrompt(withKeys));
    console.log('');
    console.log('把 Agent 返回的 JSON 保存为 ~/.goodname/project-names.json，');
    console.log('或直接告诉 Agent 写入该文件，然后重新同步即可用正式项目名上传。');
    console.log('本机有 Codex 时，也可直接运行：node .../goodname-sync.js --auto --ai-names');
    process.exit(0);
  }

  if (options.classify) {
    const agentProjects = findAgentProjects(options.verbose);
    const withKeys = (agentProjects || []).filter(p => classifyKey(p));
    if (!withKeys.length) {
      console.log('未发现需要甄别的 Agent 会话。');
      process.exit(0);
    }
    console.log('═══════════════════════════════════════');
    console.log('  项目 / 日常问答 甄别提示词（交给任意 Agent）');
    console.log('═══════════════════════════════════════');
    console.log('');
    console.log(buildClassifyPrompt(withKeys));
    console.log('');
    console.log('把 Agent 返回的 JSON 保存为 ~/.goodname/project-classify.json，格式：');
    console.log('  {"rules": {"<key>": "include" 或 "exclude"}}');
    console.log('然后重新同步；未分类的会话默认按 Token/次数/产出启发式判断。');
    process.exit(0);
  }

  if (options.init) {
    initTemplate(options.dir);
    process.exit(0);
  }

  if (options.verifyCloud) {
    const cred = resolveCredential(options);
    if (cred.type !== 'token') {
      console.error('--verify-cloud 需要免密钥设备令牌模式');
      process.exit(1);
    }
    const rows = await listProjectsToken(cred.value);
    console.log('═══════════════════════════════════════');
    console.log('  云端项目回读（设备令牌）');
    console.log('═══════════════════════════════════════');
    if (!rows.length) { console.log('  云端暂无项目'); process.exit(0); }
    rows.forEach(r => {
      const p = (r.payload && typeof r.payload === 'object') ? r.payload : {};
      const counts = {
        ms: Array.isArray(p.milestones) ? p.milestones.length : 0,
        next: Array.isArray(p.next) ? p.next.length : 0,
        criteria: Array.isArray(p.criteria) ? p.criteria.length : 0,
        decisions: Array.isArray(p.decisions) ? p.decisions.length : 0,
        files: Array.isArray(p.files) ? p.files.length : 0,
        cat: p.cat || '',
        intro: (p.intro || '').length
      };
      console.log('  · ' + r.name + ' [' + (r.source || '') + '] 状态:' + (r.status || '') + ' Token:' + (Number(r.tokens_used) || 0).toLocaleString());
      console.log('      cat=' + counts.cat + ' 里程碑=' + counts.ms + ' 下一步=' + counts.next + ' 完成标准=' + counts.criteria + ' 决策=' + counts.decisions + ' 文件=' + counts.files + ' 简介长度=' + counts.intro);
    });
    process.exit(0);
  }

  if (options.status) {
    const key = resolveKey(options);
    try {
      const st = await getSyncStatus(key);
      if (st && st.error) throw new Error(st.error);
      console.log('═══════════════════════════════════════');
      console.log('  Goodname 同步状态');
      console.log('═══════════════════════════════════════');
      console.log(`  项目数量：${st.project_count || 0}`);
      console.log(`  对话总数：${st.conversation_count || 0}`);
      console.log(`  Token 总量：${Number(st.total_tokens || 0).toLocaleString()}`);
      console.log(`  上次同步：${st.last_synced || '从未'}`);
      console.log('═══════════════════════════════════════');
      process.exit(0);
    } catch (err) {
      console.error('状态查询失败: ' + err.message);
      console.error('提示：需先在 Supabase 执行 fix_dynamic.sql 中的 get_sync_status 函数');
      process.exit(1);
    }
  }

  const doSync = async () => {
    console.log('\n📁 扫描本地数据...');
    const cred = resolveCredential(options);
    // 拉取云端已删清单（跨设备删除状态），合并到本机已删清单
    let cloudDeletedKeys = [];
    let cloudMerges = [];
    let cloudRows = [];
    if (cred.type === 'token') {
      try {
        const rows = await listDeletedProjectsToken(cred.value);
        cloudDeletedKeys = (rows || []).map(r => (r.name || '') + '::' + (r.source || 'codex'));
        if (options.verbose && cloudDeletedKeys.length) console.log('  云端已删清单：' + cloudDeletedKeys.length + ' 条');
      } catch(e){ if (options.verbose) console.log('  云端已删清单拉取失败（仅用本地清单）: ' + e.message); }
      try {
        cloudMerges = await listMergeHistoryToken(cred.value);
        if (options.verbose && cloudMerges.length) console.log('  云端合并历史：' + cloudMerges.length + ' 条');
      } catch(e){ if (options.verbose) console.log('  云端合并历史拉取失败（仅用本地）: ' + e.message); }
      try {
        const expired = await expireHiddenProjectsToken(cred.value);
        if (expired) console.log('  回收站到期清理：' + expired + ' 项已永久删除');
      } catch(e){}
      try {
        const cleaned = await cleanupDeviceTokensToken(cred.value);
        if (cleaned) console.log('  设备令牌清理：' + cleaned + ' 个过期/吊销令牌已移除');
      } catch(e){}
      try {
        cloudRows = await listProjectsToken(cred.value);
        if (options.verbose) console.log('  云端项目状态拉取：' + cloudRows.length + ' 条（用于字段级合并）');
      } catch(e){ if (options.verbose) console.log('  云端项目状态拉取失败（跳过字段合并）: ' + e.message); }
    }
    let panelProjects = [];
    let topics = [];
    let monthly = {};
    let dataFile = null;
    try {
      dataFile = findDataFile(options.dir, options.file, options.verbose);
      if (options.verbose) console.log(`  数据文件: ${dataFile}`);
      const data = parseDataFile(dataFile);
      panelProjects = data.projects || [];
      if (data.current && data.current.name) panelProjects = [data.current, ...panelProjects];
      topics = data.topics || [];
      monthly = data.monthly || {};
    } catch (err) {
      if (options.dir || options.file) throw err; // 显式指定时失败必须报错
      if (options.verbose) console.log('  未发现面板数据文件，仅同步 Agent 平台解析项目: ' + err.message);
    }
    const agentProjects = findAgentProjects(options.verbose);
    // —— Agent 命名：先识别项目、生成正式名称，再决定是否上传 ——
    const agentNames = loadAgentNames();
    // 先应用已有 Agent 命名（project-names.json），再判断哪些仍未命名
    for (const p of agentProjects) {
      const nm = lookupName(p, agentNames);
      if (nm) p.name = nm.slice(0, 40);
    }
    // 项目甄别：区分「真正的项目」与「过短的日常问答」；Agent 分类清单优先，其次启发式
    const classifyRules = loadClassify();
    for (const p of agentProjects) {
      const key = classifyKey(p) || p.name;
      const ov = classifyRules[key];
      if (ov === 'include') p.excluded = false;
      else if (ov === 'exclude') p.excluded = true;
      else p.excluded = !isLikelyProject(p);
      if (p.excluded) p.excludeReason = excludeReason(p);
    }
    const excludedProjects = agentProjects.filter(p => p.excluded);
    if (excludedProjects.length && !options.dryRun) {
      console.log(`  ⏭ 未上传 ${excludedProjects.length} 个会话（判定为日常问答，不是项目）：`);
      excludedProjects.slice(0, 10).forEach(p => console.log('     · ' + (p.name || '未命名') + '（' + (p.excludeReason || '') + '）'));
      if (excludedProjects.length > 10) console.log('     … 共 ' + excludedProjects.length + ' 个');
      console.log('     如需复核：运行 --classify 生成甄别提示词，让 Agent 分类后保存 ~/.goodname/project-classify.json');
      // 清理历史残留：这些会话若之前已上传过，按 name+source 删除云端旧行
      if (cred.type === 'token' && cloudRows.length) {
        const cloudByName = new Map();
        for (const r of cloudRows) cloudByName.set((r.name || '') + '::' + (r.source || 'codex'), r);
        let pruned = 0;
        for (const p of excludedProjects) {
          const old = cloudByName.get((p.name || '') + '::' + (p.source || 'workbuddy'));
          if (!old || !old.name) continue;
          try {
            await deleteProjectToken(cred.value, old.name, old.source || 'workbuddy');
            console.log('     🧹 已删除历史日常问答项目：' + old.name);
            pruned++;
          } catch (e) {
            if (options.verbose) console.log('     ⚠ 历史行删除失败：' + (e.message || e));
          }
        }
        if (pruned) console.log(`  🧹 共清理 ${pruned} 个已上传的历史问答项目`);
      }
    }
    const unnamedKeys = new Set();
    for (const p of agentProjects) {
      if (!lookupName(p, agentNames)) unnamedKeys.add(agentNameKey(p) || p.name);
    }
    const allowPlaceholder = !!options.allowPlaceholder;
    if (unnamedKeys.size) {
      writePendingNames(agentProjects);
      if (options.aiNames && !options.dryRun) {
        console.log(`  🤖 正在调用本地 Agent（Codex）为 ${unnamedKeys.size} 个会话生成项目名…`);
        const names = await generateNamesWithCodex(agentProjects, options.verbose);
        if (Object.keys(names).length) {
          const merged = { ...agentNames, ...names };
          saveAgentNames(merged);
          let got = 0;
          for (const p of agentProjects) {
            const nm = lookupName(p, merged);
            if (nm) { p.name = nm.slice(0, 40); got++; }
          }
          unnamedKeys.clear();
          for (const p of agentProjects) {
            if (!lookupName(p, merged)) unnamedKeys.add(agentNameKey(p) || p.name);
          }
          console.log(`  ✓ 已为 ${got} 个会话生成项目名并保存到 ~/.goodname/project-names.json`);
        }
      }
      if (unnamedKeys.size && !allowPlaceholder) {
        console.log(`  ⏸ ${unnamedKeys.size} 个会话尚未生成项目名，已暂缓上传（不会用提问/文件夹名硬传）`);
        console.log('    ⚡ 一键命名（把这条指令发给任意 Agent）：node ... --generate-names');
        console.log('      已生成清单 ~/.goodname/pending-names.json，Agent 把项目名写入 ~/.goodname/project-names.json 后重新同步');
        console.log('    或加 --allow-placeholder 先用中性名上传（数据可见，之后可随时更名清理）');
      }
    }
    // 未命名的会话不进入上传清单（先生成名称，再上传）；--allow-placeholder 时用中性名照常上传
    const namedAgentProjects = allowPlaceholder
      ? agentProjects
      : agentProjects.filter(p => !unnamedKeys.has(agentNameKey(p) || p.name));
    // 甄别为「日常问答」的会话不进入上传清单
    const uploadAgentProjects = namedAgentProjects.filter(p => !p.excluded);
    const allNamedProjects = mergeAgentProjects(panelProjects, uploadAgentProjects, cloudDeletedKeys);
    const mergedHistory = applyMergeHistory(allNamedProjects, cloudMerges);
    // 字段级合并：管理字段云端优先、内容字段本地优先、冲突自动备份
    const mergedProjects = cred.type === 'token'
      ? mergeCloudFields(mergedHistory, cloudRows, options.verbose).projects
      : mergedHistory;

    // 创作选题自动生成：已有项目但没有对应选题时，按项目生成「选题 + 创作步骤」
    const existingTopicProjects = new Set((topics || []).map(t => t && t.project).filter(Boolean));
    topics = [...(topics || []), ...generateTopicsFromProjects(mergedProjects, existingTopicProjects)];

    // 更名清理：旧版 WorkBuddy 用文件夹名上传，现在按会话内容生成名称。
    // 按 dir（工作目录）匹配：本地新名称与云端旧名称不同时，先删除云端旧行，避免重复。
    if (cred.type === 'token' && cloudRows.length && !options.dryRun) {
      const cloudByDir = new Map(); // dir+source -> 该会话的全部云端行（可能含多个旧名称）
      for (const r of cloudRows) {
        const pp = (r.payload && typeof r.payload === 'object') ? r.payload : {};
        const dir = pp.dir || (r.metadata && r.metadata.dir) || '';
        if (!dir) continue;
        const key = String(dir) + '::' + (r.source || 'codex');
        if (!cloudByDir.has(key)) cloudByDir.set(key, []);
        cloudByDir.get(key).push(r);
      }
      for (const p of mergedProjects) {
        if ((p.source || 'codex') === 'codex') continue;
        const dir = p.dir || (p.metadata && p.metadata.dir);
        if (!dir) continue;
        const olds = cloudByDir.get(String(dir) + '::' + (p.source || 'workbuddy')) || [];
        for (const old of olds) {
          if (!old.name || old.name === p.name) continue;
          try {
            await deleteProjectToken(cred.value, old.name, old.source || 'workbuddy');
            console.log(`  ✓ 项目更名清理：${old.name} → ${p.name}（旧行已删除）`);
          } catch (e) {
            if (options.verbose) console.log('  ⚠ 旧行删除失败（需执行 rename_cleanup.sql）: ' + (e.message || e));
          }
        }
      }
    }

    const payload = buildUploadPayload({ projects: mergedProjects, topics, monthly });
    payload.monthly = aggregateMonthly(payload, cloudRows);
    const totalTokens = payload.projects.reduce((s, p) => s + (p.tokens_used || 0), 0);

    // 完整性自检：字段齐全性 / 取值合法性 / 格式
    const issues = runCompletenessCheck(payload);
    if (issues.length) {
      console.log('\n⚠ 完整性自检（不影响上传，建议修正）：');
      issues.slice(0, 25).forEach(x => console.log('  ' + x));
      if (issues.length > 25) console.log('  … 共 ' + issues.length + ' 条');
      console.log('  可让 AI 参考 data.example.json / TEMPLATE.md 生成后重新上传。');
    }

    console.log(`\n✓ 找到 ${payload.projects.length} 个项目 · ${payload.topics.length} 条选题 · ${payload.monthly.length} 条月度统计`);
    if (options.verbose) {
      for (const p of payload.projects) {
        console.log(`  · ${p.name} (${(p.tokens_used || 0).toLocaleString()} tokens)`);
      }
    }
    console.log(`\n📊 汇总: 累计 ${totalTokens.toLocaleString()} tokens`);

    if (options.dryRun) {
      console.log('\n⏸️  Dry run 模式，不上传数据');
      if (options.verifyDiff && cred.type === 'token') {
        console.log('\n── 本地(合并后) vs 云端 差异核对 ──');
        verifyDiff(mergedProjects, cloudRows, true);
      }
      return { dry: true };
    }

    console.log('\n🚀 开始上传...\n');
    const result = cred.type === 'token'
      ? await uploadWithToken(cred.value, payload, options.verbose)
      : await uploadWithKey(cred.value, payload, options.verbose);
    saveMergeState(mergedProjects);
    // 第 1 步：记录同步完成事件（面板 Realtime 实时提示）
    if (cred.type === 'token' && payload.projects.length) {
      try {
        await recordSyncEvent(cred.value, {
          device: os.hostname(),
          source: 'goodname-sync',
          summary: `同步 ${payload.projects.length} 个项目 · ${payload.topics.length} 选题`,
          projects: payload.projects.length,
          topics: payload.topics.length,
          tokens: totalTokens,
        });
      } catch (e) {
        if (options.verbose) console.log('  同步事件记录失败（可先执行 sync_events.sql）: ' + (e.message || e));
      }
    }
    if (options.verifyDiff && cred.type === 'token') {
      try {
        const freshRows = await listProjectsToken(cred.value);
        console.log('\n── 上传后 本地(合并后) vs 云端 差异核对 ──');
        verifyDiff(mergedProjects, freshRows, true);
      } catch(e){ console.log('  ⚠ 上传后核对失败: ' + e.message); }
    }
    if (options.auto) {
      console.log(`SYNCED: ${payload.projects.length}个项目, ${payload.topics.length}条选题, ${totalTokens.toLocaleString()} tokens`);
      return result;
    }
    console.log('\n' + '═'.repeat(50));
    console.log('  ✅ 同步完成！');
    console.log('═'.repeat(50));
    console.log(`  项目: 新增 ${result.projects.inserted} · 更新 ${result.projects.updated}`);
    console.log(`  选题: 新增 ${result.topics.inserted} · 更新 ${result.topics.updated}`);
    console.log('\n  打开 https://goodname.fun/progress 查看数据');
    try {
      const db = await listProjects(key);
      if (Array.isArray(db) && db.length) {
        const dbNames = db.map(p => p.name);
        const dup = dbNames.filter((n, i) => dbNames.indexOf(n) !== i);
        const missing = payload.projects.map(p => p.name).filter(n => !dbNames.includes(n));
        const names = new Set(dbNames);
        const localSet = new Set(payload.projects.map(p => p.name));
        const extra = [...names].filter(n => !localSet.has(n));
        console.log(`  校验：云端 ${db.length} 个项目` +
          (dup.length ? ` · ⚠ 重复 ${dup.length} 个（${[...new Set(dup)].join('、')}）` : '') +
          (missing.length ? ` · ⚠ 本地 ${missing.length} 个未同步（${missing.join('、')}）` : '') +
          (extra.length ? ` · 云端 ${extra.length} 个本地不存在（${extra.join('、')}）` : ''));
      }
    } catch (e) {}
    return result;
  };

  // 第 3 步：worker——轮询云端任务队列（面板「立即同步 / 深度更新」入队后由本机执行）
  const workOnce = async () => {
    if (options.dryRun) return;
    const cred = resolveCredential({});
    if (cred.type !== 'token') return;
    let task = null;
    try {
      task = await claimSyncTask(cred.value, os.hostname());
    } catch (e) {
      if (options.verbose) console.log('  ⚠ 任务领取失败（需先执行 sync_tasks.sql）: ' + (e.message || e));
      return;
    }
    if (!task) return;
    console.log(`  📋 领取任务：${task.type}（${String(task.id).slice(0, 8)}…）`);
    try {
      await doSync();
      await completeSyncTask(cred.value, task.id, 'done', { ok: true });
      console.log(`  ✅ 任务完成：${task.type}`);
    } catch (e) {
      try { await completeSyncTask(cred.value, task.id, 'failed', { error: String(e.message || e).slice(0, 200) }); } catch {}
      console.log(`  ✗ 任务失败：${(e.message || e).slice(0, 160)}`);
    }
  };

  if (options.work) {
    console.log('🔁 Worker 模式已启动：每 60 秒轮询云端任务队列');
    while (true) {
      try { await workOnce(); } catch (e) { console.log('  ⚠ worker 错误: ' + (e.message || e)); }
      await new Promise(r => setTimeout(r, 60000));
    }
  }

  if (options.daemon) {
    console.log(`🔁 常驻模式已启动：每 3 小时同步一次 · 失败 10 分钟重试 · 开机补跑`);
    daemonLoop(doSync, 3, 10, workOnce);
    return;
  }

  if (options.watch) {
    const fs = await import('fs');
    const path = await import('path');
    const dataFile = findDataFile(options.dir, options.file, false);
    const watchDir = fs.existsSync(dataFile) && fs.statSync(dataFile).isFile() ? path.dirname(dataFile) : options.dir;
    console.log('🔍 监控模式已启动，检测到数据变化时自动同步...');
    let timer = null;
    const watcher = fs.watch(watchDir, { recursive: true }, (eventType, filename) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        console.log(`\n[${new Date().toLocaleString()}] 检测到变化，开始同步...`);
        try { await doSync(); } catch (err) { console.error('✗ 同步失败: ' + err.message); }
      }, 5000);
    });
    process.on('SIGINT', () => { watcher.close(); console.log('\n监控已停止'); process.exit(0); });
    return;
  }

  await doSync();
}

function detectAgents() {
  console.log('═══════════════════════════════════════');
  console.log('  Agent 平台检测');
  console.log('═══════════════════════════════════════');
  const present = [];
  for (const root of AGENT_ROOTS) {
    for (const rp of root.paths) {
      const p = rp.startsWith('~') ? path.join(os.homedir(), rp.slice(1)) : rp;
      if (fs.existsSync(p)) { present.push(root.label + ' → ' + p); break; }
    }
  }
  if (!present.length) {
    console.log('  未检测到常见 Agent 数据目录。');
  } else {
    present.forEach(x => console.log('  ✓ ' + x));
  }
  console.log('');
  console.log('  · 已识别平台：工具会自动扫描并上传其项目数据。');
  console.log('  · 未识别平台：让 Agent 生成上传数据 →');
  console.log('    node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --init --dir <工作目录>');
  console.log('    填写生成的 data.json 后：node ... --file <data.json> --auto');
}

function runCompletenessCheck(payload) {
  const issues = [];
  // 兼容两种日期格式：YYYY-MM-DD（data.json 标准）与 MM-DD（面板源文件紧凑展示）
  const dateRe = /^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})([T ].*)?$/;
  const statusOk = ['todo', 'doing', 'blocked', 'hold', 'done'];
  (payload.projects || []).forEach(p => {
    const pp = (p && p.payload && typeof p.payload === 'object') ? p.payload : {};
    const name = p.name || pp.name || '未命名项目';
    if ((pp.source || 'codex') === 'workbuddy') {
      if (!Array.isArray(pp.criteria) || !pp.criteria.length) issues.push('· ' + name + '：完成标准建议由 AI 依据会话补全（参考 TEMPLATE.md）');
      if (!Array.isArray(pp.decisions) || !pp.decisions.length) issues.push('· ' + name + '：决策日志建议由 AI 依据会话补全');
      return;
    }
    if (!name || String(name).trim().length < 2) issues.push('· ' + name + '：项目名称为空或过短');
    if (!pp.intro || String(pp.intro).trim().length < 20) issues.push('· ' + name + '：简介过短（建议 ≥20 字，说明做什么/当前进度）');
    if (!statusOk.includes(pp.status)) issues.push('· ' + name + '：status 取值无效「' + (pp.status || '空') + '」（应为 todo/doing/blocked/hold/done）');
    if (!pp.cat) issues.push('· ' + name + '：缺少分类 cat');
    if (!Array.isArray(pp.milestones) || !pp.milestones.length) {
      issues.push('· ' + name + '：缺少里程碑');
    } else {
      if (pp.milestones.some(m => !m || !m.text)) issues.push('· ' + name + '：存在无文本的里程碑');
      const badDate = pp.milestones.find(m => m && m.date && !dateRe.test(String(m.date)));
      if (badDate) issues.push('· ' + name + '：里程碑日期格式应为 YYYY-MM-DD（' + badDate.date + '）');
    }
    if (!Array.isArray(pp.next) || !pp.next.length) issues.push('· ' + name + '：缺少下一步建议');
    if (!Array.isArray(pp.criteria) || !pp.criteria.length) {
      issues.push('· ' + name + '：缺少完成标准');
    } else if (pp.criteria.some(c => !c || !c.text)) {
      issues.push('· ' + name + '：存在无文本的完成标准');
    }
    if (pp.urgency != null && ![0, 1, 2].includes(Number(pp.urgency))) issues.push('· ' + name + '：urgency 应为 0/1/2');
    if (pp.progress != null && (Number(pp.progress) < 0 || Number(pp.progress) > 100)) issues.push('· ' + name + '：progress 应为 0-100');
    if (pp.date && !dateRe.test(String(pp.date))) issues.push('· ' + name + '：date 格式应为 YYYY-MM-DD（' + pp.date + '）');
    if (pp.updated && !dateRe.test(String(pp.updated))) issues.push('· ' + name + '：updated 格式应为 YYYY-MM-DD（' + pp.updated + '）');
  });
  (payload.topics || []).forEach(t => {
    if (!t || !t.title || !String(t.title).trim()) issues.push('· 选题：缺少标题');
  });
  (payload.monthly || []).forEach(m => {
    if (!m || !m.year_month || !/^\d{4}-\d{2}$/.test(String(m.year_month))) {
      issues.push('· 月度：year_month 格式应为 YYYY-MM（' + ((m && m.year_month) || '空') + '）');
    }
  });
  return issues;
}

function initTemplate(dir) {
  const target = dir ? (dir.startsWith('~') ? path.join(os.homedir(), dir.slice(1)) : dir) : process.cwd();
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(target, 'data.json');
  if (fs.existsSync(file)) {
    console.log('⚠ 已存在 ' + file + '，跳过（避免覆盖已有数据）');
    return;
  }
  let content = null;
  try {
    content = fs.readFileSync(path.join(PKG_ROOT, 'data.example.json'), 'utf-8');
  } catch (e) { content = null; }
  if (!content) {
    const tpl = {
      projects: [{ name: '示例项目', intro: '在这里填写项目简介', status: 'doing', cat: 'AI 应用', tokens: 0, conv: 0, milestones: [], next: [], criteria: [], files: [], topics: [], decisions: [] }],
      topics: [],
      monthly: []
    };
    content = JSON.stringify(tpl, null, 2);
  }
  fs.writeFileSync(file, content, 'utf-8');
  console.log('✓ 已生成数据模板: ' + file);
  console.log('  模板包含完整字段示例（projects / topics / monthly），字段说明见 TEMPLATE.md');
  console.log('  请把示例内容替换为真实数据，然后运行：');
  console.log('  node ~/.goodname/agent-sync/goodname-sync/bin/goodname-sync.js --file ' + file + ' --auto');
}
