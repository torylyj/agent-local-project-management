// 用户状态读写（user_state），替代 hook /api/state
import { handleOptions, json, clientFrom } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const client = await clientFrom(req);
  try {
    if (req.method === 'GET') {
      const { data, error } = await client.from('user_state').select('key,value');
      if (error) return json({ ok: false, error: error.message }, 400);
      const state = {};
      (data || []).forEach(r => { state[r.key] = r.value; });
      return json({ ok: true, data: state });
    }
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const upserts = Object.entries(body.data || {}).map(([key, value]) => ({ key, value }));
      if (!upserts.length) return json({ ok: false, error: 'data 为空' }, 400);
      const { error } = await client.from('user_state').upsert(upserts, { onConflict: 'user_id,key' });
      if (error) return json({ ok: false, error: error.message }, 400);
      return json({ ok: true, data: body.data });
    }
    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
});
