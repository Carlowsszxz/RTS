import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { createHourlyStartDistribution, learnSchedulePattern } from '../data/learning'
import type { LogEntryView } from '../types'
import { NeoCard } from '../components/ui/NeoCard'

interface PatternPageProps {
  logs: LogEntryView[]
}

export function PatternPage({ logs }: PatternPageProps) {
  const patterns = useMemo(() => learnSchedulePattern(logs), [logs])
  const distribution = useMemo(() => createHourlyStartDistribution(logs), [logs])
  const nonZeroDistribution = useMemo(() => distribution.filter((item) => item.total > 0), [distribution])
  const maxCount = Math.max(1, ...distribution.map((item) => item.total))
  const totalSamples = useMemo(() => distribution.reduce((sum, item) => sum + item.total, 0), [distribution])
  const peakBucket = useMemo(
    () =>
      nonZeroDistribution.length > 0
        ? nonZeroDistribution.reduce((best, item) => (item.total > best.total ? item : best), nonZeroDistribution[0])
        : null,
    [nonZeroDistribution]
  )
  const topBuckets = useMemo(
    () => [...nonZeroDistribution].sort((a, b) => b.total - a.total).slice(0, 4),
    [nonZeroDistribution]
  )

  return (
    <main className='mx-auto w-full max-w-7xl px-4 py-8 sm:py-12'>
      <section className='grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.1fr]'>
        <NeoCard className='bg-neo-canvas' title='Learned Personal Routine' accent='white'>
          <div className='space-y-2'>
            {patterns.length === 0 ? (
              <p className='font-bold'>No patterns learned yet.</p>
            ) : null}
            <PatternList patterns={patterns} totalSamples={totalSamples} />
          </div>
        </NeoCard>

        <NeoCard className='bg-neo-canvas' title='Typical Arrival Graph' accent='white'>
          <div className='space-y-6'>
            <p className='font-bold'>Distribution of your usual arrival times learned from access logs.</p>

            <div className='flex flex-wrap gap-3'>
              <div className='border-2 border-black bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.2em] shadow-neo-sm'>
                Peak arrival {peakBucket ? `${String(peakBucket.hour).padStart(2, '0')}:00` : '--:--'}
              </div>
              <div className='border-2 border-black bg-neo-secondary px-4 py-2 text-xs font-black uppercase tracking-[0.2em] shadow-neo-sm'>
                Total samples {totalSamples}
              </div>
              <div className='border-2 border-black bg-neo-muted px-4 py-2 text-xs font-black uppercase tracking-[0.2em] shadow-neo-sm'>
                Spread {nonZeroDistribution.length} hours
              </div>
            </div>

            {nonZeroDistribution.length === 0 ? (
              <div className='border-4 border-black bg-white p-6 text-sm font-bold shadow-neo-sm'>
                Not enough data yet. Log a few arrivals to see your pattern.
              </div>
            ) : (
              <div className='relative overflow-hidden border-4 border-black bg-neo-canvas p-3 shadow-neo-sm'>
                <div className='absolute inset-0 opacity-20 neo-grid-pattern' />
                <div className='relative flex items-start justify-between text-[10px] font-black uppercase tracking-[0.3em] text-neo-ink'>
                  <span>Low</span>
                  <span>High</span>
                </div>
                <div
                  className='relative mt-2 grid h-48 items-end gap-2'
                  style={{ gridTemplateColumns: `repeat(${nonZeroDistribution.length}, minmax(0, 1fr))` }}
                >
                  {nonZeroDistribution.map((bucket) => {
                    const height = (bucket.total / maxCount) * 100
                    const isPeak = peakBucket ? bucket.hour === peakBucket.hour : false
                    return (
                      <div key={bucket.hour} className='flex h-full flex-col items-center justify-end'>
                        <div
                          className={
                            `w-full rounded-t-lg border-2 border-black bg-white transition-all ${
                              isPeak ? 'bg-neo-secondary' : ''
                            }`
                          }
                          style={{ height: `${Math.max(6, height)}%` }}
                          aria-label={`${bucket.hour}:00 has ${bucket.total} arrivals`}
                        />
                        <span className='mt-2 text-[10px] font-black'>{String(bucket.hour).padStart(2, '0')}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
              {topBuckets.map((bucket, index) => (
                <div key={bucket.hour} className='border-2 border-black bg-white p-3 shadow-neo-sm'>
                  <p className='text-xs font-black uppercase tracking-[0.2em]'>Rank {index + 1}</p>
                  <p className='text-lg font-black'>{String(bucket.hour).padStart(2, '0')}:00</p>
                  <p className='text-xs font-bold'>{bucket.total} arrivals</p>
                </div>
              ))}
            </div>
          </div>
        </NeoCard>
      </section>
    </main>
  )
}

function PatternList({ patterns, totalSamples }: { patterns: Array<{ day: string; averageStart: string; averageEnd: string; confidence: number }> ; totalSamples: number }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className='space-y-2'>
      <div className='text-xs text-gray-600 font-bold mb-2'>Total samples: {totalSamples}</div>
      {patterns.map((p) => {
        const isOpen = expanded === p.day
        return (
          <div key={p.day} className='border-2 border-black bg-white p-3'>
            <div className='flex items-center justify-between gap-3'>
              <div>
                <div className='text-xs font-black uppercase tracking-[0.2em]'>{p.day}</div>
                <div className='text-lg font-black'>
                  {p.averageStart} — {p.averageEnd}
                </div>
              </div>
              <div className='flex items-center gap-3'>
                <div className='w-36'>
                  <div className='w-full rounded bg-gray-200 h-3 overflow-hidden' aria-hidden>
                    <div className='h-3 bg-green-500' style={{ width: `${p.confidence}%` }} />
                  </div>
                  <div className='text-xs font-bold text-right mt-1'>{p.confidence}%</div>
                </div>
                <button
                  type='button'
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : p.day)}
                  className='p-2 border-2 border-black bg-neo-canvas'
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>
            {isOpen && (
              <div className='mt-3 rotate-[-1deg] border-4 border-black bg-neo-canvas p-3 shadow-neo-sm'>
                <p className='text-xs font-black uppercase tracking-[0.2em]'>{p.day}</p>
                <p className='text-xl font-black'>
                  {p.averageStart} → {p.averageEnd}
                </p>
                <p className='text-sm font-bold'>Comfort confidence {p.confidence}%</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
