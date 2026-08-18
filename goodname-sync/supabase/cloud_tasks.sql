-- ============================================================
-- 云端任务：合并历史上云 + 回收站到期清理（服务端执行）
-- 依赖 device_auth.sql 的 resolve_token_user。
-- 在 Supabase SQL Editor 整段执行一次（幂等）。
-- ============================================================

-- 1) 合并历史（跨设备合并生效）
CREATE TABLE IF NOT EXISTS public.merge_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  keep_name TEXT NOT NULL,
  keep_source TEXT NOT NULL DEFAULT 'codex',
  remove_name TEXT NOT NULL,
  remove_source TEXT NOT NULL DEFAULT 'codex',
  remove_payload JSONB NOT NULL DEFAULT '{}',
  merged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, keep_name, remove_name)
);

ALTER TABLE public.merge_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "查看自己的合并历史" ON public.merge_history;
CREATE POLICY "查看自己的合并历史" ON public.merge_history
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "记录自己的合并历史" ON public.merge_history;
CREATE POLICY "记录自己的合并历史" ON public.merge_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "更新自己的合并历史" ON public.merge_history;
CREATE POLICY "更新自己的合并历史" ON public.merge_history
  FOR UPDATE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON TABLE public.merge_history TO authenticated;

CREATE OR REPLACE FUNCTION public.list_merge_history_token(p_token TEXT)
RETURNS TABLE(keep_name TEXT, keep_source TEXT, remove_name TEXT, remove_source TEXT, remove_payload JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user UUID;
BEGIN
  v_user := public.resolve_token_user(p_token);
  IF v_user IS NULL THEN
    RAISE EXCEPTION '设备令牌无效或已过期';
  END IF;
  RETURN QUERY
  SELECT m.keep_name, m.keep_source, m.remove_name, m.remove_source, m.remove_payload
  FROM public.merge_history m
  WHERE m.user_id = v_user
  ORDER BY m.merged_at DESC
  LIMIT 100;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.list_merge_history_token(TEXT) TO anon, authenticated;

-- 2) 回收站到期清理（服务端执行，不依赖浏览器打开）
CREATE OR REPLACE FUNCTION public.expire_hidden_projects_token(p_token TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user UUID;
  v_val JSONB;
  v_out JSONB := '[]'::JSONB;
  v_expired INTEGER := 0;
  item JSONB;
  v_key TEXT;
  v_at BIGINT;
  v_name TEXT;
  v_source TEXT;
  v_sep INTEGER;
BEGIN
  v_user := public.resolve_token_user(p_token);
  IF v_user IS NULL THEN
    RAISE EXCEPTION '设备令牌无效或已过期';
  END IF;
  SELECT value INTO v_val FROM public.user_state WHERE user_id = v_user AND key = 'hidden_projects';
  IF v_val IS NULL OR jsonb_typeof(v_val) <> 'array' THEN
    RETURN 0;
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(v_val)
  LOOP
    v_key := item->>'key';
    v_at := (item->>'at')::BIGINT;
    IF v_key IS NULL OR v_at IS NULL OR (now() - to_timestamp(v_at / 1000.0)) < interval '30 days' THEN
      v_out := v_out || jsonb_build_object('key', v_key, 'at', v_at);
      CONTINUE;
    END IF;
    v_sep := position('::' in v_key);
    v_name := CASE WHEN v_sep > 0 THEN left(v_key, v_sep - 1) ELSE v_key END;
    v_source := CASE WHEN v_sep > 0 THEN substring(v_key from v_sep + 2) ELSE 'codex' END;
    DELETE FROM public.projects WHERE user_id = v_user AND name = v_name AND source = v_source;
    INSERT INTO public.deleted_projects (user_id, name, source)
    VALUES (v_user, v_name, v_source)
    ON CONFLICT (user_id, name, source) DO NOTHING;
    v_expired := v_expired + 1;
  END LOOP;
  UPDATE public.user_state SET value = v_out WHERE user_id = v_user AND key = 'hidden_projects';
  RETURN v_expired;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.expire_hidden_projects_token(TEXT) TO anon, authenticated;

-- 3) 云端项目回读（校验 WorkBuddy 详情是否真在云端）
CREATE OR REPLACE FUNCTION public.list_projects_token(p_token TEXT)
RETURNS TABLE(
  name TEXT,
  source TEXT,
  status TEXT,
  updated_at TIMESTAMPTZ,
  tokens_used BIGINT,
  payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user UUID;
BEGIN
  v_user := public.resolve_token_user(p_token);
  IF v_user IS NULL THEN
    RAISE EXCEPTION '设备令牌无效或已过期';
  END IF;
  RETURN QUERY
  SELECT pr.name, pr.source, pr.status, pr.updated_at, pr.tokens_used, pr.payload
  FROM public.projects pr
  WHERE pr.user_id = v_user
  ORDER BY pr.updated_at DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.list_projects_token(TEXT) TO anon, authenticated;

-- 4) 清理过期/已吊销的设备令牌
CREATE OR REPLACE FUNCTION public.cleanup_device_tokens_token(p_token TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user UUID;
  v_count INTEGER := 0;
BEGIN
  v_user := public.resolve_token_user(p_token);
  IF v_user IS NULL THEN
    RAISE EXCEPTION '设备令牌无效或已过期';
  END IF;
  DELETE FROM public.device_tokens
  WHERE user_id = v_user AND (revoked = TRUE OR expires_at <= now());
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.cleanup_device_tokens_token(TEXT) TO anon, authenticated;
