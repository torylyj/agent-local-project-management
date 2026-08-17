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
