# Database Reference

This document summarizes the database schema used by the project for quick reference.

## Schema Overview

The database contains the following public tables:

- app_meta
- devices
- sensor_events
- session_logs
- presence_events
- presence_acks
- user_settings
- users

## Table Definitions

### app_meta

Stores application-level metadata as key/value pairs.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| key | text | No | — | Primary key |
| value | jsonb | Yes | — | Arbitrary JSON metadata |

**Primary key:** key

---

### users

Stores registered user accounts.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | No | gen_random_uuid() | Primary key |
| full_name | text | Yes | — | User's full name |
| email | text | Yes | — | Unique email address |
| password_hash | text | Yes | — | Hashed password |
| created_at | timestamp with time zone | Yes | now() | Account creation time |
| last_seen | timestamp with time zone | Yes | — | Last activity timestamp |

**Constraints:**

- Primary key: id
- Unique: email

---

### devices

Stores IoT or controlled devices linked to users.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | No | gen_random_uuid() | Primary key |
| name | text | Yes | — | Device name |
| location | text | Yes | — | Device location |
| owner_id | uuid | Yes | — | References users.id |
| state | jsonb | Yes | '{}'::jsonb | Current device state |
| overrides | jsonb | Yes | '{}'::jsonb | Manual override values |
| metadata | jsonb | Yes | '{}'::jsonb | Additional device metadata |
| created_at | timestamp with time zone | Yes | now() | Creation time |
| last_seen | timestamp with time zone | Yes | — | Last heartbeat / activity time |

**Constraints:**

- Primary key: id
- Foreign key: owner_id references users(id) on delete set null

---

### sensor_events

Stores sensor readings and device activity events.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | No | gen_random_uuid() | Primary key |
| device_id | uuid | Yes | — | References devices.id |
| timestamp | timestamp with time zone | Yes | now() | Event timestamp |
| motion | boolean | Yes | — | Motion detected flag |
| ssr | boolean | Yes | — | SSR state |
| led | boolean | Yes | — | LED state |
| firmware | text | Yes | — | Firmware version or tag |
| raw | jsonb | Yes | '{}'::jsonb | Raw payload / extra data |

**Constraints:**

- Primary key: id
- Foreign key: device_id references devices(id) on delete cascade

**Index:**

- sensor_events_device_id_timestamp_idx on (device_id, timestamp DESC)

---

### session_logs

Stores user session history and device activity summaries.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | No | gen_random_uuid() | Primary key |
| user_id | uuid | Yes | — | References users.id |
| time_in | timestamp with time zone | No | — | Session start time |
| time_out | timestamp with time zone | Yes | — | Session end time |
| source | text | Yes | — | Login source or origin |
| trigger | text | Yes | — | What started the session |
| devices | jsonb | No | — | Snapshot of related devices |
| created_at | timestamp with time zone | Yes | now() | Record creation time |

**Constraints:**

- Primary key: id
- Foreign key: user_id references users(id) on delete set null

**Index:**

- session_logs_user_id_time_in_idx on (user_id, time_in DESC)

---

### presence_events

Stores presence-related events emitted by firmware.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | No | gen_random_uuid() | Primary key |
| device_id | uuid | No | — | References devices.id |
| timestamp | timestamp with time zone | No | now() | Event time |
| event | text | No | — | Event type, e.g. still_there_prompt |
| note | text | Yes | — | Optional detail |
| firmware | text | Yes | — | Firmware version or tag |

**Constraints:**

- Primary key: id
- Foreign key: device_id references devices(id) on delete cascade

**Index:**

- presence_events_device_id_timestamp_idx on (device_id, timestamp DESC)

---

### presence_acks

Stores user acknowledgements of presence prompts.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | No | gen_random_uuid() | Primary key |
| device_id | uuid | No | — | References devices.id |
| ack_at | timestamp with time zone | No | now() | Acknowledgement time |

**Constraints:**

- Primary key: id
- Foreign key: device_id references devices(id) on delete cascade

**Index:**

- presence_acks_device_id_ack_at_idx on (device_id, ack_at desc)

---

### user_settings

Stores per-user preferences and automation settings.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| user_id | uuid | No | — | Primary key and foreign key to users.id |
| notifications_enabled | boolean | Yes | true | Enable notifications |
| dark_mode | boolean | Yes | false | Enable dark mode |
| display_name | text | Yes | — | Preferred display name |
| auto_lights | boolean | Yes | true | Auto-control lights |
| auto_pc | boolean | Yes | true | Auto-control PC power |
| auto_fan | boolean | Yes | true | Auto-control fan |
| updated_at | timestamp with time zone | Yes | now() | Last update time |

**Constraints:**

- Primary key: user_id
- Foreign key: user_id references users(id) on delete cascade

## Relationships

- devices.owner_id → users.id
- sensor_events.device_id → devices.id
- session_logs.user_id → users.id
- presence_events.device_id → devices.id
- presence_acks.device_id → devices.id
- user_settings.user_id → users.id

## Notes

- JSONB fields are used for flexible state storage and extensible metadata.
- devices, sensor_events, and session_logs are indexed to support common lookups and sorting.
- The source SQL included a repeated devices definition; this reference lists it once.
