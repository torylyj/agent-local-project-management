-- ============================================================
-- Supabase 安全警告修复（61 条 WARN 中可代码修复的部分）
-- 说明：
-- 1) 大部分 SECURITY DEFINER 警告来自 PostgreSQL 默认给 PUBLIC 执行权，
--    而我们这些函数都通过设备令牌/同步密钥/登录态鉴权，属于「设计如此」；
--    真正要收紧的是「仅登录用户可用」的函数，撤掉 anon 与 PUBLIC。
-- 2) token/key 类 RPC 需要 anon 可执行（CLI worker 用 anon + 令牌调用），保留。
-- 3) leaked password protection 需在 Dashboard 开启（见文末）。
-- 在 Supabase SQL Editor 整段执行一次（幂等）。
-- ============================================================

-- 1) set_updated_at 补 search_path（消除 function_search_path_mutable）
ALTER FUNCTION public.set_updated_at() SET search_path = public, extensions;

-- 2) pg_net 移出 public schema（消除 extension_in_public）
DO $$
DECLARE
  ns TEXT;
BEGIN
  SELECT n.nspname INTO ns
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_net';
  IF ns IS NOT NULL AND ns <> 'extensions' THEN
    EXECUTE 'ALTER EXTENSION pg_net SET SCHEMA extensions';
  END IF;
END $$;

-- 3) 仅登录用户可用的函数：撤掉 anon / PUBLIC（authenticated 保留）
REVOKE EXECUTE ON FUNCTION public.create_device_code() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_device_code(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_sync_key(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_device_token(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_sync_task(TEXT, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_device_tokens() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_token_user(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_key_user(TEXT) FROM PUBLIC, anon;

-- 说明：以下仍保留 anon（CLI/worker 用 anon + 设备令牌或同步密钥调用，内部鉴权）：
-- exchange_device_code / upsert_*_token / list_*_token / record_sync_event_token /
-- claim/complete/enqueue_sync_task_token / cleanup_device_tokens_token /
-- expire_hidden_projects_token / delete_project_token / get_sync_status /
-- list_sync_projects / verify_sync_key / upsert_projects / upsert_topics /
-- upsert_conversations / upsert_token_monthly
--
-- 4) 剩余一项需在 Dashboard 手动开启：
--    Authentication → Security → Leaked Password Protection → Enable
