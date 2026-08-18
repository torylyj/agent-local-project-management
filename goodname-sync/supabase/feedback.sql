-- ============================================================
-- 用户反馈表（面板「意见反馈」→ 数据库兜底存储）
-- 邮件直发由页面端 FormSubmit AJAX 完成（无需密钥）；
-- 此表保证邮件通道不可用时反馈不丢失。
-- 在 Supabase SQL Editor 执行一次即可（幂等）。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT '建议',
  content TEXT NOT NULL,
  contact TEXT,
  page TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "提交反馈" ON public.feedback;
CREATE POLICY "提交反馈" ON public.feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "查看自己的反馈" ON public.feedback;
CREATE POLICY "查看自己的反馈" ON public.feedback
  FOR SELECT USING (auth.uid() = user_id);

REVOKE INSERT ON TABLE public.feedback FROM anon;
GRANT INSERT, SELECT ON TABLE public.feedback TO authenticated;
