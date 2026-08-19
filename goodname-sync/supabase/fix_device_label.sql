-- ============================================================
-- 安装码自定义名称：让用户为每个安装码标注「设备 + 平台」。
-- 1) device_codes 增加 label 列
-- 2) create_device_code 接收可选 p_label
-- 3) exchange_device_code 把安装码的 label 带到设备令牌
-- 在 Supabase SQL Editor 整段执行一次即可（幂等）。
-- ============================================================

ALTER TABLE public.device_codes ADD COLUMN IF NOT EXISTS label TEXT;

CREATE OR REPLACE FUNCTION public.create_device_code(p_label TEXT DEFAULT NULL)
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
  INSERT INTO public.device_codes (code_hash, user_id, expires_at, label)
  VALUES (v_hash, auth.uid(), now() + interval '30 minutes', COALESCE(NULLIF(btrim(COALESCE(p_label, '')), ''), 'Agent 设备'));
  RETURN v_code;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.create_device_code(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.exchange_device_code(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_code_hash TEXT;
  v_user_id UUID;
  v_label TEXT;
  v_token TEXT;
  v_chars TEXT := 'abcdefghijklmnopqrstuvwxyz0123456789';
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION '安装码为空';
  END IF;
  v_code_hash := encode(digest(upper(btrim(p_code)), 'sha256'), 'hex');
  SELECT user_id, label INTO v_user_id, v_label
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
  VALUES (encode(digest(v_token, 'sha256'), 'hex'), v_user_id, COALESCE(NULLIF(btrim(v_label), ''), 'Agent 设备'), now() + interval '30 days');
  UPDATE public.device_codes SET used_at = now() WHERE code_hash = v_code_hash;
  RETURN v_token;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.exchange_device_code(TEXT) TO anon, authenticated;
