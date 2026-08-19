-- ============================================================
-- 第 1 步：同步完成事件（CLI 上传完成后写入，面板 Realtime 实时提示）
-- 在 Supabase SQL Editor 整段执行一次（幂等）。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sync_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device TEXT,
  source TEXT DEFAULT 'codex',
  summary TEXT,
  projects INTEGER DEFAULT 0,
  topics INTEGER DEFAULT 0,
  tokens BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.sync_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "查看自己的同步事件" ON public.sync_events;
CREATE POLICY "查看自己的同步事件" ON public.sync_events
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "插入自己的同步事件" ON public.sync_events;
CREATE POLICY "插入自己的同步事件" ON public.sync_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.record_sync_event_token(
  p_token TEXT,
  p_device TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'codex',
  p_summary TEXT DEFAULT NULL,
  p_projects INTEGER DEFAULT 0,
  p_topics INTEGER DEFAULT 0,
  p_tokens BIGINT DEFAULT 0
)
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
  INSERT INTO public.sync_events (user_id, device, source, summary, projects, topics, tokens)
  VALUES (v_user, p_device, COALESCE(p_source, 'codex'), p_summary, COALESCE(p_projects, 0), COALESCE(p_topics, 0), COALESCE(p_tokens, 0))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.record_sync_event_token(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT) TO anon, authenticated;

-- 加入 Realtime（面板实时提示同步完成）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sync_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_events;
  END IF;
END $$;
