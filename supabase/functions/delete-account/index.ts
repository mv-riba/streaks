// Supabase Edge Function: permanently deletes the calling user's account (§4.1, §11).
// The service-role key lives only here, on Supabase's servers — never in the app.
// Deleting the auth user cascades to profiles → streaks → completions.
// Deploy: supabase functions deploy delete-account
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    // Echo requested headers so future supabase-js client headers are never blocked by CORS.
    const requested = req.headers.get('Access-Control-Request-Headers');
    return new Response('ok', { headers: requested ? { ...cors, 'Access-Control-Allow-Headers': requested } : cors });
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'not_authenticated' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify the JWT and identify the caller — never trust a user id from the body.
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json({ error: 'not_authenticated' }, 401);

  const { error: delError } = await admin.auth.admin.deleteUser(data.user.id);
  if (delError) return json({ error: 'delete_failed', message: delError.message }, 500);

  return json({ deleted: true });
});
