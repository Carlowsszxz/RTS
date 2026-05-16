import type { HourBucket, LearnedPattern, LogEntryView } from '../types'

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function toMinutes(isoTime: string) {
  const date = new Date(isoTime)
  return date.getHours() * 60 + date.getMinutes()
}

function toClock(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function learnSchedulePattern(logs: LogEntryView[]): LearnedPattern[] {
  const grouped = new Map<number, { starts: number[]; ends: number[] }>()

  for (const log of logs) {
    const dayIndex = new Date(log.timeIn).getDay()
    const existing = grouped.get(dayIndex) ?? { starts: [], ends: [] }
    existing.starts.push(toMinutes(log.timeIn))
    if (log.timeOut) {
      existing.ends.push(toMinutes(log.timeOut))
    }
    grouped.set(dayIndex, existing)
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayIndex, values]) => {
      const avgStart = Math.round(values.starts.reduce((a, b) => a + b, 0) / values.starts.length)
      const endPool = values.ends.length > 0 ? values.ends : values.starts
      const avgEnd = Math.round(endPool.reduce((a, b) => a + b, 0) / endPool.length)
      const confidence = Math.min(98, 72 + values.starts.length * 6)

      return {
        day: weekdays[dayIndex],
        averageStart: toClock(avgStart),
        averageEnd: toClock(avgEnd),
        confidence,
      }
    })
}

export function createHourlyStartDistribution(logs: LogEntryView[]): HourBucket[] {
  const counts = new Array<number>(24).fill(0)

  for (const log of logs) {
    const hour = new Date(log.timeIn).getHours()
    counts[hour] += 1
  }

  return counts.map((total, hour) => ({ hour, total }))
}
