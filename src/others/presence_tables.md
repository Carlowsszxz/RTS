# Presence Tables (Supabase SQL)

Use this SQL in Supabase to add the new presence tables required by the ESP32 firmware.

```sql
create table if not exists presence_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  "timestamp" timestamptz not null default now(),
  event text not null,
  note text,
  firmware text
);

create index if not exists presence_events_device_id_timestamp_idx
  on presence_events (device_id, "timestamp" desc);

create table if not exists presence_acks (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  ack_at timestamptz not null default now()
);

create index if not exists presence_acks_device_id_ack_at_idx
  on presence_acks (device_id, ack_at desc);
```

## RLS (optional)
If you have Row Level Security enabled, add policies that allow the device to insert/read for its own `device_id` and the web app to insert `presence_acks` for the same device.
