import { useEffect, useState } from 'react'
import type { DeviceState, LogEntry, LogEntryView, LogSource, TriggerSource } from '../types'
import { supabase } from '../lib/supabase'

function normalizeLogRow(row: Record<string, unknown> & Partial<LogEntry>): LogEntryView {
  const devices = row.devices
  let parsedDevices: DeviceState = { lights: false, pc: false, fan: false }

  if (devices && typeof devices === 'object') {
    parsedDevices = {
      lights: Boolean((devices as Record<string, unknown>).lights),
      pc: Boolean((devices as Record<string, unknown>).pc),
      fan: Boolean((devices as Record<string, unknown>).fan),
    }
  } else if (typeof devices === 'string') {
    try {
      const parsed = JSON.parse(devices) as Record<string, unknown>
      parsedDevices = {
        lights: Boolean(parsed.lights),
        pc: Boolean(parsed.pc),
        fan: Boolean(parsed.fan),
      }
    } catch {
      parsedDevices = { lights: false, pc: false, fan: false }
    }
  }

  const sourceValue = row.source === 'manual' ? 'manual' : 'machine-learning'
  const triggerValue = row.trigger === 'manual' ? 'manual' : 'presence-detected'

  return {
    id: String(row.id ?? crypto.randomUUID()),
    timeIn: String(row.time_in ?? new Date().toISOString()),
    timeOut: row.time_out ? String(row.time_out) : null,
    source: sourceValue as LogSource,
    trigger: triggerValue as TriggerSource,
    devices: parsedDevices,
  }
}

/**
 * Fetch session logs from Supabase and subscribe to real-time inserts.
 * Filters by both userId and deviceId to support multi-device scenarios.
 * Falls back to empty array if Supabase env vars are missing.
 */
export function useSupabaseLogs(userId?: string | null, deviceId?: string | null) {
  const [logs, setLogs] = useState<LogEntryView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    const fetchLogs = async () => {
      try {
        if (!userId || !deviceId) {
          setLogs([])
          setError(null)
          setLoading(false)
          return
        }

        setLoading(true)
        const { data, error: err } = await supabase
          .from('session_logs')
          .select('id, time_in, time_out, source, trigger, devices')
          .eq('user_id', userId)
          .eq('device_id', deviceId)
          .order('time_in', { ascending: false })
          .limit(100)

        if (err) {
          setError(err.message)
          setLogs([])
          return
        }

        if (!mounted) return

        // Transform database rows to UI log entries
        const transformed = (data || []).map((row) => normalizeLogRow(row as Record<string, unknown>))

        setLogs(transformed)
        setError(null)

        // Subscribe to new inserts for this user AND device
        channel = supabase
          .channel(`session_logs_updates_${userId}_${deviceId}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'session_logs', filter: `user_id=eq.${userId}` },
            (payload) => {
              if (!mounted) return
              // Only process events for this device
              if (payload.new.device_id === deviceId) {
                const newLog: LogEntryView = normalizeLogRow(payload.new as Record<string, unknown>)
                setLogs((prev) => [newLog, ...prev].slice(0, 100))
              }
            },
          )
          .subscribe()
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setLogs([])
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchLogs()

    return () => {
      mounted = false
      if (channel) {
        channel.unsubscribe()
      }
    }
  }, [userId, deviceId])

  return { logs, loading, error }
}
