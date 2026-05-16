import { Mail } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import DotGrid from '../components/DotGrid'
import { NeoButton } from '../components/ui/NeoButton'
import { NeoCard } from '../components/ui/NeoCard'
import { NeoInput } from '../components/ui/NeoInput'
import { supabase } from '../lib/supabase'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setLoading(false)

    if (resetError) {
      setError(resetError.message)
      return
    }

    setMessage('Password reset email sent. Check your inbox and follow the recovery link.')
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
        <NeoCard className='bg-neo-canvas' title='Forgot Password' accent='white'>
          <form className='space-y-5' onSubmit={handleSubmit}>
            <p className='font-bold'>Enter your email and Supabase will send a reset link.</p>

            <div className='space-y-3'>
              <label className='block text-xs font-black uppercase tracking-[0.2em]' htmlFor='forgot-email'>
                Email
              </label>
              <NeoInput
                id='forgot-email'
                type='email'
                placeholder='you@workspace.com'
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            {error ? <p className='text-sm font-black text-red-700'>{error}</p> : null}
            {message ? <p className='text-sm font-black text-green-700'>{message}</p> : null}

            <NeoButton type='submit' icon={<Mail className='h-4 w-4 stroke-[3px]' />} fullWidth disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </NeoButton>

            <p className='text-sm font-bold'>
              <Link className='underline decoration-4 underline-offset-4' to='/login'>
                Back to login
              </Link>
            </p>
          </form>
        </NeoCard>
      </section>
    </main>
  )
}
