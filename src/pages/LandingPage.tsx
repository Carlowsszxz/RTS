import { ArrowRight, Cpu, Sparkles, Timer } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { NeoButton } from '../components/ui/NeoButton'
import { NeoCard } from '../components/ui/NeoCard'
import DotGrid from '../components/DotGrid'

interface LandingPageProps {
  isAuthenticated: boolean
}

export function LandingPage({ isAuthenticated }: LandingPageProps) {
  const sectionRef = useRef<HTMLElement | null>(null)
  const primaryCardRef = useRef<HTMLDivElement | null>(null)
  const secondaryCardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      return
    }

    const section = sectionRef.current
    const primary = primaryCardRef.current
    const secondary = secondaryCardRef.current

    if (!section || !primary || !secondary) {
      return
    }

    const handleMove = (event: MouseEvent) => {
      const rect = section.getBoundingClientRect()
      const offsetX = (event.clientX - rect.left) / rect.width - 0.5
      const offsetY = (event.clientY - rect.top) / rect.height - 0.5

      primary.style.transform = `rotateX(${-offsetY * 3}deg) rotateY(${offsetX * 4}deg) translate3d(${offsetX * 7}px, ${offsetY * 6}px, 0)`
      secondary.style.transform = `rotateX(${offsetY * 2.5}deg) rotateY(${-offsetX * 3.5}deg) translate3d(${offsetX * -5}px, ${offsetY * -4}px, 0)`
    }

    const handleLeave = () => {
      primary.style.transform = 'rotateX(0deg) rotateY(0deg) translate3d(0, 0, 0)'
      secondary.style.transform = 'rotateX(0deg) rotateY(0deg) translate3d(0, 0, 0)'
    }

    section.addEventListener('mousemove', handleMove)
    section.addEventListener('mouseleave', handleLeave)

    return () => {
      section.removeEventListener('mousemove', handleMove)
      section.removeEventListener('mouseleave', handleLeave)
    }
  }, [])

  return (
    <main className='relative mx-auto w-full max-w-7xl overflow-hidden px-4 py-10 sm:py-14'>
      <div className='pointer-events-none fixed inset-0 opacity-20'>
        <DotGrid
          dotSize={9}
          gap={18}
          baseColor='#e7ddc2'
          activeColor='#d5c7a3'
          proximity={120}
          speedTrigger={70}
          shockRadius={150}
          shockStrength={3.5}
          maxSpeed={3800}
          resistance={650}
          returnDuration={1.25}
        />
      </div>

      <section
        ref={sectionRef}
        className='relative z-10 grid grid-cols-1 gap-8 lg:grid-cols-[1.15fr_0.85fr]'
        style={{ perspective: '1200px' }}
      >
        <div ref={primaryCardRef} className='transform-gpu transition-transform duration-200 ease-out will-change-transform'>
          <NeoCard className='rotate-[-1deg] bg-neo-canvas' title='Room Trigger System' accent='white'>
            <div className='space-y-5'>
              <p className='inline-flex rotate-1 border-4 border-black bg-neo-canvas px-3 py-1 text-xs font-black uppercase tracking-[0.2em]'>
                Smart Comfort Automation
              </p>
              <h1 className='text-4xl font-black uppercase tracking-tight sm:text-6xl'>
                Walk In, Room Ready.
              </h1>
              <p className='max-w-2xl text-lg font-bold sm:text-xl'>
                RTS detects presence, powers your comfort devices automatically, and tracks sessions with clear manual
                controls when needed.
              </p>

              <div className='flex flex-wrap gap-3 pt-2'>
                {isAuthenticated ? (
                  <Link to='/dashboard'>
                    <NeoButton icon={<ArrowRight className='h-4 w-4 stroke-[3px]' />}>Go to Dashboard</NeoButton>
                  </Link>
                ) : (
                  <>
                    <Link to='/login'>
                      <NeoButton icon={<ArrowRight className='h-4 w-4 stroke-[3px]' />}>Login</NeoButton>
                    </Link>
                    <Link to='/signup'>
                      <NeoButton variant='outline'>Create Account</NeoButton>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </NeoCard>
        </div>

        <div ref={secondaryCardRef} className='transform-gpu transition-transform duration-200 ease-out will-change-transform'>
          <NeoCard className='rotate-1 bg-neo-canvas' title='Why RTS' accent='white'>
            <div className='space-y-3 text-sm font-black uppercase tracking-wide sm:text-base'>
              <div className='flex items-center gap-2 border-4 border-black bg-neo-canvas p-3 shadow-neo-sm'>
                <Sparkles className='h-5 w-5 stroke-[3px]' />
                Presence-first automation
              </div>
              <div className='flex items-center gap-2 border-4 border-black bg-neo-canvas p-3 shadow-neo-sm'>
                <Cpu className='h-5 w-5 stroke-[3px]' />
                Pattern learning from access logs
              </div>
              <div className='flex items-center gap-2 border-4 border-black bg-neo-canvas p-3 shadow-neo-sm'>
                <Timer className='h-5 w-5 stroke-[3px]' />
                Real-time dashboard and manual override
              </div>
            </div>
          </NeoCard>
        </div>
      </section>
    </main>
  )
}
