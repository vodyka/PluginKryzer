-- Schedules poll-canva-changes to run every 3 minutes via pg_cron + pg_net.
--
-- NOTE: this embeds the SYNC_SHARED_SECRET value directly (pg_cron SQL has
-- no access to Edge Function secrets/env vars). This repo is private and
-- not pushed anywhere public — if that ever changes, rotate
-- SYNC_SHARED_SECRET (supabase secrets set ...) and update this job
-- (cron.alter_job / re-run this migration with the new value) first.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'poll-canva-changes-every-3-min',
  '*/3 * * * *',
  $$
  select net.http_post(
    url := 'https://neetghmmqrnttrzzrcqs.supabase.co/functions/v1/poll-canva-changes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-kryzer-secret', 'lyeTXzPNPVeubYes1LbptH7kKm19XE93'
    ),
    body := '{}'::jsonb
  );
  $$
);
