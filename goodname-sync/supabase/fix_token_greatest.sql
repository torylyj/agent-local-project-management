-- ============================================================
-- 防止其他设备同步时把项目 Token 覆盖成更低的值。
-- 根因：upsert_projects_token 里 tokens_used = EXCLUDED.tokens_used 是「后写覆盖」，
--       旧版本/低 token 的设备一同步就把云端合计拉低。
-- 改为 GREATEST：任何设备都只能抬高、不能降低项目 Token。
-- 在 Supabase SQL Editor 整段执行一次（幂等）。
-- ============================================================

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
