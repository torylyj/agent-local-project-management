-- ============================================================
-- 云端已删项目记录（删除状态跟随账号，跨设备生效）
-- 依赖 device_auth.sql 的 resolve_token_user（设备令牌）。
-- 在 Supabase SQL Editor 整段执行一次（幂等）。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.deleted_projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'codex',
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name, source)
);

ALTER TABLE public.deleted_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "查看自己的已删项目" ON public.deleted_projects;
CREATE POLICY "查看自己的已删项目" ON public.deleted_projects
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "记录自己的已删项目" ON public.deleted_projects;
CREATE POLICY "记录自己的已删项目" ON public.deleted_projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "恢复自己的已删记录" ON public.deleted_projects;
CREATE POLICY "恢复自己的已删记录" ON public.deleted_projects
  FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, DELETE ON TABLE public.deleted_projects TO authenticated;

-- 设备令牌模式：同步工具读取本账号的已删清单
CREATE OR REPLACE FUNCTION public.list_deleted_projects_token(p_token TEXT)
RETURNS TABLE(name TEXT, source TEXT)
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
  SELECT d.name, d.source
  FROM public.deleted_projects d
  WHERE d.user_id = v_user;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.list_deleted_projects_token(TEXT) TO anon, authenticated;
