import { useEffect } from 'react'
import type { DeviceOverrideState, DeviceState } from '../types'
import { supabase } from '../lib/supabase'

function normalizeOverrides(value: unknown): DeviceOverrideState {
  const fallback: DeviceOverrideState = { lights: null, pc: null, fan: null }

  if (!value) return fallback

  if (typeof value === 'string') {
    try {
      return normalizeOverrides(JSON.parse(value))
    } catch {
      return fallback
    }
  }

  if (typeof value === 'object') {
    const obj = value as Partial<Record<keyof DeviceState, boolean | null>>
    return {
      lights: typeof obj.lights === 'boolean' ? obj.lights : null,
      pc: typeof obj.pc === 'boolean' ? obj.pc : null,
      fan: typeof obj.fan === 'boolean' ? obj.fan : null,
    }
  }

  return fallback
}

/**
 * Persist device overrides to Supabase and sync them across tabs/devices.
 * Falls back gracefully if Supabase is unavailable.
 */
export function useSupabaseOverrides(
  overrides: DeviceOverrideState,
  onUpdate: (overrides: DeviceOverrideState) => void,
  deviceId?: string | null,
) {
  const normalizedDeviceId = deviceId?.trim() || null

  // Sync overrides to Supabase
  useEffect(() => {
    const syncOverridesToSupabase = async () => {
      try {
        if (!normalizedDeviceId) {
          return
        }
        // Insert or update device with overrides stored in override field
        const normalizedOverrides = normalizeOverrides(overrides)

        const { data, error } = await supabase
          .from('devices')
          .update({
            overrides: normalizedOverrides,
            metadata: { lastSync: new Date().toISOString() },
          })
          .eq('id', normalizedDeviceId)
          .select('id')

        if (error) {
          console.warn('Supabase overrides sync failed (falling back to localStorage):', error.message)
          return
        }

        if (!data || data.length === 0) {
          console.warn('Supabase overrides sync skipped: device not found or not claimed yet.')
        }
      } catch (err) {
        console.warn('Supabase connection issue, using localStorage:', err)
      }
    }

    syncOverridesToSupabase()
  }, [overrides, normalizedDeviceId])

  // Subscribe to overrides changes from other clients
  useEffect(() => {
    try {
      if (!normalizedDeviceId) {
        return
      }

      const channel = supabase
        .channel(`device_${normalizedDeviceId}_updates`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'devices',
            filter: `id=eq.${normalizedDeviceId}`,
          },
          (payload) => {
            if (payload.new.overrides) {
              onUpdate(normalizeOverrides(payload.new.overrides))
            }
          },
        )
        .subscribe()

      return () => {
        channel.unsubscribe()
      }
    } catch (err) {
      console.warn('Failed to subscribe to device overrides:', err)
    }
  }, [onUpdate, normalizedDeviceId])
}
