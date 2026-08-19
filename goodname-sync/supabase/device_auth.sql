-- ============================================================
-- 设备授权（无 API Key）：一次性安装码 -> 短期设备令牌
-- 在 Supabase SQL Editor 整段执行（可重复执行，幂等）。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.device_codes (
  code_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.device_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  label TEXT NOT NULL DEFAULT '默认设备',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE public.device_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "查看自己的安装码" ON public.device_codes;
CREATE POLICY "查看自己的安装码" ON public.device_codes
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "查看自己的设备令牌" ON public.device_tokens;
CREATE POLICY "查看自己的设备令牌" ON public.device_tokens
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "吊销自己的设备令牌" ON public.device_tokens;
CREATE POLICY "吊销自己的设备令牌" ON public.device_tokens
  FOR UPDATE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.resolve_token_user(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.device_tokens
  WHERE token_hash = encode(digest(p_token, 'sha256'), 'hex')
    AND revoked = FALSE
    AND expires_at > now();
  IF v_user_id IS NOT NULL THEN
    UPDATE public.device_tokens
    SET last_used_at = now()
    WHERE token_hash = encode(digest(p_token, 'sha256'), 'hex');
  END IF;
  RETURN v_user_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.resolve_token_user(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_device_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_code TEXT;
  v_chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_hash TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '请先登录';
  END IF;
  LOOP
    v_code := '';
    FOR i IN 1..8 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::INTEGER, 1);
    END LOOP;
    v_hash := encode(digest(v_code, 'sha256'), 'hex');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.device_codes WHERE code_hash = v_hash);
  END LOOP;
  INSERT INTO public.device_codes (code_hash, user_id, expires_at)
  VALUES (v_hash, auth.uid(), now() + interval '30 minutes');
  RETURN v_code;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.create_device_code() TO authenticated;

CREATE OR REPLACE FUNCTION public.exchange_device_code(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_code_hash TEXT;
  v_user_id UUID;
  v_token TEXT;
  v_chars TEXT := 'abcdefghijklmnopqrstuvwxyz0123456789';
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION '安装码为空';
  END IF;
  v_code_hash := encode(digest(upper(btrim(p_code)), 'sha256'), 'hex');
  SELECT user_id INTO v_user_id
  FROM public.device_codes
  WHERE code_hash = v_code_hash
    AND used_at IS NULL
    AND expires_at > now()
  FOR UPDATE;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '安装码无效或已过期（30 分钟有效，仅可使用一次）';
  END IF;
  v_token := '';
  FOR i IN 1..64 LOOP
    v_token := v_token || substr(v_chars, 1 + floor(random() * length(v_chars))::INTEGER, 1);
  END LOOP;
  INSERT INTO public.device_tokens (token_hash, user_id, label, expires_at)
  VALUES (encode(digest(v_token, 'sha256'), 'hex'), v_user_id, 'Agent 设备', now() + interval '30 days');
  UPDATE public.device_codes
  SET used_at = now()
  WHERE code_hash = v_code_hash;
  RETURN v_token;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.exchange_device_code(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_device_tokens()
RETURNS TABLE(token_id TEXT, label TEXT, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ, revoked BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  RETURN QUERY
  SELECT
    left(t.token_hash, 10)::TEXT,
    t.label,
    t.created_at,
    t.expires_at,
    t.last_used_at,
    t.revoked
  FROM public.device_tokens t
  WHERE t.user_id = auth.uid()
  ORDER BY t.created_at DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.list_device_tokens() TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_device_token(p_token_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  UPDATE public.device_tokens
  SET revoked = TRUE
  WHERE left(token_hash, 10) = p_token_id AND user_id = auth.uid();
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.revoke_device_token(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_projects_token(p_token TEXT, v_projects JSONB)
RETURNS TABLE(inserted_count BIGINT, updated_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user_id UUID;
  v_inserted BIGINT := 0;
  v_updated BIGINT := 0;
  p JSONB;
  v_was_inserted BOOLEAN;
BEGIN
  v_user_id := public.resolve_token_user(p_token);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '设备令牌无效或已过期';
  END IF;
  IF v_projects IS NULL OR jsonb_typeof(v_projects) <> 'array' THEN
    RETURN QUERY SELECT 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;
  FOR p IN SELECT * FROM jsonb_array_elements(v_projects)
  LOOP
    INSERT INTO projects (user_id, name, description, status, category, tokens_used, started_at, source, metadata, payload, last_synced_at)
    VALUES (
      v_user_id,
      p->>'name',
      p->>'description',
      COALESCE(p->>'status', 'doing'),
      p->>'category',
      COALESCE((p->>'tokens_used')::BIGINT, 0),
      COALESCE((p->>'started_at')::TIMESTAMPTZ, now()),
      COALESCE(p->>'source', 'codex'),
      COALESCE(p->'metadata', '{}'::jsonb),
      COALESCE(p->'payload', '{}'::jsonb),
      now()
    )
    ON CONFLICT (user_id, name, source) DO UPDATE SET
      description = EXCLUDED.description,
      status = EXCLUDED.status,
      category = EXCLUDED.category,
      tokens_used = GREATEST(projects.tokens_used, EXCLUDED.tokens_used),
      started_at = EXCLUDED.started_at,
      updated_at = now(),
      last_synced_at = now(),
      metadata = EXCLUDED.metadata,
      payload = EXCLUDED.payload
    RETURNING (xmax = 0) INTO v_was_inserted;
    IF v_was_inserted THEN
      v_inserted := v_inserted + 1;
    ELSE
      v_updated := v_updated + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_inserted, v_updated;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.upsert_projects_token(TEXT, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.upsert_topics_token(p_token TEXT, v_topics JSONB)
RETURNS TABLE(inserted_count BIGINT, updated_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user_id UUID;
  v_inserted BIGINT := 0;
  v_updated BIGINT := 0;
  t JSONB;
  v_existing_id UUID;
BEGIN
  v_user_id := public.resolve_token_user(p_token);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '设备令牌无效或已过期';
  END IF;
  IF v_topics IS NULL OR jsonb_typeof(v_topics) <> 'array' THEN
    RETURN QUERY SELECT 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;
  FOR t IN SELECT * FROM jsonb_array_elements(v_topics)
  LOOP
    IF t->>'title' IS NULL THEN
      CONTINUE;
    END IF;
    SELECT id INTO v_existing_id FROM topics
    WHERE user_id = v_user_id AND title = t->>'title';
    IF v_existing_id IS NOT NULL THEN
      UPDATE topics SET
        description = COALESCE(t->>'description', description),
        status = COALESCE(t->>'status', status),
        category = COALESCE(t->>'category', category),
        priority = COALESCE((t->>'priority')::INTEGER, priority),
        metadata = COALESCE(t->'metadata', metadata),
        payload = COALESCE(t->'payload', payload),
        updated_at = now()
      WHERE id = v_existing_id;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO topics (user_id, title, description, status, category, priority, metadata, payload)
      VALUES (
        v_user_id,
        t->>'title',
        t->>'description',
        COALESCE(t->>'status', 'idea'),
        COALESCE(t->>'category', '内容创作'),
        COALESCE((t->>'priority')::INTEGER, 0),
        COALESCE(t->'metadata', '{}'::jsonb),
        COALESCE(t->'payload', '{}'::jsonb)
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_inserted, v_updated;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.upsert_topics_token(TEXT, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.upsert_token_monthly_token(p_token TEXT, v_records JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user_id UUID;
  r JSONB;
BEGIN
  v_user_id := public.resolve_token_user(p_token);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '设备令牌无效或已过期';
  END IF;
  IF v_records IS NULL OR jsonb_typeof(v_records) <> 'array' THEN
    RETURN;
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(v_records)
  LOOP
    INSERT INTO token_monthly (user_id, year_month, tokens, cost_estimate)
    VALUES (
      v_user_id,
      r->>'year_month',
      COALESCE((r->>'tokens')::BIGINT, 0),
      COALESCE((r->>'cost_estimate')::DECIMAL, 0)
    )
    ON CONFLICT (user_id, year_month)
    DO UPDATE SET
      tokens = EXCLUDED.tokens,
      cost_estimate = EXCLUDED.cost_estimate;
  END LOOP;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.upsert_token_monthly_token(TEXT, JSONB) TO anon, authenticated;

-- 刷新 PostgREST schema 缓存，让面板立即识别新 RPC
NOTIFY pgrst, 'reload schema';
