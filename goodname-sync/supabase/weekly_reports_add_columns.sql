-- 周报归档支持自定义日期范围（start_iso / end_iso），用于云端持久化与重新打开
ALTER TABLE public.weekly_reports ADD COLUMN IF NOT EXISTS start_iso TEXT;
ALTER TABLE public.weekly_reports ADD COLUMN IF NOT EXISTS end_iso TEXT;
