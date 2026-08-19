// 云端删除项目 + 记录已删清单（跨设备生效），替代 hook /api/delete-project
import { handleOptions, json, clientFrom } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || '');
    const source = String(body.source || 'codex');
    if (!name) return json({ ok: false, error: 'name 必填' }, 400);
    const client = await clientFrom(req);
    const { error: delErr } = await client.from('projects').delete().eq('name', name).eq('source', source);
    if (delErr) return json({ ok: false, error: delErr.message }, 400);
    const { error: recErr } = await client.from('deleted_projects').upsert(
      { name, source },
      { onConflict: 'user_id,name,source', ignoreDuplicates: true }
    );
    if (recErr) return json({ ok: false, error: recErr.message }, 400);
    return json({ ok: true, name, source });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
});
