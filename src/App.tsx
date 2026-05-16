import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { initialDevices, initialSettings, initialStatus } from './data/mockData'
import { learnSchedulePattern } from './data/learning'
import { useSupabaseLogs } from './hooks/useSupabaseLogs'
import { useSupabaseSensorEvents } from './hooks/useSupabaseSensorEvents'
import { useSupabaseOverrides } from './hooks/useSupabaseOverrides'
import { useSupabasePresenceEvents } from './hooks/useSupabasePresenceEvents'
import { supabase } from './lib/supabase'
import type {
  AppSettings,
  DeviceOverrideState,
  DeviceState,
  InAppNotification,
  LogEntryView,
  UiSettings,
  WorkstationStatus,
} from './types'
import { TopNav } from './components/layout/TopNav'
import { NotificationCenter } from './components/ui/NotificationCenter'
import { DashboardPage } from './pages/DashboardPage'
import { LogsPage } from './pages/LogsPage'
import { PatternPage } from './pages/PatternPage'
import { AdminPage } from './pages/AdminPage'
import { SettingsPage } from './pages/SettingsPage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.tsx'
import { LandingPage } from './pages/LandingPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage.tsx'
import type { Session } from '@supabase/supabase-js'

function App() {
  const location = useLocation()
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const defaultDeviceId = '550e8400-e29b-41d4-a716-446655440000'
  const settingsHydratedRef = useRef(false)
  const [profileName, setProfileName] = useState('')
  const [profileEmail, setProfileEmail] = useState('')

  const [settings, setSettings] = useState<UiSettings>(() => {
    const stored = window.localStorage.getItem('rts-settings')
    if (!stored) {
      return initialSettings
    }

    try {
      const parsed = JSON.parse(stored) as Partial<UiSettings>
      const normalized = { ...initialSettings, ...parsed }
      if (normalized.userName === 'Primary User') {
        normalized.userName = ''
      }
      return normalized
    } catch {
      return initialSettings
    }
  })
  const deviceId = settings.deviceId || defaultDeviceId

  const mapDbToUiSettings = (row: AppSettings, current: UiSettings): UiSettings => ({
    ...current,
    notificationsEnabled: row.notifications_enabled ?? current.notificationsEnabled,
    darkMode: row.dark_mode ?? current.darkMode,
    userName: row.display_name ?? current.userName,
    autoLights: row.auto_lights ?? current.autoLights,
    autoPc: row.auto_pc ?? current.autoPc,
    autoFan: row.auto_fan ?? current.autoFan,
  })

  const mapUiToDbSettings = (next: UiSettings, userId: string): AppSettings => ({
    user_id: userId,
    notifications_enabled: next.notificationsEnabled,
    dark_mode: next.darkMode,
    display_name: next.userName,
    auto_lights: next.autoLights,
    auto_pc: next.autoPc,
    auto_fan: next.autoFan,
    updated_at: new Date().toISOString(),
  })

  // Get logs from Supabase with fallback to empty array
  const currentUserId = session?.user?.id ?? null
  const { logs: supabaseLogs } = useSupabaseLogs(currentUserId, deviceId)
  const { events: sensorEvents, refresh: refreshSensorEvents } = useSupabaseSensorEvents(deviceId)
  const {
    events: presenceEvents,
    loading: presenceLoading,
    error: presenceError,
  } = useSupabasePresenceEvents(deviceId)
  const [logs, setLogs] = useState<LogEntryView[]>([])

  // Refresh sensor events on demand (for manual refresh button)
  const handleRefreshSensorEvents = useCallback(() => {
    refreshSensorEvents()
  }, [refreshSensorEvents])

  // Sync Supabase logs into state
  useEffect(() => {
    setLogs(supabaseLogs)
  }, [supabaseLogs])

  const [status, setStatus] = useState<WorkstationStatus>(initialStatus)
  const [devices, setDevices] = useState<DeviceState>(initialDevices)
  const devicesRef = useRef<DeviceState>(initialDevices)
  const lastSsrRef = useRef<boolean | null>(null)
  const [overrides, setOverrides] = useState<DeviceOverrideState>(() => {
    const fallback: DeviceOverrideState = { lights: null, pc: null, fan: null }
    const stored = window.localStorage.getItem('rts-overrides')
    if (!stored) return fallback
    try {
      const parsed = JSON.parse(stored) as Partial<DeviceOverrideState>
      return {
        lights: typeof parsed.lights === 'boolean' ? parsed.lights : null,
        pc: typeof parsed.pc === 'boolean' ? parsed.pc : null,
        fan: typeof parsed.fan === 'boolean' ? parsed.fan : null,
      }
    } catch {
      return fallback
    }
  })

  // Sync overrides to Supabase
  useSupabaseOverrides(overrides, setOverrides, deviceId)
  const fallbackName = profileName || profileEmail || session?.user?.email || 'Operator'
  const displayName = settings.userName || fallbackName
  const [isAdmin, setIsAdmin] = useState(false)
  const [notifications, setNotifications] = useState<InAppNotification[]>([])
  const [claimingDevice, setClaimingDevice] = useState(false)
  const isAuthenticated = Boolean(session)

  // Persist admin toggle per-user so it survives refresh
  useEffect(() => {
    try {
      const key = currentUserId ? `rts-admin-${currentUserId}` : 'rts-admin-guest'
      const stored = window.localStorage.getItem(key)
      if (stored !== null) {
        setIsAdmin(stored === 'true')
      }
    } catch {
      // ignore
    }
  }, [currentUserId])

  const handleToggleAdmin = () => {
    setIsAdmin((current) => {
      const next = !current
      try {
        const key = currentUserId ? `rts-admin-${currentUserId}` : 'rts-admin-guest'
        window.localStorage.setItem(key, String(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  const patterns = useMemo(() => learnSchedulePattern(logs), [logs])
  const isAuthRoute =
    location.pathname === '/login' ||
    location.pathname === '/signup' ||
    location.pathname === '/forgot-password' ||
    location.pathname === '/reset-password'
  const isLandingRoute = location.pathname === '/'
  const showGlobalGridPattern = !isAuthRoute && !isLandingRoute

  useEffect(() => {
    const initAuth = async () => {
      const { data } = await supabase.auth.getSession()
      setSession(data.session)
      setAuthReady(true)
    }

    initAuth()

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  const dismissNotification = (id: string) => {
    setNotifications((current) => current.filter((item) => item.id !== id))
  }

  const authFallback = (
    <div className='flex min-h-screen items-center justify-center text-sm font-black uppercase tracking-[0.2em] text-neo-ink/70'>
      Loading session...
    </div>
  )

  const notify = (message: string, variant: InAppNotification['variant'] = 'info') => {
    if (!settings.notificationsEnabled) {
      return
    }

    const next: InAppNotification = {
      id: crypto.randomUUID(),
      message,
      variant,
    }

    setNotifications((current) => [next, ...current].slice(0, 4))
  }

  useEffect(() => {
    if (notifications.length === 0) {
      return
    }

    const timeout = window.setTimeout(() => {
      setNotifications((current) => current.slice(0, -1))
    }, 4500)

    return () => window.clearTimeout(timeout)
  }, [notifications])

  useEffect(() => {
    window.localStorage.setItem('rts-settings', JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    settingsHydratedRef.current = false

    const loadUserSettings = async () => {
      if (!currentUserId) {
        return
      }

      const { data, error } = await supabase
        .from('user_settings')
        .select('user_id, notifications_enabled, dark_mode, display_name, auto_lights, auto_pc, auto_fan, updated_at')
        .eq('user_id', currentUserId)
        .maybeSingle()

      if (!error && data) {
        setSettings((current) => mapDbToUiSettings(data as AppSettings, current))
      }

      settingsHydratedRef.current = true
    }

    void loadUserSettings()
  }, [currentUserId])

  useEffect(() => {
    if (!currentUserId) {
      setProfileName('')
      setProfileEmail('')
      return
    }

    const loadProfile = async () => {
      const { data, error } = await supabase
        .from('users')
        .select('full_name, email')
        .eq('id', currentUserId)
        .maybeSingle()

      if (!error && data) {
        setProfileName(data.full_name ?? '')
        setProfileEmail(data.email ?? '')
        return
      }

      setProfileName('')
      setProfileEmail(session?.user?.email ?? '')
    }

    void loadProfile()
  }, [currentUserId, session?.user?.email])

  useEffect(() => {
    if (!currentUserId || !settingsHydratedRef.current) {
      return
    }

    const persistSettings = async () => {
      const payload = mapUiToDbSettings(settings, currentUserId)
      const { error } = await supabase
        .from('user_settings')
        .upsert(payload, { onConflict: 'user_id' })

      if (error) {
        console.warn('Failed to save user_settings:', error.message)
      }
    }

    void persistSettings()
  }, [currentUserId, settings])

  useEffect(() => {
    window.localStorage.setItem('rts-overrides', JSON.stringify(overrides))
  }, [overrides])

  useEffect(() => {
    devicesRef.current = devices
  }, [devices])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.darkMode)
  }, [settings.darkMode])

  useEffect(() => {
    if (sensorEvents.length === 0) {
      return
    }

    const latest = sensorEvents[0]
    setStatus(latest.motion ? 'ready' : 'closed')
    setDevices((current) => ({
      ...current,
      lights: latest.ssr,
    }))

    const previousSsr = lastSsrRef.current
    lastSsrRef.current = latest.ssr

    const shouldStartSession = latest.motion || (!previousSsr && latest.ssr)
    if (shouldStartSession) {
      const snapshot: DeviceState = {
        ...devicesRef.current,
        lights: latest.ssr,
      }
      void ensureSessionForSsrOn(snapshot)
    }
  }, [sensorEvents])

  const ensureSessionForSsrOn = async (devicesSnapshot: DeviceState) => {
    if (!currentUserId) {
      return
    }

    if (!deviceId) {
      return
    }

    const { data, error } = await supabase
      .from('session_logs')
      .select('id')
      .is('time_out', null)
      .eq('user_id', currentUserId)
      .eq('device_id', deviceId)
      .order('time_in', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!error && data?.id) {
      return
    }

    const { error: logError } = await postSessionStart(devicesSnapshot)
    if (logError) {
      notify(`Session log failed: ${logError.message}`, 'warning')
    }
  }

  const setOverride = (key: keyof DeviceState, value: boolean | null) => {
    setOverrides((cur) => {
      const next =
        key === 'lights'
          ? { lights: value, pc: null, fan: null }
          : { ...cur, [key]: value }
      const nextLabel = value === null ? 'CLEARED' : value ? 'ON' : 'OFF'
      notify(`${key.toUpperCase()} override ${nextLabel}`, 'info')
      return next
    })
  }

  const postSessionStart = async (devicesSnapshot: DeviceState) => {
    if (!deviceId) {
      return { error: new Error('No device linked') }
    }

    const now = new Date().toISOString()

    return supabase
      .from('session_logs')
      .insert({
        user_id: currentUserId,
        device_id: deviceId,
        time_in: now,
        time_out: null,
        source: 'machine-learning',
        trigger: 'presence-detected',
        devices: devicesSnapshot,
      })
  }

  const handleConfirmPresence = async () => {
    if (!deviceId) {
      notify('No device linked for presence confirmation.', 'warning')
      return
    }

    const { error } = await supabase
      .from('presence_acks')
      .insert({ device_id: deviceId })

    if (error) {
      notify(`Presence confirm failed: ${error.message}`, 'warning')
      return
    }

    notify('Presence confirmed.', 'success')
  }

  const handleUpdateSettings = (next: UiSettings) => {
    setSettings(next)
    notify('Settings updated', 'warning')
  }

  const handleSaveDisplayName = async (name: string) => {
    if (!currentUserId) {
      notify('Sign in to update your display name.', 'warning')
      return
    }

    const trimmed = name.trim()
    if (!trimmed) {
      notify('Display name cannot be empty.', 'warning')
      return
    }

    const { error } = await supabase
      .from('users')
      .update({ full_name: trimmed })
      .eq('id', currentUserId)

    if (error) {
      notify(`Display name update failed: ${error.message}`, 'warning')
      return
    }

    setProfileName(trimmed)
    notify('Display name updated.', 'success')
  }

  const handleClaimDevice = async (claimCode: string) => {
    if (!currentUserId) {
      notify('Sign in to claim the device.', 'warning')
      return
    }

    if (!claimCode.trim()) {
      notify('Enter the device claim code.', 'warning')
      return
    }

    setClaimingDevice(true)
    const { data, error } = await supabase.rpc('claim_device_by_code', {
      p_claim_code: claimCode.trim(),
    })

    setClaimingDevice(false)

    if (error) {
      notify(`Device claim failed: ${error.message}`, 'warning')
      return
    }

    const claimedId = Array.isArray(data) ? data[0]?.id : data?.id
    if (!claimedId) {
      notify('Device claim failed: no device returned.', 'warning')
      return
    }

    setSettings((current) => ({ ...current, deviceId: claimedId }))

    notify('Device linked to your account.', 'success')
  }

  const handleLogout = () => {
    try {
      if (currentUserId) {
        window.localStorage.removeItem(`rts-admin-${currentUserId}`)
      }
    } catch {
      // ignore
    }
    setIsAdmin(false)
    supabase.auth.signOut()
    notify('Signed out', 'info')
  }

  return (
    <div className='min-h-screen bg-neo-canvas font-sans text-neo-ink'>
      <div className={showGlobalGridPattern ? 'neo-grid-pattern min-h-screen' : 'min-h-screen'}>
        {!isAuthRoute ? (
          <TopNav
            isAdmin={isAdmin}
            userName={settings.userName}
            onToggleAdmin={handleToggleAdmin}
            onLogout={handleLogout}
          />
        ) : null}
        {!isAuthRoute ? <NotificationCenter notifications={notifications} onDismiss={dismissNotification} /> : null}

        <Routes>
          <Route
            path='/login'
            element={authReady && isAuthenticated ? <Navigate to='/dashboard' replace /> : <LoginPage />}
          />
          <Route
            path='/signup'
            element={authReady && isAuthenticated ? <Navigate to='/dashboard' replace /> : <SignupPage />}
          />
          <Route
            path='/forgot-password'
            element={authReady && isAuthenticated ? <Navigate to='/dashboard' replace /> : <ForgotPasswordPage />}
          />
          <Route path='/reset-password' element={<ResetPasswordPage />} />
          <Route path='/' element={<LandingPage isAuthenticated={isAuthenticated} />} />
          <Route
            path='/dashboard'
            element={
              !authReady ? (
                authFallback
              ) : isAuthenticated ? (
                <DashboardPage
                  status={status}
                  devices={devices}
                  logs={logs}
                  patterns={patterns}
                  sensorEvents={sensorEvents}
                  presenceEvents={presenceEvents}
                  presenceLoading={presenceLoading}
                  presenceError={presenceError}
                  userName={displayName}
                  settings={settings}
                  onConfirmPresence={handleConfirmPresence}
                  onRefresh={handleRefreshSensorEvents}
                />
              ) : (
                <Navigate to='/login' replace />
              )
            }
          />
          <Route
            path='/logs'
            element={!authReady ? authFallback : isAuthenticated ? <LogsPage logs={logs} /> : <Navigate to='/login' replace />}
          />
          <Route
            path='/pattern'
            element={!authReady ? authFallback : isAuthenticated ? <PatternPage logs={logs} /> : <Navigate to='/login' replace />}
          />
          <Route
            path='/admin'
            element={
              !authReady ? (
                authFallback
              ) : isAuthenticated ? (
                <AdminPage
                  isAdmin={isAdmin}
                  overrides={overrides}
                  deviceId={deviceId}
                  onSetOverride={setOverride}
                  onRefresh={handleRefreshSensorEvents}
                />
              ) : (
                <Navigate to='/login' replace />
              )
            }
          />
          <Route
            path='/settings'
            element={
              !authReady ? (
                authFallback
              ) : isAuthenticated ? (
                <SettingsPage
                  settings={settings}
                  onUpdate={handleUpdateSettings}
                  onSaveDisplayName={handleSaveDisplayName}
                  onClaimDevice={handleClaimDevice}
                  deviceId={deviceId}
                  isClaiming={claimingDevice}
                />
              ) : (
                <Navigate to='/login' replace />
              )
            }
          />
          <Route path='*' element={<Navigate to='/' replace />} />
        </Routes>
      </div>
    </div>
  )
}

export default App
