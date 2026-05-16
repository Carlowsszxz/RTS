import type { DeviceState, LogEntryView, UiSettings, WorkstationStatus } from '../types'

export const navItems = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Access Logs', to: '/logs' },
  { label: 'Comfort Pattern', to: '/pattern' },
  { label: 'Manual Control', to: '/admin' },
  { label: 'Settings', to: '/settings' },
]

export const initialStatus: WorkstationStatus = 'ready'

export const initialDevices: DeviceState = {
  lights: true,
  pc: true,
  fan: true,
}

export const initialSettings: UiSettings = {
  notificationsEnabled: true,
  darkMode: false,
  userName: '',
  autoLights: true,
  autoPc: true,
  autoFan: true,
  deviceId: '',
}

export const initialLogs: LogEntryView[] = [
  {
    id: 'log-1',
    timeIn: '2026-04-08T08:03:00',
    timeOut: '2026-04-08T17:14:00',
    source: 'machine-learning',
    trigger: 'presence-detected',
    devices: {
      lights: true,
      pc: true,
      fan: true,
    },
  },
  {
    id: 'log-2',
    timeIn: '2026-04-09T07:56:00',
    timeOut: '2026-04-09T17:09:00',
    source: 'machine-learning',
    trigger: 'presence-detected',
    devices: {
      lights: true,
      pc: true,
      fan: true,
    },
  },
  {
    id: 'log-3',
    timeIn: '2026-04-10T08:12:00',
    timeOut: '2026-04-10T17:21:00',
    source: 'machine-learning',
    trigger: 'presence-detected',
    devices: {
      lights: true,
      pc: true,
      fan: false,
    },
  },
  {
    id: 'log-4',
    timeIn: '2026-04-11T09:05:00',
    timeOut: '2026-04-11T16:42:00',
    source: 'machine-learning',
    trigger: 'presence-detected',
    devices: {
      lights: true,
      pc: true,
      fan: true,
    },
  },
  {
    id: 'log-5',
    timeIn: '2026-04-12T08:01:00',
    timeOut: null,
    source: 'manual',
    trigger: 'manual',
    devices: {
      lights: true,
      pc: true,
      fan: true,
    },
  },
]
