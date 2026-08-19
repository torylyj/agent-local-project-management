// 合并历史记录（跨设备生效），替代 hook /api/merge-record
import { handleOptions, json, clientFrom } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    if (!b.keepName || !b.removeName) return json({ ok: false, error: 'keepName/removeName 必填' }, 400);
    const client = await clientFrom(req);
    const { error } = await client.from('merge_history').insert({
      keep_name: b.keepName,
      keep_source: b.keepSource || 'codex',
      remove_name: b.removeName,
      remove_source: b.removeSource || 'codex',
      remove_payload: b.removePayload || {},
    });
    if (error) return json({ ok: false, error: error.message }, 400);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
});
