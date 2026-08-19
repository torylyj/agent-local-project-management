-- ============================================================
-- 第 3 步：深度更新任务队列
-- 面板把「立即同步 / 深度更新」写入任务表，本机 CLI worker 轮询领取执行；
-- 设备离线时任务排队，上线自动补跑，不再依赖 hook push。
-- 在 Supabase SQL Editor 整段执行一次（幂等）。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sync_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'sync',          -- sync | deep
  payload JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | running | done | failed
  created_at TIMESTAMPTZ DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,
  done_at TIMESTAMPTZ,
  result JSONB
);

ALTER TABLE public.sync_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "查看自己的任务" ON public.sync_tasks;
CREATE POLICY "查看自己的任务" ON public.sync_tasks
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "创建自己的任务" ON public.sync_tasks;
CREATE POLICY "创建自己的任务" ON public.sync_tasks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "更新自己的任务" ON public.sync_tasks;
CREATE POLICY "更新自己的任务" ON public.sync_tasks
  FOR UPDATE USING (auth.uid() = user_id);

-- 面板（JWT）：入队
CREATE OR REPLACE FUNCTION public.enqueue_sync_task(p_type TEXT DEFAULT 'sync', p_payload JSONB DEFAULT '{}')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '请先登录';
  END IF;
  INSERT INTO public.sync_tasks (user_id, type, payload)
  VALUES (auth.uid(), COALESCE(NULLIF(p_type, ''), 'sync'), COALESCE(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.enqueue_sync_task(TEXT, JSONB) TO authenticated;

-- CLI（设备令牌）：入队
CREATE OR REPLACE FUNCTION public.enqueue_sync_task_token(p_token TEXT, p_type TEXT DEFAULT 'sync', p_payload JSONB DEFAULT '{}')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user UUID;
  v_id UUID;
BEGIN
  v_user := public.resolve_token_user(p_token);
  IF v_user IS NULL THEN
    RAISE EXCEPTION '设备令牌无效或已过期';
  END IF;
  INSERT INTO public.sync_tasks (user_id, type, payload)
  VALUES (v_user, COALESCE(NULLIF(p_type, ''), 'sync'), COALESCE(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.enqueue_sync_task_token(TEXT, TEXT, JSONB) TO anon, authenticated;

-- worker（设备令牌）：领取一个待执行任务（原子更新为 running）
CREATE OR REPLACE FUNCTION public.claim_sync_task_token(p_token TEXT, p_device TEXT DEFAULT NULL)
RETURNS TABLE(id UUID, type TEXT, payload JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user UUID;
  v_task RECORD;
BEGIN
  v_user := public.resolve_token_user(p_token);
  IF v_user IS NULL THEN
    RAISE EXCEPTION '设备令牌无效或已过期';
  END IF;
  SELECT * INTO v_task
  FROM public.sync_tasks
  WHERE user_id = v_user AND status = 'pending'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF v_task.id IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.sync_tasks
  SET status = 'running', claimed_at = now(), claimed_by = p_device
  WHERE id = v_task.id;
  RETURN QUERY SELECT v_task.id, v_task.type, v_task.payload;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.claim_sync_task_token(TEXT, TEXT) TO anon, authenticated;

-- worker（设备令牌）：完成任务
CREATE OR REPLACE FUNCTION public.complete_sync_task_token(p_token TEXT, p_task_id UUID, p_status TEXT DEFAULT 'done', p_result JSONB DEFAULT NULL)
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
  UPDATE public.sync_tasks
  SET status = COALESCE(NULLIF(p_status, ''), 'done'),
      done_at = now(),
      result = p_result
  WHERE id = p_task_id AND user_id = v_user AND status = 'running';
  RETURN FOUND;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.complete_sync_task_token(TEXT, UUID, TEXT, JSONB) TO anon, authenticated;
