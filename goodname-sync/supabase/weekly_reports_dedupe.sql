-- ============================================================
-- 周报归档去重：清理旧 id 规则残留的重复行
-- 在 Supabase SQL Editor 整段执行（可重复执行，幂等）。
--
-- 背景：早期版本标准周归档的云端 id 带 startISO 后缀
--   （如 w2026-34-20260817），与无后缀的新 id（w2026-34）
--   并存导致同一周出现多行、upsert 无法覆盖。
-- 新代码已统一：标准周 id = w{year}-{week}，仅自定义范围带后缀。
-- 本脚本删除所有「标准周但 id 带 8 位日期后缀」的残留行。
-- ============================================================

DELETE FROM public.weekly_reports
WHERE id ~ '^w[0-9]{4}-[0-9]+-[0-9]{8}$'
  AND (
    start_iso IS NULL
    OR (
      end_iso IS NOT NULL
      AND EXTRACT(ISODOW FROM start_iso::date) = 1
      AND end_iso::date = start_iso::date + 6
    )
  );

-- 保险：同一 (year, week) 的标准周若仍存在多条（含 start_iso 为 NULL 与周一两种表示），
-- 保留 saved_at 最新的一条。
DELETE FROM public.weekly_reports a
USING public.weekly_reports b
WHERE a.id <> b.id
  AND a.year = b.year
  AND a.week = b.week
  AND (
    (a.start_iso IS NULL AND b.start_iso IS NULL)
    OR a.start_iso = b.start_iso
  )
  AND a.saved_at < b.saved_at;
