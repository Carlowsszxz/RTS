import { LogIn } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NeoButton } from '../components/ui/NeoButton'
import { NeoCard } from '../components/ui/NeoCard'
import { NeoInput } from '../components/ui/NeoInput'
import DotGrid from '../components/DotGrid'
import { supabase } from '../lib/supabase'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setLoading(true)

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (signInError) {
      setError(signInError.message)
      return
    }

    const user = signInData.user
    if (user) {
      const { error: upsertError } = await supabase.from('users').upsert(
        {
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name ?? null,
          last_seen: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )

      if (upsertError) {
        setError('Signed in, but user profile sync failed. Check RLS policies.')
        return
      }
    }

    navigate('/dashboard', { replace: true })
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
        <NeoCard className='bg-neo-canvas' title='Login' accent='white'>
          <form className='space-y-5' onSubmit={handleSubmit}>
            <p className='font-bold'>Sign in to access your Behavioral Schedule Learning dashboard controls.</p>

            <div className='space-y-3'>
              <label className='block text-xs font-black uppercase tracking-[0.2em]' htmlFor='login-email'>
                Email
              </label>
              <NeoInput
                id='login-email'
                type='email'
                placeholder='you@workspace.com'
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            <div className='space-y-3'>
              <label className='block text-xs font-black uppercase tracking-[0.2em]' htmlFor='login-password'>
                Password
              </label>
              <NeoInput
                id='login-password'
                type='password'
                placeholder='••••••••'
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>

            {error ? <p className='text-sm font-black text-red-700'>{error}</p> : null}

            <NeoButton type='submit' icon={<LogIn className='h-4 w-4 stroke-[3px]' />} fullWidth disabled={loading}>
              {loading ? 'Signing In...' : 'Sign In'}
            </NeoButton>

            <p className='text-sm font-bold'>
              Need an account?{' '}
              <Link className='underline decoration-4 underline-offset-4' to='/signup'>
                Create one
              </Link>
            </p>

            <p className='text-sm font-bold'>
              <Link className='underline decoration-4 underline-offset-4' to='/forgot-password'>
                Forgot password?
              </Link>
            </p>
          </form>
        </NeoCard>
      </section>
    </main>
  )
}
