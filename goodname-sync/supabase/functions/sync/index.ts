// 面板「立即同步 / 深度更新」→ 写入云端任务队列（不再依赖本机 hook push）
import { handleOptions, json, clientFrom } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const type = String(body.type || 'sync');
    const client = await clientFrom(req);
    const { data, error } = await client.rpc('enqueue_sync_task', { p_type: type, p_payload: body.payload || {} });
    if (error) return json({ ok: false, error: error.message }, 400);
    return json({ ok: true, taskId: data });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
});
