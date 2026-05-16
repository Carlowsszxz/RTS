import { useEffect, useState } from 'react'
import type { SensorEvent } from '../types'
import { supabase } from '../lib/supabase'

/**
 * Subscribe to the latest sensor event for a specific device.
 * Useful for real-time status updates from IoT devices.
 */
function normalizeEvent(row: Partial<SensorEvent> & Record<string, unknown>): SensorEvent {
  return {
    id: String(row.id ?? crypto.randomUUID()),
    device_id: String(row.device_id ?? 'unknown-device'),
    timestamp: String(row.timestamp ?? new Date().toISOString()),
    motion: Boolean(row.motion),
    ssr: Boolean(row.ssr),
    led: Boolean(row.led),
    firmware: String(row.firmware ?? ''),
    raw: typeof row.raw === 'object' ? (row.raw as Record<string, unknown>) : null,
  }
}

export function useLatestSensorEvent(deviceId?: string | null) {
  const [event, setEvent] = useState<SensorEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    let pollTimer: number | null = null

    const fetchLatest = async () => {
      try {
        if (!deviceId) {
          if (mounted) {
            setEvent(null)
            setLoading(false)
            setError(null)
          }
          return
        }

        if (mounted) setLoading(true)
        const { data, error: fetchError } = await supabase
          .from('sensor_events')
          .select('id, device_id, timestamp, motion, ssr, led, firmware, raw')
          .eq('device_id', deviceId)
          .order('timestamp', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (fetchError) {
          console.warn('Initial fetch failed:', fetchError.message)
          if (mounted) setEvent(null)
        } else if (data && mounted) {
          setEvent(normalizeEvent(data as Record<string, unknown>))
        }
      } catch (err) {
        console.warn('Error fetching latest sensor event:', err)
        if (mounted) setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchLatest()

    if (!deviceId) {
      return
    }

    // Subscribe to INSERT events for this device
    const channel = supabase
      .channel(`sensor_${deviceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sensor_events',
          filter: `device_id=eq.${deviceId}`,
        },
        (payload) => {
          if (!mounted) return
          setEvent(normalizeEvent(payload.new as Record<string, unknown>))
        },
      )
      .subscribe()

    // Poll as a fallback in case realtime misses events or loses connection.
    pollTimer = window.setInterval(() => {
      void fetchLatest()
    }, 30000)

    return () => {
      mounted = false
      channel.unsubscribe()
      if (pollTimer) window.clearInterval(pollTimer)
    }
  }, [deviceId])

  return { event, loading, error }
}
