import { Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DotGrid from '../components/DotGrid'
import { NeoButton } from '../components/ui/NeoButton'
import { NeoCard } from '../components/ui/NeoCard'
import { NeoInput } from '../components/ui/NeoInput'
import { supabase } from '../lib/supabase'

export function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [hasSession, setHasSession] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession()
      setHasSession(Boolean(data.session))
    }

    checkSession()
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (password !== confirmPassword) {
      setError('Passwords must match.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setMessage('Password updated. Redirecting to login...')
    await supabase.auth.signOut()
    window.setTimeout(() => navigate('/login', { replace: true }), 1200)
  }

  return (
    <main className='relative mx-auto flex min-h-screen w-full max-w-7xl items-center overflow-hidden px-4 py-8 sm:py-12'>
      <div className='pointer-events-none fixed inset-0 opacity-20'>
        <DotGrid
          dotSize={8}
          gap={18}
          baseColor='#e7ddc2'
          activeColor='#d5c7a3'
          proximity={118}
          speedTrigger={70}
          shockRadius={145}
          shockStrength={3.5}
          maxSpeed={3600}
          resistance={640}
          returnDuration={1.25}
        />
      </div>

      <section className='relative z-10 mx-auto w-full max-w-xl'>
        <NeoCard className='bg-neo-canvas' title='Reset Password' accent='white'>
          {hasSession ? (
            <form className='space-y-5' onSubmit={handleSubmit}>
              <p className='font-bold'>Choose a new password for your account.</p>

              <div className='space-y-3'>
                <label className='block text-xs font-black uppercase tracking-[0.2em]' htmlFor='reset-password'>
                  New Password
                </label>
                <NeoInput
                  id='reset-password'
                  type='password'
                  placeholder='New password'
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>

              <div className='space-y-3'>
                <label className='block text-xs font-black uppercase tracking-[0.2em]' htmlFor='reset-confirm-password'>
                  Confirm New Password
                </label>
                <NeoInput
                  id='reset-confirm-password'
                  type='password'
                  placeholder='Confirm password'
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </div>

              {error ? <p className='text-sm font-black text-red-700'>{error}</p> : null}
              {message ? <p className='text-sm font-black text-green-700'>{message}</p> : null}

              <NeoButton type='submit' icon={<Lock className='h-4 w-4 stroke-[3px]' />} fullWidth disabled={loading}>
                {loading ? 'Updating...' : 'Update Password'}
              </NeoButton>
            </form>
          ) : (
            <div className='space-y-4'>
              <p className='font-bold'>No active recovery session found. Open this page from the reset email link.</p>
              <p className='text-sm font-bold'>
                <Link className='underline decoration-4 underline-offset-4' to='/forgot-password'>
                  Request another reset link
                </Link>
              </p>
            </div>
          )}
        </NeoCard>
      </section>
    </main>
  )
}
