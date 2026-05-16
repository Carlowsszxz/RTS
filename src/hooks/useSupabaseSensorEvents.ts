import { useEffect, useState } from 'react'
import type { SensorEvent } from '../types'
import { supabase } from '../lib/supabase'

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

/**
 * Fetch real-time sensor events from IoT devices.
 * Shows live data from ESP32/Arduino devices posting to Supabase.
 */
export function useSupabaseSensorEvents(deviceId?: string | null, limit = 50) {
  const [events, setEvents] = useState<SensorEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const normalizedDeviceId = deviceId?.trim() || null

  const refresh = () => {
    setRefreshToken((current) => current + 1)
  }

  useEffect(() => {
    let mounted = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    const fetchEvents = async () => {
      try {
        if (!normalizedDeviceId) {
          setEvents([])
          setError(null)
          setLoading(false)
          return
        }

        setLoading(true)
        const { data, error: err } = await supabase
          .from('sensor_events')
          .select('id, device_id, timestamp, motion, ssr, led, firmware, raw')
          .eq('device_id', normalizedDeviceId)
          .order('timestamp', { ascending: false })
          .limit(limit)

        if (err) {
          setError(err.message)
          setEvents([])
          return
        }

        if (!mounted) return
        setEvents((data || []).map((row) => normalizeEvent(row as Record<string, unknown>)))
        setError(null)

        // Subscribe to new sensor events
        channel = supabase
          .channel(`sensor_events_updates_${normalizedDeviceId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'sensor_events',
              filter: `device_id=eq.${normalizedDeviceId}`,
            },
            (payload) => {
              if (!mounted) return
              setEvents((prev) => [normalizeEvent(payload.new as Record<string, unknown>), ...prev].slice(0, limit))
            },
          )
          .subscribe()
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setEvents([])
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchEvents()

    return () => {
      mounted = false
      if (channel) {
        channel.unsubscribe()
      }
    }
  }, [limit, normalizedDeviceId, refreshToken])

  return { events, loading, error, refresh }
}
