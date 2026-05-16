export type WorkstationStatus = 'closed' | 'booting' | 'ready'

export type LogSource = 'machine-learning' | 'manual'

export type TriggerSource = 'presence-detected' | 'manual'

export interface DeviceState {
  lights: boolean
  pc: boolean
  fan: boolean
}

export type DeviceOverrideState = Record<keyof DeviceState, boolean | null>

export interface DeviceRow {
  id: string
  name: string | null
  location: string | null
  owner_id: string | null
  state: Record<string, unknown> | null
  overrides: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string | null
  last_seen: string | null
  claim_code: string | null
}

export interface LogEntry {
  id: string
  device_id: string | null
  user_id: string | null
  time_in: string
  time_out: string | null
  source: string | null
  trigger: string | null
  devices: Record<string, unknown>
  created_at: string | null
}

export interface LogEntryView {
  id: string
  timeIn: string
  timeOut: string | null
  source: LogSource
  trigger: TriggerSource
  devices: DeviceState
}

export interface LearnedPattern {
  day: string
  averageStart: string
  averageEnd: string
  confidence: number
}

export interface LearnedPatternRow {
  id: string
  user_id: string | null
  day: string
  average_start: string | null
  average_end: string | null
  confidence: number | null
  payload: Record<string, unknown> | null
  created_at: string | null
}

export interface HourBucket {
  hour: number
  total: number
}

export interface AppSettings {
  user_id: string
  notifications_enabled: boolean | null
  dark_mode: boolean | null
  display_name: string | null
  auto_lights: boolean | null
  auto_pc: boolean | null
  auto_fan: boolean | null
  updated_at: string | null
}

export interface UiSettings {
  notificationsEnabled: boolean
  darkMode: boolean
  userName: string
  autoLights: boolean
  autoPc: boolean
  autoFan: boolean
  deviceId: string
}

export interface InAppNotification {
  id: string
  message: string
  variant: 'info' | 'success' | 'warning'
}

export interface SensorEvent {
  id: string
  device_id: string | null
  timestamp: string
  motion: boolean
  ssr: boolean
  led: boolean
  firmware: string
  raw?: Record<string, unknown> | null
}

export interface PresenceEvent {
  id: string
  device_id: string | null
  timestamp: string
  event: string
  note: string | null
  firmware: string | null
}
