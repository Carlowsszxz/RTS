import { Lightbulb, Power } from 'lucide-react'
import { useEffect } from 'react'
import type { DeviceOverrideState, DeviceState } from '../types'
import { NeoButton } from '../components/ui/NeoButton'
import { NeoCard } from '../components/ui/NeoCard'
import { useLatestSensorEvent } from '../hooks/useLatestSensorEvent'

interface AdminPageProps {
  isAdmin: boolean
  overrides: DeviceOverrideState
  deviceId: string
  onSetOverride: (key: keyof DeviceState, value: boolean | null) => void
  onRefresh?: () => void
}

export function AdminPage({
  isAdmin,
  overrides,
  deviceId,
  onSetOverride,
  onRefresh,
}: AdminPageProps) {
  // Auto-poll every 30 seconds to keep sensor data fresh
  useEffect(() => {
    const interval = setInterval(() => {
      onRefresh?.()
    }, 30000)  // 30 seconds
    return () => clearInterval(interval)
  }, [onRefresh])
  const ssrForced = overrides.lights ?? null // what we're trying to force for the bulb
  const { event: latestSensorEvent } = useLatestSensorEvent(deviceId)
  const ssrActual = latestSensorEvent?.ssr ?? false // what ESP32 is actually reporting

  // Format time for display
  const lastUpdateTime = latestSensorEvent?.timestamp
    ? new Date(latestSensorEvent.timestamp).toLocaleTimeString()
    : 'waiting...'

  // Calculate data staleness (>30 seconds = disable controls per spec section 5, 8 scenario 9)
  const latestSensorMs = latestSensorEvent ? new Date(latestSensorEvent.timestamp).getTime() : null
  const controlStaleThresholdMs = 120 * 1000 // 120 seconds for stale warning
    const isControlStale = latestSensorMs ? Date.now() - latestSensorMs > controlStaleThresholdMs : false
    const secondsSinceControlUpdate = latestSensorMs ? Math.floor((Date.now() - latestSensorMs) / 1000) : null
  
  // Also track offline (>60 seconds) separately
  const dataStaleThresholdMs = 60 * 1000 // 60 seconds for offline warning
    const isDataStale = !latestSensorMs || Date.now() - latestSensorMs > dataStaleThresholdMs
    const secondsSinceLastEvent = latestSensorMs ? Math.floor((Date.now() - latestSensorMs) / 1000) : null
  const lastFirmwareVersion = latestSensorEvent?.firmware || null

  if (!isAdmin) {
    return (
      <main className='mx-auto w-full max-w-7xl px-4 py-8 sm:py-12'>
        <NeoCard className='bg-neo-canvas' title='Manual Control Locked' accent='white'>
          <p className='text-xl font-bold'>Enable Admin Mode from the top-right toggle to access manual controls.</p>
        </NeoCard>
      </main>
    )
  }

  return (
    <main className='mx-auto w-full max-w-7xl px-4 py-8 sm:py-12'>
      {/* Stale/Offline Data Warning (Spec Section 8, Scenario 6, 9) */}
      {isDataStale && (
        <section className='mb-8 border-4 border-black bg-yellow-200 p-4 shadow-neo-md'>
          <div className='flex items-start gap-3'>
            <span className='mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-black text-xs font-black text-yellow-200'>
              ⚠
            </span>
            <div className='flex-1'>
              <p className='font-black uppercase tracking-[0.15em]'>
                ⚠️ No sensor data for {secondsSinceLastEvent ? `${secondsSinceLastEvent} seconds` : 'unknown duration'}
              </p>
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

      <section className='grid grid-cols-1 gap-8'>
        {/* Main Lightbulb Control */}
        <NeoCard className='bg-neo-canvas' title='Lightbulb Control' accent='white'>
          <div className='space-y-4'>
            <div className='flex flex-wrap items-center gap-4'>
              <div
                className={`rounded-lg border-2 border-neo-ink p-3 transition-colors ${
                  ssrActual ? 'bg-neo-surface' : 'bg-neo-canvas/70'
                }`}
              >
                <Lightbulb
                  className={`h-8 w-8 stroke-neo-ink stroke-[2px] ${
                    ssrActual ? 'fill-neo-secondary/60' : 'fill-neo-ink/20'
                  }`}
                />
              </div>
              <div className='flex-1'>
                <p className='text-xs font-bold uppercase tracking-wider text-neo-ink/70'>Real-time Status</p>
                <div className='flex flex-wrap items-center gap-3'>
                  <span className='text-2xl font-black uppercase'>{ssrActual ? 'ON' : 'OFF'}</span>
                  <span className='inline-flex items-center gap-2 text-xs font-bold text-neo-ink/80'>
                    <span className='inline-block h-2 w-2 rounded-full bg-neo-secondary' />
                    {latestSensorEvent ? 'Live' : 'Connecting...'}
                  </span>
                </div>
                <p className='text-xs text-neo-ink/60'>Last update: {lastUpdateTime}</p>
              </div>
              <div className='ml-auto flex items-center gap-2 rounded-lg border-2 border-neo-ink bg-neo-canvas/70 px-3 py-1 text-xs font-black uppercase'>
                Forced: {ssrForced === null ? 'None' : ssrForced ? 'On' : 'Off'}
              </div>
            </div>

            {ssrForced !== null && ssrActual !== ssrForced && (
              <p className='text-xs text-neo-ink/70'>
                ⚠ Device not responding yet (ESP32 checks every 5s) {/* Match Arduino OVERRIDE_POLL_INTERVAL */}
              </p>
            )}

            {/* Stale Data Warning for Override Controls (Spec Section 5, 8, Scenario 9) */}
            {isControlStale && !isDataStale && (
              <div className='rounded-lg border-2 border-orange-500 bg-orange-100 p-2'>
                <div className='flex items-center justify-between gap-2'>
                  <div>
                    <p className='text-xs font-bold text-orange-900'>
                      ⚠️ Data may be {secondsSinceControlUpdate}s old. Override buttons disabled.
                    </p>
                    <p className='text-xs text-orange-800 mt-1'>Wait for live data to enable controls.</p>
                  </div>
                  <button
                    type='button'
                    onClick={onRefresh}
                    className='flex-shrink-0 border-2 border-orange-600 bg-orange-200 px-3 py-1 text-xs font-black uppercase tracking-[0.1em] shadow-neo-sm hover:bg-orange-300'
                  >
                    Refresh
                  </button>
                </div>
              </div>
            )}

            <div className='grid grid-cols-3 gap-2 border-t-2 border-neo-ink/60 pt-3'>
              <NeoButton
                variant={ssrForced === true ? 'primary' : 'outline'}
                onClick={() => onSetOverride('lights', true)}
                icon={<Power className='h-4 w-4 stroke-[3px]' />}
                className='py-3 text-xs'
                disabled={false}
              >
                Force ON
              </NeoButton>
              <NeoButton
                variant={ssrForced === false ? 'primary' : 'outline'}
                onClick={() => onSetOverride('lights', false)}
                icon={<Power className='h-4 w-4 stroke-[3px]' />}
                className='py-3 text-xs'
                disabled={false}
              >
                Force OFF
              </NeoButton>
              <NeoButton
                variant={ssrForced === null ? 'primary' : 'outline'}
                onClick={() => onSetOverride('lights', null)}
                icon={<Power className='h-4 w-4 stroke-[3px]' />}
                className='py-3 text-xs'
                disabled={false}
              >
                Clear
              </NeoButton>
            </div>
          </div>
        </NeoCard>


      </section>
    </main>
  )
}
