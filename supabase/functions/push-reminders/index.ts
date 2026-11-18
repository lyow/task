// Closed-app reminders for the organiser.
// Two jobs:
//  1. The app calls it to save or remove this browser's push subscription (signed-in user only).
//  2. A schedule calls it every 15 minutes ("tick"): at each person's morning time it sends one notification
//     listing what is overdue or due today. It never sends twice on the same local day.
// Secrets needed: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.)
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });

function localNow(tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date());
  const g = (t: string) => parts.find(p => p.type === t)?.value || '00';
  return { day: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));

  // ── scheduled run
  if (body.action === 'tick') {
    if (req.headers.get('authorization') !== `Bearer ${Deno.env.get('CRON_SECRET')}`) return json({ error: 'forbidden' }, 403);
    const db = createClient(URL_, SERVICE);
    const { data: subs } = await db.from('push_subscriptions').select('*');
    let sent = 0;
    for (const s of subs || []) {
      const now = localNow(s.tz);
      if (now.hm < (s.remind_at || '09:00') || s.last_sent === now.day) continue;
      const { data: projects } = await db.from('projects').select('id,name,archived').eq('user_id', s.user_id);
      const live = new Map((projects || []).filter(p => !p.archived).map(p => [p.id, p.name]));
      const { data: items } = await db.from('items').select('project_id,text,kind,layout,done').eq('user_id', s.user_id).eq('done', false);
      const due = (items || []).filter(i => live.has(i.project_id) && !['sticky', 'link', 'quick'].includes(i.kind) && i.layout && i.layout.due && i.layout.due <= now.day);
      await db.from('push_subscriptions').update({ last_sent: now.day }).eq('id', s.id);
      if (!due.length) continue;
      const payload = JSON.stringify({
        title: due.length === 1 ? '1 thing for today' : `${due.length} things for today`,
        body: due.slice(0, 3).map(i => '• ' + i.text).join('\n') + (due.length > 3 ? '\n…' : ''),
        url: './#focus',
      });
      try { await webpush.sendNotification(s.subscription, payload); sent++ }
      catch (e) { if ((e as { statusCode?: number }).statusCode === 410 || (e as { statusCode?: number }).statusCode === 404) await db.from('push_subscriptions').delete().eq('id', s.id) }
    }
    return json({ sent });
  }

  // ── the app saves or removes this browser's subscription
  const auth = req.headers.get('authorization') || '';
  const db = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
  const { data: who } = await db.auth.getUser();
  if (!who?.user) return json({ error: 'sign in first' }, 401);
  if (body.action === 'subscribe' && body.subscription?.endpoint) {
    const { error } = await db.from('push_subscriptions').upsert({
      user_id: who.user.id, endpoint: body.subscription.endpoint, subscription: body.subscription,
      tz: body.tz || 'UTC', remind_at: body.at || '09:00',
    }, { onConflict: 'endpoint' });
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }
  if (body.action === 'unsubscribe' && body.endpoint) {
    await db.from('push_subscriptions').delete().eq('endpoint', body.endpoint);
    return json({ ok: true });
  }
  return json({ error: 'unknown action' }, 400);
});
