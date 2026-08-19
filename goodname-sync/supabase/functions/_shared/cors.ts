export const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://goodname.fun',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function handleOptions(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

export function clientFrom(req: Request) {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const auth = req.headers.get('Authorization') || '';
  // 直接导入 supabase-js（由 supabase CLI 部署时自动缓存）
  return import('https://esm.sh/@supabase/supabase-js@2').then(({ createClient }) => {
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    return client;
  });
}
