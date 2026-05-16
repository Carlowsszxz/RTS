import type { LogEntryView } from '../types'
import { NeoCard } from '../components/ui/NeoCard'

interface LogsPageProps {
  logs: LogEntryView[]
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(start: string, end?: string | null) {
  const startMs = new Date(start).getTime()
  const endMs = end ? new Date(end).getTime() : Date.now()
  const delta = Math.max(0, endMs - startMs)
  const hrs = Math.floor(delta / 3600000)
  const mins = Math.floor((delta % 3600000) / 60000)
  if (hrs > 0) return `${hrs}h ${mins}m`
  return `${mins}m`
}

export function LogsPage({ logs }: LogsPageProps) {
  return (
    <main className='mx-auto w-full max-w-7xl px-4 py-8 sm:py-12'>
      <NeoCard className='bg-neo-canvas' title='Single User Access Logs' accent='white'>
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[700px] border-collapse text-left text-sm font-bold'>
            <thead>
              <tr className='border-b-4 border-black bg-neo-canvas'>
                <th className='px-3 py-2'>Trigger</th>
                <th className='px-3 py-2'>Time In</th>
                <th className='px-3 py-2'>Time Out</th>
                <th className='px-3 py-2'>Duration</th>
                <th className='px-3 py-2'>Lights</th>
                <th className='px-3 py-2'>PC</th>
                <th className='px-3 py-2'>Fan</th>
                <th className='px-3 py-2'>Source</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const inProgress = !log.timeOut
                const rowClass = `border-b-2 ${inProgress ? 'bg-yellow-50/60 border-yellow-400' : 'border-black'}`
                return (
                  <tr key={log.id} className={rowClass}>
                    <td className='px-3 py-2 uppercase'>{log.trigger.replace('-', ' ')}</td>
                    <td className='px-3 py-2'>
                      <time dateTime={log.timeIn} title={formatDateTime(log.timeIn)}>
                        {formatDateTime(log.timeIn)}
                      </time>
                    </td>
                    <td className='px-3 py-2'>
                      {inProgress ? (
                        <span title='Session still active'>In progress</span>
                      ) : (
                        <time dateTime={log.timeOut!} title={formatDateTime(log.timeOut!)}>
                          {formatDateTime(log.timeOut!)}
                        </time>
                      )}
                    </td>
                    <td className='px-3 py-2'>
                      {inProgress ? formatDuration(log.timeIn) : formatDuration(log.timeIn, log.timeOut)}
                    </td>
                    <td className='px-3 py-2'>{log.devices.lights ? 'On' : 'Off'}</td>
                    <td className='px-3 py-2'>{log.devices.pc ? 'On' : 'Off'}</td>
                    <td className='px-3 py-2'>{log.devices.fan ? 'On' : 'Off'}</td>
                    <td className='px-3 py-2'>
                      <span className='inline-flex rounded-full border-2 border-black bg-neo-canvas px-2 py-1 text-xs font-black uppercase tracking-wider' title={log.source}>
                        {log.source}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </NeoCard>
    </main>
  )
}
