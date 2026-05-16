-- Migration: Prevent session_logs inserts when no device was on and no recent sensor activity
create or replace function public.validate_session_log_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  devs jsonb := new.devices;
  any_on boolean := false;
  recent_activity timestamp with time zone;
begin
  -- If device_id missing, allow (other policies handle nulls elsewhere)
  if new.device_id is null then
    return new;
  end if;

  if devs is not null then
    any_on := coalesce((devs ->> 'lights')::boolean, false)
          or coalesce((devs ->> 'pc')::boolean, false)
          or coalesce((devs ->> 'fan')::boolean, false);
  end if;

  if any_on then
    return new;
  end if;

  -- Allow if there was recent sensor activity around the session time.
  -- Check a short window: 2 minutes before time_in up to 1 minute after.
  select max(timestamp) into recent_activity
  from public.sensor_events
  where device_id = new.device_id
    and timestamp >= new.time_in - interval '2 minutes'
    and timestamp <= new.time_in + interval '1 minute'
    and (motion is true or ssr is true);

  if recent_activity is not null then
    return new;
  end if;

  -- No evidence device was actually on — reject insert to keep logs device-dependent.
  raise exception 'session_logs insert rejected: no device on and no recent sensor activity';
end;
$$;

drop trigger if exists trg_validate_session_logs_insert on public.session_logs;
create trigger trg_validate_session_logs_insert
before insert on public.session_logs
for each row execute function public.validate_session_log_insert();
