import { CalendarDays, Clock3, Cpu, Lightbulb, Timer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DeviceState, LearnedPattern, LogEntryView, PresenceEvent, SensorEvent, UiSettings, WorkstationStatus } from '../types'
import { NeoCard } from '../components/ui/NeoCard'
interface DashboardPageProps {
  status: WorkstationStatus
  devices: DeviceState
  logs: LogEntryView[]
  patterns: LearnedPattern[]
  sensorEvents: SensorEvent[]
  presenceEvents: PresenceEvent[]
  presenceLoading: boolean
  presenceError: string | null
  userName: string
  settings: UiSettings
  onConfirmPresence: () => void
  onRefresh?: () => void
}

function formatClock(value: Date) {
  return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDate(value: Date) {
  return value.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function formatLogTime(value: string | null) {
  if (!value) {
    return '—'
  }

  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function mergeNearbyLogs(logs: LogEntryView[], thresholdMinutes = 10) {
  if (logs.length === 0) return []

  const sorted = [...logs].sort((a, b) => new Date(a.timeIn).getTime() - new Date(b.timeIn).getTime())
  const merged: LogEntryView[] = []

  for (const log of sorted) {
    const last = merged[merged.length - 1]
    if (!last) {
      merged.push({ ...log })
      continue
    }

    if (!last.timeOut) {
      merged.push({ ...log })
      continue
    }

    const lastOut = new Date(last.timeOut).getTime()
    const currentIn = new Date(log.timeIn).getTime()
    const gapMinutes = (currentIn - lastOut) / 60000

    if (gapMinutes >= 0 && gapMinutes <= thresholdMinutes) {
      last.timeOut = log.timeOut
      last.devices = {
        lights: last.devices.lights || log.devices.lights,
        pc: last.devices.pc || log.devices.pc,
        fan: last.devices.fan || log.devices.fan,
      }
      continue
    }

    merged.push({ ...log })
  }

  return merged.sort((a, b) => new Date(b.timeIn).getTime() - new Date(a.timeIn).getTime())
}

function formatRelativeTime(timestamp: string) {
  const delta = Date.now() - new Date(timestamp).getTime()
  const s = Math.floor(delta / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

function getActionIcon(title: string) {
  const t = title.toLowerCase()
  if (t.includes('light')) return <Lightbulb className='mr-3 h-4 w-4' />
  if (t.includes('session')) return <Clock3 className='mr-3 h-4 w-4' />
  return <Timer className='mr-3 h-4 w-4' />
}

function formatDuration(start: string, end?: string | null) {
  const startMs = new Date(start).getTime()
  const endMs = end ? new Date(end).getTime() : Date.now()
  const delta = Math.max(0, endMs - startMs)

  const hrs = Math.floor(delta / 3600000)
  const mins = Math.floor((delta % 3600000) / 60000)
  if (hrs > 0) return `${hrs}h ${mins}m`
  return `${mins}m`
}

const TIME_OUT_VISIBILITY_MINUTES = 20

function computeHmDuration(startHm?: string | null, endHm?: string | null) {
  if (!startHm || !endHm) return null
  const parse = (s: string) => {
    const [h = '0', m = '0'] = s.split(':')
    const hh = parseInt(h, 10)
    const mm = parseInt(m, 10)
    if (Number.isNaN(hh) || Number.isNaN(mm)) return NaN
    return hh * 60 + mm
  }
  const s = parse(startHm)
  let e = parse(endHm)
  if (Number.isNaN(s) || Number.isNaN(e)) return null
  if (e < s) e += 24 * 60 // wraps past midnight
  const delta = e - s
  const hrs = Math.floor(delta / 60)
  const mins = delta % 60
  if (hrs > 0) return `${hrs}h ${mins}m`
  return `${mins}m`
}


export function DashboardPage({
  status,
  devices,
  logs,
  patterns,
  sensorEvents,
  presenceEvents,
  presenceLoading,
  presenceError,
  userName,
  settings,
  onConfirmPresence,
  onRefresh,
}: DashboardPageProps) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Auto-poll every 30 seconds to keep sensor data fresh
  useEffect(() => {
    const interval = setInterval(() => {
      onRefresh?.()
    }, 30000)  // 30 seconds
    return () => clearInterval(interval)
  }, [onRefresh])

  const sensorEventsNewestFirst = useMemo(
    () =>
      [...sensorEvents].sort((a, b) => {
        const aTime = new Date(a.timestamp).getTime()
        const bTime = new Date(b.timestamp).getTime()
        return bTime - aTime
      }),
    [sensorEvents],
  )

  // Only consider logs that recorded at least one device on when showing Time In
  const deviceDependentLogs = useMemo(() => logs.filter((l) => l.devices.lights || l.devices.pc || l.devices.fan), [logs])
  const latestLogs = useMemo(() => mergeNearbyLogs(deviceDependentLogs, 10).slice(0, 5), [deviceDependentLogs])
  const topPattern = patterns[0]
  const recentActions = useMemo(() => {
    const actions: Array<{ id: string; time: string; title: string; detail: string }> = []

    // Use device-dependent logs for session actions so we don't show "timed in" events
    // when devices were all off.
    deviceDependentLogs.forEach((log) => {
      const triggerLabel = log.trigger.replace('-', ' ')
      if (log.timeIn) {
        actions.push({
          id: `${log.id}-in`,
          time: log.timeIn,
          title: 'Session started',
          detail: `Trigger: ${triggerLabel}`,
        })
      }
      if (log.timeOut) {
        actions.push({
          id: `${log.id}-out`,
          time: log.timeOut,
          title: 'Session ended',
          detail: `Trigger: ${triggerLabel}`,
        })
      }
    })

    for (let index = 0; index < sensorEvents.length; index += 1) {
      const current = sensorEvents[index]
      const previous = sensorEvents[index + 1]
      if (!previous || current.ssr !== previous.ssr) {
        actions.push({
          id: `${current.id}-ssr`,
          time: current.timestamp,
          title: current.ssr ? 'Lights turned on' : 'Lights turned off',
          detail: current.firmware ? `Firmware: ${current.firmware}` : 'Firmware: —',
        })
      }
    }

    return actions
      .filter((action) => action.time)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 8)
  }, [deviceDependentLogs, sensorEventsNewestFirst])

  const latestPresenceEvent = presenceEvents[0]
  const latestSensorEvent = sensorEventsNewestFirst[0] ?? null
  const latestSensorMs = latestSensorEvent ? new Date(latestSensorEvent.timestamp).getTime() : null
  const promptIntervalMs = 10 * 60 * 1000 // Match Arduino IDLE_PROMPT_MS (10 minutes)
  const promptTimeoutMs = 5 * 60 * 1000 // 5 minutes to ACK before forced off (spec section 7)
  
  // Track session timeout: if prompt sent + no ACK for 5 min, session times out
  // Find the latest prompt event (whether auto-generated or from Arduino)
  const latestPromptEvent = presenceEvents.find((evt) => evt.event === 'still_there_prompt')
  const latestAckEvent = presenceEvents.find((evt) => evt.event === 'still_there_ack')
  
  // Determine if prompt is currently "active" (sent but not yet acked)
  const promptActiveMs = latestPromptEvent ? new Date(latestPromptEvent.timestamp).getTime() : null
  const ackReceivedMs = latestAckEvent ? new Date(latestAckEvent.timestamp).getTime() : null
  const promptHasValidAck = promptActiveMs && ackReceivedMs && ackReceivedMs > promptActiveMs
  
  // Determine active session only from logs that indicate a device was on
  let hasActiveSession = deviceDependentLogs.some((log) => !log.timeOut)

  // If logs claim an active session but all devices are off and
  // sensors indicate lights are off and there's no recent motion,
  // treat the session as inactive to avoid showing a false "timed in" state.
  const anyDeviceOn = devices.lights || devices.pc || devices.fan
  if (hasActiveSession && !anyDeviceOn) {
    const latestSsrOn = latestSensorEvent?.ssr ?? false
    const recentMotion = latestSensorMs ? now.getTime() - latestSensorMs < promptIntervalMs + promptTimeoutMs : false
    if (!latestSsrOn && !recentMotion) {
      hasActiveSession = false
    }
  }
  
  // Check if session should be force-cleared due to timeout (spec section 8, scenario 7)
  // Timeout occurs if: prompt sent + >5min without ACK, OR >15min since last motion
  const timeSinceLastMotion = latestSensorMs ? now.getTime() - latestSensorMs : null
  const timeSincePrompt = promptActiveMs && !promptHasValidAck ? now.getTime() - promptActiveMs : null
  const sessionForceTimedOut =
    hasActiveSession &&
    (
      // Condition 1: Prompt sent >5 min ago without ACK
      (timeSincePrompt && timeSincePrompt > promptTimeoutMs) ||
      // Condition 2: No motion for >15 min (10min idle + 5min timeout window)
      (timeSinceLastMotion && timeSinceLastMotion > promptIntervalMs + promptTimeoutMs)
    )
  
  // If session timed out, treat as inactive despite what logs say
  if (sessionForceTimedOut) {
    hasActiveSession = false
  }
  
  const shouldAutoPrompt =
    hasActiveSession && !!latestSensorMs && now.getTime() - latestSensorMs >= promptIntervalMs
  const autoPromptEvent: PresenceEvent | null = shouldAutoPrompt
    ? {
        id: 'auto-prompt',
        device_id: latestSensorEvent?.device_id ?? null,
        timestamp: now.toISOString(),
        event: 'still_there_prompt',
        note: 'No motion update in 10 minutes. Confirm to keep the session active.',
        firmware: null,
      }
    : null
  const displayPresenceEvent = shouldAutoPrompt ? autoPromptEvent : latestPresenceEvent
  const shouldConfirmPresence = displayPresenceEvent?.event === 'still_there_prompt'
  const lastMotionLabel = latestSensorEvent
    ? new Date(latestSensorEvent.timestamp).toLocaleTimeString()
    : '—'
  const sessionLabel = hasActiveSession ? 'Active' : sessionForceTimedOut ? 'Timed Out' : 'Idle'
  const promptLabel = shouldConfirmPresence ? 'Confirm' : 'Clear'

  // Calculate data staleness (>60 seconds = stale per spec section 8)
  const dataStaleThresholdMs = 60 * 1000 // 60 seconds
  const isDataStale = !latestSensorMs || now.getTime() - latestSensorMs > dataStaleThresholdMs
  const secondsSinceLastEvent = latestSensorMs ? Math.floor((now.getTime() - latestSensorMs) / 1000) : null
  const lastFirmwareVersion = latestSensorEvent?.firmware || null

  return (
    <main className='mx-auto w-full max-w-7xl px-4 py-8 sm:py-12'>
      <section className='grid grid-cols-1 gap-8 lg:grid-cols-[1.2fr_0.8fr]'>
        <NeoCard className='rotate-[-1deg] bg-neo-canvas' title='Current Time & Date' accent='white'>
          <div className='space-y-3'>
            <p className='inline-block rotate-1 border-4 border-black bg-neo-canvas px-3 py-1 text-sm font-black uppercase tracking-[0.2em]'>
              Live Clock
            </p>
            <p className='text-sm font-black uppercase tracking-[0.2em]'>Welcome back, {userName}</p>
            <h1 className='text-4xl font-black uppercase tracking-tight sm:text-6xl md:text-7xl'>{formatClock(now)}</h1>
            <p className='text-lg font-bold sm:text-xl'>{formatDate(now)}</p>
          </div>
        </NeoCard>

        <NeoCard className='rotate-1 bg-neo-canvas' title='Workstation Status' accent='white'>
          <div className='flex flex-col gap-4'>
            <p className='text-lg font-bold'>
              Comfort system state is currently <span className='uppercase'>{status}</span>.
            </p>
            <div className='grid grid-cols-1 gap-3 text-xs font-black uppercase tracking-wide sm:grid-cols-3 sm:text-sm'>
              <div className='border-4 border-neo-ink bg-neo-canvas/70 p-3 shadow-neo-sm'>
                <Lightbulb className='mb-2 h-5 w-5 stroke-[3px]' />
                Auto Lights: {settings.autoLights ? 'On' : 'Off'}
              </div>
              <div className='border-4 border-neo-ink bg-neo-canvas/70 p-3 shadow-neo-sm'>
                <span className='mb-2 block text-[0.65rem] tracking-[0.3em] text-neo-ink/70'>Session</span>
                {sessionLabel}
              </div>
              <div className='border-4 border-neo-ink bg-neo-canvas/70 p-3 shadow-neo-sm'>
                <span className='mb-2 block text-[0.65rem] tracking-[0.3em] text-neo-ink/70'>Last Motion</span>
                {lastMotionLabel}
              </div>
            </div>
            <div className='grid grid-cols-2 gap-3 text-[0.7rem] font-black uppercase tracking-[0.28em]'>
              <div className='border-4 border-neo-ink bg-neo-canvas/70 px-3 py-2 shadow-neo-sm'>
                Presence Check: {promptLabel}
              </div>
              <div className='border-4 border-neo-ink bg-neo-canvas/70 px-3 py-2 shadow-neo-sm'>
                Sync: {latestSensorEvent ? 'Live' : 'Waiting'}
              </div>
            </div>
            
            {/* Session Timeout Warning (Spec Section 7, 8, Scenario 7) */}
            {sessionForceTimedOut && (
              <div className='border-4 border-red-600 bg-red-100 px-3 py-2 shadow-neo-sm'>
                <p className='text-xs font-black uppercase tracking-[0.15em] text-red-900'>
                  ❌ Session expired (no response to prompt)
                </p>
                <p className='text-xs text-red-800 font-bold mt-1'>
                  {timeSincePrompt && timeSincePrompt > promptTimeoutMs
                    ? `No confirmation for ${Math.floor(timeSincePrompt / 1000)}s. SSR forced OFF.`
                    : `Idle for ${Math.floor((timeSinceLastMotion ?? 0) / 1000)}s. SSR forced OFF.`}
                </p>
              </div>
            )}
          </div>
        </NeoCard>
      </section>

      {/* Stale/Offline Data Warning (Spec Section 8, Scenario 6, 9) */}
      {isDataStale && (
        <section className='mt-8 border-4 border-black bg-yellow-200 p-4 shadow-neo-md'>
          <div className='flex items-start gap-3'>
            <span className='mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-black text-xs font-black text-yellow-200'>
              ⚠
            </span>
            <div className='flex-1'>
              <div className='flex items-center justify-between gap-3'>
                <p className='font-black uppercase tracking-[0.15em]'>
                  ⚠️ No sensor data for {secondsSinceLastEvent ? `${secondsSinceLastEvent} seconds` : 'unknown duration'}
                </p>
                <button
                  type='button'
                  onClick={onRefresh}
                  className='flex-shrink-0 border-2 border-black bg-yellow-300 px-3 py-1 text-xs font-black uppercase tracking-[0.1em] shadow-neo-sm hover:bg-yellow-400'
                >
                  Refresh
                </button>
              </div>
              <p className='mt-2 text-sm font-bold'>
                Device may be offline or experiencing issues. Try these troubleshooting steps:
              </p>
              <ul className='mt-2 space-y-1 text-xs font-bold'>
                <li>• Verify device WiFi connection and power</li>
                <li>• Check if device RTC (clock) is set correctly (needs year ≥ 2022)</li>
                <li>• Restart the Arduino/ESP32 device</li>
                <li>• If problem persists &gt;5 minutes, check network connectivity</li>
              </ul>
              {lastFirmwareVersion && (
                <p className='mt-2 text-xs font-bold text-gray-700'>
                  Last firmware: <span className='font-mono text-gray-900'>{lastFirmwareVersion}</span>
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      <section className='mt-10 grid grid-cols-1 gap-8 lg:grid-cols-2'>
        <NeoCard className='bg-neo-canvas' title='Recorded Time In / Out' accent='white'>
          <div className='overflow-x-auto'>
            <table className='w-full border-collapse text-left text-sm font-bold'>
              <thead>
                <tr className='border-b-4 border-black'>
                  <th className='px-2 py-2'>Event</th>
                  <th className='px-2 py-2'>Start</th>
                  <th className='px-2 py-2'>End</th>
                  <th className='px-2 py-2'>Duration</th>
                </tr>
              </thead>
              <tbody>
                {latestLogs.map((log) => {
                  const isActive = !log.timeOut
                  const durationMinutes = log.timeOut
                    ? Math.max(0, (new Date(log.timeOut).getTime() - new Date(log.timeIn).getTime()) / 60000)
                    : null
                  const showTimeOut = !isActive && durationMinutes !== null && durationMinutes >= TIME_OUT_VISIBILITY_MINUTES
                  const rowClass = `border-b-2 ${isActive ? 'bg-yellow-100 border-yellow-600' : 'border-black'}`
                  return (
                    <tr key={log.id} className={rowClass}>
                      <td className='px-2 py-2 uppercase'>{log.trigger.replace('-', ' ')}</td>
                      <td className='px-2 py-2'>{formatLogTime(log.timeIn)}</td>
                      <td className='px-2 py-2'>
                        {isActive ? 'Active' : showTimeOut ? formatLogTime(log.timeOut) : '—'}
                      </td>
                      <td className='px-2 py-2'>{isActive ? `Active • ${formatDuration(log.timeIn)}` : formatDuration(log.timeIn, log.timeOut)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </NeoCard>

        <NeoCard className='bg-neo-canvas' title='Personal Comfort Schedule' accent='white'>
          {topPattern ? (
            <div className='space-y-3'>
              <div>
                <p className='text-2xl font-black uppercase tracking-tight'>{topPattern.day}</p>
                <p className='text-sm text-gray-700'>
                  {topPattern.averageStart} — {topPattern.averageEnd}
                  {(() => {
                    const d = computeHmDuration(topPattern.averageStart, topPattern.averageEnd)
                    return d ? ` • ${d}` : ''
                  })()}
                </p>
              </div>

              <div>
                <div className='w-full rounded bg-gray-200 h-3 overflow-hidden' role='progressbar' aria-valuemin={0} aria-valuemax={100} aria-valuenow={topPattern.confidence} aria-label={`Confidence ${topPattern.confidence} percent`}>
                  <div className='h-3 bg-green-500' style={{ width: `${topPattern.confidence}%` }} />
                </div>
                <p className='mt-1 text-xs font-bold'>Confidence {topPattern.confidence}%</p>
              </div>
            </div>
          ) : (
            <p className='font-bold'>No pattern data yet.</p>
          )}
        </NeoCard>
      </section>

      <section className='mt-10 grid grid-cols-1 gap-8 lg:grid-cols-2'>
        <NeoCard className='bg-neo-canvas' title='Presence Check' accent='white'>
          <div className='space-y-3'>
            <p className='font-bold'>Latest presence prompt.</p>
            {presenceError ? (
              <div className='border-2 border-red-600 bg-red-100 p-3 text-sm font-bold shadow-neo-sm'>
                Presence fetch failed: {presenceError}
              </div>
            ) : null}
            {displayPresenceEvent ? (
              <div className='border-2 border-black bg-white p-3 text-sm font-bold shadow-neo-sm'>
                <p className='text-xs uppercase tracking-[0.2em]'>
                  {displayPresenceEvent.event.replaceAll('_', ' ')}
                </p>
                <p className='text-xs text-gray-600'>
                  {new Date(displayPresenceEvent.timestamp).toLocaleTimeString()}
                </p>
                {displayPresenceEvent.note ? (
                  <p className='text-xs text-gray-600'>{displayPresenceEvent.note}</p>
                ) : null}
              </div>
            ) : presenceLoading ? (
              <div className='border-2 border-black bg-white p-3 text-sm font-bold shadow-neo-sm'>
                Loading presence events...
              </div>
            ) : (
              <div className='border-2 border-black bg-white p-3 text-sm font-bold shadow-neo-sm'>
                No presence events yet.
              </div>
            )}

            <button
              type='button'
              onClick={onConfirmPresence}
              disabled={!shouldConfirmPresence}
              className='w-full border-2 border-black bg-neo-secondary px-4 py-2 text-xs font-black uppercase tracking-[0.2em] shadow-neo-sm disabled:cursor-not-allowed disabled:opacity-50'
            >
              Confirm Presence
            </button>
          </div>
        </NeoCard>

        <NeoCard className='bg-neo-canvas' title='Presence Events' accent='white'>
          <div className='space-y-2'>
            {presenceError ? (
              <div className='border-2 border-red-600 bg-red-100 p-3 text-sm font-bold shadow-neo-sm'>
                Presence fetch failed: {presenceError}
              </div>
            ) : presenceLoading ? (
              <div className='border-2 border-black bg-white p-3 text-sm font-bold shadow-neo-sm'>
                Loading presence events...
              </div>
            ) : presenceEvents.length > 0 ? (
              <ul className='space-y-2'>
                {presenceEvents.slice(0, 5).map((eventItem) => (
                  <li
                    key={eventItem.id}
                    className='flex items-center justify-between gap-3 border-2 border-black bg-white px-3 py-2 text-xs font-bold shadow-neo-sm'
                  >
                    <span className='uppercase tracking-[0.2em]'>
                      {eventItem.event.replaceAll('_', ' ')}
                    </span>
                    <span className='text-gray-600'>
                      {new Date(eventItem.timestamp).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className='border-2 border-black bg-white p-3 text-sm font-bold shadow-neo-sm'>
                No presence activity yet.
              </div>
            )}
          </div>
        </NeoCard>
      </section>

      <section className='mt-10 grid grid-cols-1 gap-8'>
        <NeoCard className='bg-neo-canvas' title='Recent Actions' accent='white'>
          <div className='space-y-3'>
            <p className='font-bold'>The latest sessions and light changes in one place.</p>

            {recentActions.length > 0 ? (
              (() => {
                const groups: Record<string, typeof recentActions> = {}
                for (const a of recentActions) {
                  const d = new Date(a.time)
                  const key = d.toISOString().slice(0, 10)
                  groups[key] = groups[key] || []
                  groups[key].push(a)
                }
                const sortedKeys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1))
                return (
                  <div className='space-y-4'>
                    {sortedKeys.map((key) => {
                      const items = groups[key]
                      const labelDate = new Date(key + 'T00:00:00')
                      const today = new Date()
                      const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
                      const header =
                        labelDate.toDateString() === today.toDateString()
                          ? 'Today'
                          : labelDate.toDateString() === yesterday.toDateString()
                          ? 'Yesterday'
                          : formatDate(labelDate)
                      return (
                        <div key={key}>
                          <div className='text-xs font-black uppercase text-gray-600 mb-2'>{header}</div>
                          <ul className='space-y-2'>
                            {items.map((action) => (
                              <li
                                key={action.id}
                                className='flex items-center justify-between gap-3 border-2 border-black bg-white px-3 py-2 shadow-neo-sm'
                              >
                                <div className='flex items-center'>
                                  <span className='text-gray-500'>{getActionIcon(action.title)}</span>
                                  <div>
                                    <p className='text-sm font-black uppercase tracking-[0.2em]'>{action.title}</p>
                                    <p className='text-xs font-bold text-gray-600'>{action.detail}</p>
                                  </div>
                                </div>
                                <span
                                  className='border-2 border-black bg-neo-canvas px-3 py-1 text-xs font-black uppercase tracking-[0.2em]'
                                  title={new Date(action.time).toLocaleString()}
                                >
                                  {formatRelativeTime(action.time)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                  </div>
                )
              })()
            ) : (
              <div className='border-2 border-black bg-white p-4 text-sm font-bold shadow-neo-sm'>
                No recent actions yet. Trigger a session or change the lights to get started.
              </div>
            )}
          </div>
        </NeoCard>
      </section>

      <section className='mt-10 grid grid-cols-2 gap-4 text-black sm:grid-cols-4'>
        <div className='border-4 border-black bg-neo-canvas p-4 font-black uppercase shadow-neo-sm'>
          <Clock3 className='mb-2 h-6 w-6 stroke-[3px]' />
          Live Sync
        </div>
        <div className='border-4 border-black bg-neo-canvas p-4 font-black uppercase shadow-neo-sm'>
          <CalendarDays className='mb-2 h-6 w-6 stroke-[3px]' />
          Personal Routine
        </div>
        <div className='border-4 border-black bg-neo-canvas p-4 font-black uppercase shadow-neo-sm'>
          <Cpu className='mb-2 h-6 w-6 stroke-[3px]' />
          Smart Detection
        </div>
        <div className='border-4 border-black bg-neo-canvas p-4 font-black uppercase shadow-neo-sm'>
          <Timer className='mb-2 h-6 w-6 stroke-[3px]' />
          Room Ready
        </div>
      </section>
    </main>
  )
}
