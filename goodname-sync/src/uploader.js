import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

async function rpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data && data.message ? data.message : `HTTP ${res.status}`;
    throw new Error(`${name}: ${msg}`);
  }
  return data;
}

export async function getSyncStatus(key) {
  const data = await rpc('get_sync_status', { p_key: key });
  return data || {};
}

// 免密钥模式心跳：复用 resolve_token_user 刷新设备令牌 last_used_at，
// 让面板按「最近活跃」判断设备在线，而不是依赖 3 小时一次的同步。
export async function heartbeatToken(token) {
  if (!token) return null;
  try {
    return await rpc('resolve_token_user', { p_token: token });
  } catch (e) {
    return null; // 心跳失败静默（网络抖动/令牌失效都不影响主流程）
  }
}

export async function listProjects(key) {
  const data = await rpc('list_sync_projects', { p_key: key });
  return Array.isArray(data) ? data : [];
}

export async function uploadWithKey(key, payload, verbose) {
  console.log('  正在验证同步密钥...');
  const userId = await rpc('verify_sync_key', { input_key: key });
  if (!userId) {
    throw new Error('密钥验证失败，请检查密钥是否正确或已被吊销');
  }
  console.log(`  密钥验证成功，用户 ID: ${String(userId).slice(0, 8)}...`);

  const result = { projects: { inserted: 0, updated: 0 }, topics: { inserted: 0, updated: 0 } };

  if (payload.projects.length) {
    console.log(`  正在上传 ${payload.projects.length} 个项目...`);
    const pr = await rpc('upsert_projects', {
      input_key: key,
      v_projects: payload.projects,
    });
    result.projects.inserted = Number((pr || [])[0]?.inserted_count || 0);
    result.projects.updated = Number((pr || [])[0]?.updated_count || 0);
    console.log(`  项目上传完成：新增 ${result.projects.inserted} · 更新 ${result.projects.updated}`);
  }

  if (payload.topics.length) {
    console.log(`  正在上传 ${payload.topics.length} 条创作选题...`);
    const tr = await rpc('upsert_topics', {
      input_key: key,
      v_topics: payload.topics,
    });
    result.topics.inserted = Number((tr || [])[0]?.inserted_count || 0);
    result.topics.updated = Number((tr || [])[0]?.updated_count || 0);
    console.log(`  选题上传完成：新增 ${result.topics.inserted} · 更新 ${result.topics.updated}`);
  }

  if (payload.monthly.length) {
    console.log(`  正在上传 ${payload.monthly.length} 条月度统计...`);
    await rpc('upsert_token_monthly', {
      input_key: key,
      v_records: payload.monthly,
    });
    console.log('  月度统计上传完成');
  }

  return result;
}

// 免密钥模式：用一次性安装码换设备令牌
export async function exchangeDeviceCode(code) {
  const data = await rpc('exchange_device_code', { p_code: code });
  if (!data || typeof data !== 'string' || !data.length) {
    throw new Error('安装码无效或已过期（30 分钟有效，仅可使用一次）');
  }
  return data;
}

// 免密钥模式：用设备令牌上传（逻辑与 sync_key 版一致）
export async function uploadWithToken(token, payload, verbose) {
  console.log('  正在验证设备令牌...');
  const result = { projects: { inserted: 0, updated: 0 }, topics: { inserted: 0, updated: 0 } };

  if (payload.projects.length) {
    console.log(`  正在上传 ${payload.projects.length} 个项目...`);
    const pr = await rpc('upsert_projects_token', {
      p_token: token,
      v_projects: payload.projects,
    });
    result.projects.inserted = Number((pr || [])[0]?.inserted_count || 0);
    result.projects.updated = Number((pr || [])[0]?.updated_count || 0);
    console.log(`  项目上传完成：新增 ${result.projects.inserted} · 更新 ${result.projects.updated}`);
  }

  if (payload.topics.length) {
    console.log(`  正在上传 ${payload.topics.length} 条创作选题...`);
    const tr = await rpc('upsert_topics_token', {
      p_token: token,
      v_topics: payload.topics,
    });
    result.topics.inserted = Number((tr || [])[0]?.inserted_count || 0);
    result.topics.updated = Number((tr || [])[0]?.updated_count || 0);
    console.log(`  选题上传完成：新增 ${result.topics.inserted} · 更新 ${result.topics.updated}`);
  }

  if (payload.monthly.length) {
    console.log(`  正在上传 ${payload.monthly.length} 条月度统计...`);
    await rpc('upsert_token_monthly_token', {
      p_token: token,
      v_records: payload.monthly,
    });
    console.log('  月度统计上传完成');
  }

  return result;
}

// 免密钥模式：读取云端已删清单（跨设备删除状态）
export async function listDeletedProjectsToken(token) {
  const data = await rpc('list_deleted_projects_token', { p_token: token });
  return Array.isArray(data) ? data : [];
}

// 免密钥模式：读取云端合并历史（跨设备合并生效）
export async function listMergeHistoryToken(token) {
  const data = await rpc('list_merge_history_token', { p_token: token });
  return Array.isArray(data) ? data : [];
}

// 免密钥模式：服务端执行回收站到期清理
export async function expireHiddenProjectsToken(token) {
  try {
    const n = await rpc('expire_hidden_projects_token', { p_token: token });
    return Number(n) || 0;
  } catch (e) {
    return 0;
  }
}

// 免密钥模式：云端项目回读（校验详情是否已上传）
export async function listProjectsToken(token) {
  const data = await rpc('list_projects_token', { p_token: token });
  return Array.isArray(data) ? data : [];
}

// 免密钥模式：按 name+source 删除自己的云端项目（用于旧文件夹名 → 新内容名的更名清理）
export async function deleteProjectToken(token, name, source) {
  const data = await rpc('delete_project_token', {
    p_token: token,
    p_name: name || '',
    p_source: source || 'codex',
  });
  return data === true;
}

// 第 1 步：记录同步完成事件（面板 Realtime 实时提示）
export async function recordSyncEvent(token, ev) {
  const data = await rpc('record_sync_event_token', {
    p_token: token,
    p_device: ev.device || null,
    p_source: ev.source || 'codex',
    p_summary: ev.summary || null,
    p_projects: Number(ev.projects) || 0,
    p_topics: Number(ev.topics) || 0,
    p_tokens: Number(ev.tokens) || 0,
  });
  return data || null;
}

// 第 3 步：深度更新任务队列（worker 侧）
export async function enqueueSyncTaskToken(token, type, payload) {
  // 面板用 JWT 入队（enqueue_sync_task），worker 侧一般不需要入队；保留以便 CLI 入队
  const data = await rpc('enqueue_sync_task_token', {
    p_token: token,
    p_type: type || 'sync',
    p_payload: payload || {},
  });
  return data || null;
}

export async function claimSyncTask(token, device) {
  const data = await rpc('claim_sync_task_token', {
    p_token: token,
    p_device: device || null,
  });
  return (Array.isArray(data) && data[0]) ? data[0] : null;
}

export async function completeSyncTask(token, taskId, status, result) {
  const data = await rpc('complete_sync_task_token', {
    p_token: token,
    p_task_id: taskId,
    p_status: status || 'done',
    p_result: result || {},
  });
  return data === true;
}

// 免密钥模式：清理过期/已吊销的设备令牌
export async function cleanupDeviceTokensToken(token) {
  try {
    const n = await rpc('cleanup_device_tokens_token', { p_token: token });
    return Number(n) || 0;
  } catch (e) {
    return 0;
  }
}
