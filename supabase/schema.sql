-- Authoritative schema for firmware + web app + triggers.
-- Ordered to satisfy foreign keys. Duplicates removed.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create table if not exists public.app_meta (
  key text not null,
  value jsonb null,
  constraint app_meta_pkey primary key (key)
) tablespace pg_default;

create table if not exists public.users (
  id uuid not null default gen_random_uuid(),
  full_name text null,
  email text null,
  password_hash text null,
  created_at timestamp with time zone null default now(),
  last_seen timestamp with time zone null,
  constraint users_pkey primary key (id),
  constraint users_email_key unique (email)
) tablespace pg_default;

create table if not exists public.devices (
  id uuid not null default gen_random_uuid(),
  name text null,
  location text null,
  owner_id uuid null,
  state jsonb null default '{}'::jsonb,
  overrides jsonb null default '{}'::jsonb,
  metadata jsonb null default '{}'::jsonb,
  created_at timestamp with time zone null default now(),
  last_seen timestamp with time zone null,
  claim_code text null,
  constraint devices_pkey primary key (id),
  constraint devices_owner_id_fkey foreign key (owner_id) references public.users (id) on delete set null
) tablespace pg_default;

create unique index if not exists devices_claim_code_idx
  on public.devices using btree (claim_code) tablespace pg_default;

create or replace function public.claim_device_by_code(p_claim_code text)
returns public.devices
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.devices;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.devices
  set owner_id = auth.uid(),
      last_seen = now()
  where upper(public.devices.claim_code) = upper(p_claim_code)
    and public.devices.owner_id is null
  returning * into result;

  if result.id is null then
    raise exception 'Invalid or already claimed code';
  end if;

  return result;
end;
$$;

create or replace function public.set_claim_code_if_missing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.claim_code is null or length(trim(new.claim_code)) = 0 then
    new.claim_code := upper(encode(gen_random_bytes(4), 'hex'));
  end if;

  return new;
end;
$$;

drop trigger if exists devices_set_claim_code on public.devices;
create trigger devices_set_claim_code before insert or update of claim_code on public.devices
for each row execute function public.set_claim_code_if_missing();

create table if not exists public.learned_patterns (
  id uuid not null default gen_random_uuid(),
  user_id uuid null,
  day text not null,
  average_start text null,
  average_end text null,
  confidence integer null,
  payload jsonb null default '{}'::jsonb,
  created_at timestamp with time zone null default now(),
  constraint learned_patterns_pkey primary key (id),
  constraint learned_patterns_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade
) tablespace pg_default;

create index if not exists learned_patterns_user_id_day_idx
  on public.learned_patterns using btree (user_id, day) tablespace pg_default;

create table if not exists public.sensor_events (
  id uuid not null default gen_random_uuid(),
  device_id uuid null,
  timestamp timestamp with time zone null default now(),
  motion boolean null,
  ssr boolean null,
  led boolean null,
  firmware text null,
  raw jsonb null default '{}'::jsonb,
  constraint sensor_events_pkey primary key (id),
  constraint sensor_events_device_id_fkey foreign key (device_id) references public.devices (id) on delete cascade
) tablespace pg_default;

create index if not exists sensor_events_device_id_timestamp_idx
  on public.sensor_events using btree (device_id, "timestamp" desc) tablespace pg_default;

