import { useEffect, useState } from 'react'
import type { PresenceEvent } from '../types'
import { supabase } from '../lib/supabase'

function normalizePresenceEvent(row: Record<string, unknown>): PresenceEvent {
  return {
    id: String(row.id ?? crypto.randomUUID()),
    device_id: row.device_id ? String(row.device_id) : null,
    timestamp: String(row.timestamp ?? new Date().toISOString()),
    event: String(row.event ?? 'unknown'),
    note: row.note ? String(row.note) : null,
    firmware: row.firmware ? String(row.firmware) : null,
  }
}

export function useSupabasePresenceEvents(deviceId?: string | null, limit = 10) {
  const [events, setEvents] = useState<PresenceEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const normalizedDeviceId = deviceId?.trim() || null

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
          .from('presence_events')
          .select('id, device_id, timestamp, event, note, firmware')
          .eq('device_id', normalizedDeviceId)
          .order('timestamp', { ascending: false })
          .limit(limit)

        if (err) {
          setError(err.message)
          setEvents([])
          return
        }

        if (!mounted) return
        setEvents((data || []).map((row) => normalizePresenceEvent(row as Record<string, unknown>)))
        setError(null)

        channel = supabase
          .channel(`presence_events_updates_${normalizedDeviceId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'presence_events',
              filter: `device_id=eq.${normalizedDeviceId}`,
            },
            (payload) => {
              if (!mounted) return
              setEvents((prev) => [normalizePresenceEvent(payload.new as Record<string, unknown>), ...prev].slice(0, limit))
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
  }, [limit, normalizedDeviceId])

  return { events, loading, error }
}
