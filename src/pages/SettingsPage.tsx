import { Bell, Lightbulb, Moon, Sun, Tag, User } from 'lucide-react'
import { useState } from 'react'
import type { UiSettings } from '../types'
import { NeoCard } from '../components/ui/NeoCard'
import { NeoButton } from '../components/ui/NeoButton'
import { NeoInput } from '../components/ui/NeoInput'

interface SettingsPageProps {
  settings: UiSettings
  onUpdate: (next: UiSettings) => void
  onSaveDisplayName: (name: string) => void
  onClaimDevice: (claimCode: string) => void
  deviceId: string
  isClaiming: boolean
}

export function SettingsPage({ settings, onUpdate, onSaveDisplayName, onClaimDevice, deviceId, isClaiming }: SettingsPageProps) {
  const [claimCode, setClaimCode] = useState('')
  const [displayNameDraft, setDisplayNameDraft] = useState(settings.userName)
  const hasLinkedDevice = Boolean(deviceId)

  const handleClaim = () => {
    onClaimDevice(claimCode)
  }

  return (
    <main className='mx-auto w-full max-w-7xl px-4 py-8 sm:py-12'>
      <section className='grid grid-cols-1 gap-8 lg:grid-cols-2'>
        <NeoCard className='bg-neo-canvas' title='Notification Settings' accent='white'>
          <div className='space-y-4'>
            <p className='font-bold'>In-app notifications are enabled for website alerts.</p>
            <NeoButton
              variant={settings.notificationsEnabled ? 'primary' : 'outline'}
              onClick={() => onUpdate({ ...settings, notificationsEnabled: !settings.notificationsEnabled })}
              icon={<Bell className='h-4 w-4 stroke-[3px]' />}
            >
              {settings.notificationsEnabled ? 'Disable Alerts' : 'Enable Alerts'}
            </NeoButton>

            <p className='font-bold'>Theme mode for dashboard readability.</p>
            <NeoButton
              variant={settings.darkMode ? 'outline' : 'secondary'}
              onClick={() => onUpdate({ ...settings, darkMode: !settings.darkMode })}
              icon={settings.darkMode ? <Moon className='h-4 w-4 stroke-[3px]' /> : <Sun className='h-4 w-4 stroke-[3px]' />}
            >
              {settings.darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            </NeoButton>
          </div>
        </NeoCard>

        <NeoCard className='bg-neo-canvas' title='Personal Comfort Profile' accent='white'>
          <div className='space-y-4'>
            <div className='flex flex-wrap items-center gap-3'>
              <div className='min-w-[220px] flex-1'>
                <NeoInput
                  value={displayNameDraft}
                  onChange={(event) => setDisplayNameDraft(event.target.value)}
                  placeholder='Your display name'
                  aria-label='User name'
                />
              </div>
              <NeoButton
                variant='outline'
                onClick={() => {
                  onUpdate({ ...settings, userName: displayNameDraft })
                  onSaveDisplayName(displayNameDraft)
                }}
                className='h-14 px-4 text-xs'
              >
                Confirm Name
              </NeoButton>
            </div>

            <p className='font-bold'>Select what turns on automatically when presence is detected.</p>
            <div className='flex flex-wrap items-center gap-3'>
              <NeoButton
                variant={settings.autoLights ? 'secondary' : 'outline'}
                onClick={() => onUpdate({ ...settings, autoLights: !settings.autoLights })}
                icon={<Lightbulb className='h-4 w-4 stroke-[3px]' />}
              >
                {settings.autoLights ? 'Auto Lights: On' : 'Auto Lights: Off'}
              </NeoButton>

              <p className='inline-flex items-center gap-2 border-4 border-neo-ink bg-neo-canvas px-3 py-2 text-[0.7rem] font-black uppercase tracking-[0.24em] shadow-neo-sm'>
                <User className='h-4 w-4 stroke-[3px]' />
                Single-user mode active
              </p>
            </div>
          </div>
        </NeoCard>

        <NeoCard className='bg-neo-canvas' title='Device Ownership' accent='white'>
          <div className={`space-y-4 ${hasLinkedDevice ? 'opacity-60' : ''}`}>
            <p className='font-bold'>Claim a device using the code on its label.</p>
            <NeoInput
              value={claimCode}
              onChange={(event) => setClaimCode(event.target.value)}
              placeholder='Enter claim code'
              aria-label='Device claim code'
              disabled={hasLinkedDevice}
            />
            <NeoButton
              variant='secondary'
              onClick={handleClaim}
              disabled={isClaiming || hasLinkedDevice}
              icon={<Tag className='h-4 w-4 stroke-[3px]' />}
            >
              {isClaiming ? 'Linking...' : 'Link Device'}
            </NeoButton>
            <div className='border-4 border-black bg-neo-canvas p-3 text-xs font-black uppercase tracking-[0.2em] shadow-neo-sm'>
              Linked device {deviceId || 'None'}
            </div>
            {hasLinkedDevice ? <p className='text-xs font-bold'>Device already linked. Unlink in admin to claim another.</p> : null}
          </div>
        </NeoCard>
      </section>
    </main>
  )
}
