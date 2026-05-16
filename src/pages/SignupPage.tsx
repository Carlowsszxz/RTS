import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { NeoButton } from '../components/ui/NeoButton'
import { NeoCard } from '../components/ui/NeoCard'
import { NeoInput } from '../components/ui/NeoInput'
import DotGrid from '../components/DotGrid'
import { supabase } from '../lib/supabase'

export function SignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const passwordsMatch = useMemo(
    () => confirmPassword.length === 0 || password === confirmPassword,
    [confirmPassword, password],
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!passwordsMatch) {
      return
    }

    setError(null)
    setLoading(true)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
        },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    })

    setLoading(false)

    if (signUpError) {
      setError(signUpError.message)
      return
    }

    if (data.session) {
      navigate('/dashboard', { replace: true })
      return
    }

    navigate('/login', { replace: true })
  }

  return (
    <main className='relative mx-auto flex min-h-screen w-full max-w-7xl items-center overflow-hidden px-4 py-8 sm:py-12'>
      <div className='pointer-events-none fixed inset-0 opacity-20'>
        <DotGrid
          dotSize={8}
          gap={18}
          baseColor='#e7ddc2'
          activeColor='#d5c7a3'
          proximity={120}
          speedTrigger={70}
          shockRadius={150}
          shockStrength={3.75}
          maxSpeed={3800}
          resistance={650}
          returnDuration={1.3}
        />
      </div>

      <section className='relative z-10 mx-auto w-full max-w-xl'>
        <NeoCard className='bg-neo-canvas' title='Sign Up' accent='white'>
          <form className='space-y-5' onSubmit={handleSubmit}>
            <p className='font-bold'>Create your RTS account to personalize automation controls.</p>

            <div className='space-y-3'>
              <label className='block text-xs font-black uppercase tracking-[0.2em]' htmlFor='signup-name'>
                Full Name
              </label>
              <NeoInput
                id='signup-name'
                type='text'
                placeholder='Primary User'
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>

            <div className='space-y-3'>
              <label className='block text-xs font-black uppercase tracking-[0.2em]' htmlFor='signup-email'>
                Email
              </label>
              <NeoInput
                id='signup-email'
                type='email'
                placeholder='you@workspace.com'
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            <div className='space-y-3'>
              <label className='block text-xs font-black uppercase tracking-[0.2em]' htmlFor='signup-password'>
                Password
              </label>
              <NeoInput
                id='signup-password'
                type='password'
                placeholder='Create password'
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>

            <div className='space-y-3'>
              <label className='block text-xs font-black uppercase tracking-[0.2em]' htmlFor='signup-confirm-password'>
                Confirm Password
              </label>
              <NeoInput
                id='signup-confirm-password'
                type='password'
                placeholder='Confirm password'
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
              {!passwordsMatch ? <p className='text-sm font-black text-red-700'>Passwords must match.</p> : null}
            </div>

            {error ? <p className='text-sm font-black text-red-700'>{error}</p> : null}

            <NeoButton type='submit' icon={<UserPlus className='h-4 w-4 stroke-[3px]' />} fullWidth disabled={loading}>
              {loading ? 'Creating Account...' : 'Create Account'}
            </NeoButton>

            <p className='text-sm font-bold'>
              Already have an account?{' '}
              <Link className='underline decoration-4 underline-offset-4' to='/login'>
                Sign in
              </Link>
            </p>
          </form>
        </NeoCard>
      </section>
    </main>
  )
}
