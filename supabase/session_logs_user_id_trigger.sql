-- Auto-attach user_id to session_logs based on device owner.
-- Run in Supabase SQL editor as an admin/owner role.

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

-- Optional backfill for existing rows missing user_id.
update public.session_logs s
set user_id = d.owner_id
from public.devices d
where s.user_id is null
  and s.device_id = d.id;

-- Optional index to speed up user-based queries.
create index if not exists session_logs_user_id_idx
on public.session_logs (user_id);