create or replace function public.trim_sensor_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.device_id is null then
    return new;
  end if;

  if (select count(*) from public.sensor_events where device_id = new.device_id) > 100 then
    delete from public.sensor_events
    where ctid in (
      select ctid
      from public.sensor_events
      where device_id = new.device_id
      order by "timestamp" asc
      offset 100
      limit 20
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_trim_sensor_events on public.sensor_events;
create trigger trg_trim_sensor_events
after insert on public.sensor_events
for each row
execute function public.trim_sensor_events();

create table if not exists public.presence_events (
  id uuid not null default gen_random_uuid(),
  device_id uuid not null,
  timestamp timestamp with time zone not null default now(),
  event text not null,
  note text null,
  firmware text null,
  constraint presence_events_pkey primary key (id),
  constraint presence_events_device_id_fkey foreign key (device_id) references public.devices (id) on delete cascade
) tablespace pg_default;

create index if not exists presence_events_device_id_timestamp_idx
  on public.presence_events using btree (device_id, "timestamp" desc) tablespace pg_default;

create table if not exists public.presence_acks (
  id uuid not null default gen_random_uuid(),
  device_id uuid not null,
  ack_at timestamp with time zone not null default now(),
  constraint presence_acks_pkey primary key (id),
  constraint presence_acks_device_id_fkey foreign key (device_id) references public.devices (id) on delete cascade
) tablespace pg_default;

create index if not exists presence_acks_device_id_ack_at_idx
  on public.presence_acks using btree (device_id, ack_at desc) tablespace pg_default;

create table if not exists public.user_settings (
  user_id uuid not null,
  notifications_enabled boolean null default true,
  dark_mode boolean null default false,
  display_name text null,
  auto_lights boolean null default true,
  auto_pc boolean null default true,
  auto_fan boolean null default true,
  updated_at timestamp with time zone null default now(),
  constraint user_settings_pkey primary key (user_id),
  constraint user_settings_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade
) tablespace pg_default;

create table if not exists public.session_logs (
  id uuid not null default gen_random_uuid(),
  device_id uuid null,
  user_id uuid null,
  time_in timestamp with time zone not null,
  time_out timestamp with time zone null,
  source text null,
  trigger text null,
  devices jsonb not null,
  created_at timestamp with time zone null default now(),
  constraint session_logs_pkey primary key (id),
  constraint session_logs_device_id_fkey foreign key (device_id) references public.devices (id) on delete cascade,
  constraint session_logs_user_id_fkey foreign key (user_id) references public.users (id) on delete set null
) tablespace pg_default;

create index if not exists session_logs_user_id_time_in_idx
  on public.session_logs using btree (user_id, time_in desc) tablespace pg_default;

create or replace function public.set_session_logs_user_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null and new.device_id is not null then
    select owner_id into new.user_id
    from public.devices
    where id = new.device_id
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_session_logs_user_id on public.session_logs;
create trigger trg_set_session_logs_user_id
before insert on public.session_logs
for each row
execute function public.set_session_logs_user_id();

create or replace function public.close_stale_sessions(inactivity_minutes integer default 10)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  with last_motion as (
    select device_id, max(timestamp) as last_motion_at
    from public.sensor_events
    where motion is true
    group by device_id
  ),
  candidates as (
    select s.id,
           s.time_in,
           greatest(s.time_in, coalesce(m.last_motion_at, s.time_in)) as last_activity
    from public.session_logs s
    left join last_motion m on m.device_id = s.device_id
    where s.time_out is null
      and s.device_id is not null
  ),
  to_close as (
    select id,
           last_activity + make_interval(mins => inactivity_minutes) as timeout_at
    from candidates
    where last_activity <= now() - make_interval(mins => inactivity_minutes)
  )
  update public.session_logs s
  set time_out = t.timeout_at
  from to_close t
  where s.id = t.id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

-- Consolidated view: user + device + latest sensor status + overrides
create or replace view public.device_status_view as
select
  d.id as device_id,
  d.name as device_name,
  d.location as device_location,
  d.owner_id as user_id,
  u.email as user_email,
  u.full_name as user_full_name,
  d.last_seen as device_last_seen,
  d.state as device_state,
  d.overrides as device_overrides,
  (d.overrides ->> 'lights')::boolean as override_lights,
  (d.overrides ->> 'pc')::boolean as override_pc,
  (d.overrides ->> 'fan')::boolean as override_fan,
  se.timestamp as last_event_at,
  se.motion as last_motion,
  se.ssr as last_ssr,
  se.led as last_led,
  se.firmware as last_firmware
from public.devices d
left join public.users u
  on u.id = d.owner_id
left join lateral (
  select
    s.timestamp,
    s.motion,
    s.ssr,
    s.led,
    s.firmware
  from public.sensor_events s
  where s.device_id = d.id
  order by s.timestamp desc
  limit 1
) se on true;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'close-stale-sessions') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'close-stale-sessions'));
  end if;

  perform cron.schedule(
    'close-stale-sessions',
    '* * * * *',
    'select public.close_stale_sessions(10);'
  );
end;
$$;

alter table public.sensor_events enable row level security;
alter table public.session_logs enable row level security;
alter table public.presence_events enable row level security;
alter table public.devices enable row level security;

drop policy if exists firmware_insert_sensor_events on public.sensor_events;
create policy firmware_insert_sensor_events
on public.sensor_events
for insert
with check (device_id is not null);

drop policy if exists app_read_sensor_events on public.sensor_events;
create policy app_read_sensor_events
on public.sensor_events
for select
using (
  device_id in (
    select id
    from public.devices
    where owner_id = auth.uid()
  )
);

drop policy if exists firmware_insert_session_logs on public.session_logs;
create policy firmware_insert_session_logs
on public.session_logs
for insert
with check (device_id is not null);

drop policy if exists firmware_insert_presence_events on public.presence_events;
create policy firmware_insert_presence_events
on public.presence_events
for insert
with check (device_id is not null);

drop policy if exists firmware_read_device_overrides on public.devices;
create policy firmware_read_device_overrides
on public.devices
for select
using (
  id::text = coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'device_id'
);

drop policy if exists app_read_session_logs on public.session_logs;
create policy app_read_session_logs
on public.session_logs
for select
using (user_id = auth.uid());

drop policy if exists app_update_device_overrides on public.devices;
create policy app_update_device_overrides
on public.devices
for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- Phase 5: Data consistency + backfill
update public.session_logs s
set user_id = d.owner_id
from public.devices d
where s.user_id is null
  and s.device_id = d.id
  and d.owner_id is not null;

update public.devices
set claim_code = upper(encode(gen_random_bytes(4), 'hex'))
where claim_code is null or length(trim(claim_code)) = 0;

-- Phase 6: End-to-end validation (manual test inserts)
-- Replace with real UUIDs before running.
-- insert into public.sensor_events (device_id, motion, ssr, led, firmware)
-- values ('00000000-0000-0000-0000-000000000000', true, true, true, 'test-firmware');
--
-- insert into public.session_logs (device_id, user_id, time_in, time_out, source, trigger, devices)
-- values (
--   '00000000-0000-0000-0000-000000000000',
--   '00000000-0000-0000-0000-000000000000',
--   now(),
--   null,
--   'manual',
--   'presence-detected',
--   '{"lights": true, "pc": false, "fan": false}'::jsonb
-- );
