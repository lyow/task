# Reminders when the app is closed: setup

Out of the box, the app reminds you only while it is open in a tab. This adds real phone notifications: every morning, at the time you choose in Settings → Reminders, you get one notification listing what is overdue or due today, even when the app is closed.

It is switched off until you do the steps below once. They add **one new table** to your Supabase database (nothing existing is changed), one small server function, and a schedule that runs it every 15 minutes.

> Not tested end to end: this was written without access to your Supabase project, so the steps below are the first real run. If something fails, the error shows in Supabase → Edge Functions → push-reminders → Logs.

You need about 20 minutes, your Supabase dashboard (supabase.com → your project), and a computer with Node.js for step 1 only.

---

## 1. Make a key pair (one time)

On any computer with Node.js, open a terminal and run:

```
npx web-push generate-vapid-keys
```

It prints a **Public Key** and a **Private Key**. Keep the window open; you need both below.

## 2. Create the table

Supabase → **SQL Editor** → New query → paste this and press **Run**:

```sql
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  tz text default 'UTC',
  remind_at text default '09:00',
  last_sent date,
  created_at timestamptz default now()
);
alter table public.push_subscriptions enable row level security;
create policy "own subscriptions - read"   on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "own subscriptions - add"    on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy "own subscriptions - change" on public.push_subscriptions for update using (auth.uid() = user_id);
create policy "own subscriptions - remove" on public.push_subscriptions for delete using (auth.uid() = user_id);
```

## 3. Add the function

Supabase → **Edge Functions** → **Deploy a new function** → **Via editor**.

1. Name it `push-reminders`.
2. Replace the example code with everything from `supabase/functions/push-reminders/index.ts` in this repository.
3. Press **Deploy**.
4. In the function's settings, turn **off** "Enforce JWT verification". The function checks the sign-in itself, and the schedule uses its own secret.

## 4. Add the secrets

Supabase → **Edge Functions** → **Secrets** → add these four:

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | the Public Key from step 1 |
| `VAPID_PRIVATE_KEY` | the Private Key from step 1 |
| `VAPID_SUBJECT` | `mailto:` followed by your email, e.g. `mailto:me@example.com` |
| `CRON_SECRET` | any long random text you make up, e.g. 40 random letters and digits |

## 5. Tell the app where to find it

1. Open the app on the phone where you want the notifications. On iPhone it must be added to the Home Screen and opened from there.
2. Add `#push-setup` to the end of the address and open it, e.g. `https://lyow.github.io/task/#push-setup`.
3. Paste the **Public Key** from step 1.
4. Paste the function address: `https://<your-project-ref>.functions.supabase.co/push-reminders`. The project ref is the part of your Supabase URL before `.supabase.co`.
5. Press **Save**.
6. Go to **Settings → Reminders**. A new switch, **"Also when the app is closed"**, appears. Turn it on and allow notifications.

## 6. Run it every 15 minutes

Supabase → **SQL Editor** → paste, replace the two `<…>` parts, and **Run**:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('push-reminders', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<your-project-ref>.functions.supabase.co/push-reminders',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <your CRON_SECRET>"}'::jsonb,
    body := '{"action":"tick"}'::jsonb
  );
$$);
```

## 7. Check it works

1. Give one task a date of today.
2. In Settings → Reminders, set the morning time to a few minutes from now. Then turn "Also when the app is closed" off and on again, so the new time is saved.
3. Close the app. Within about 15 minutes after that time you should get "1 thing for today".
4. If nothing arrives, open Supabase → Edge Functions → push-reminders → **Logs**.

## Turning it off

- **For this phone:** switch "Also when the app is closed" off in Settings.
- **Everywhere:** in the SQL Editor run `select cron.unschedule('push-reminders');`

You can leave the table; nothing else uses it.
