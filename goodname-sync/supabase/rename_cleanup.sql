-- ============================================================
-- 更名清理 RPC：删除「旧文件夹名」的云端项目行
-- 背景：旧版 WorkBuddy 适配用会话工作目录的文件夹名作为项目名，
--       新版按会话内容生成项目名；同步工具会按 dir 匹配到旧行并调用本函数删除，
--       避免同一个会话在云端出现「旧文件夹名 + 新内容名」两个重复项目。
-- 在 Supabase SQL Editor 整段执行一次即可（幂等）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_project_token(p_token TEXT, p_name TEXT, p_source TEXT DEFAULT 'codex')
RETURNS BOOLEAN
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
  DELETE FROM public.projects
  WHERE user_id = v_user
    AND name = p_name
    AND source = COALESCE(p_source, 'codex');
  RETURN FOUND;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.delete_project_token(TEXT, TEXT, TEXT) TO anon, authenticated;
