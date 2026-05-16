import { Star } from 'lucide-react'
import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { navItems } from '../../data/mockData'
import StaggeredMenu from '../StaggeredMenu'

interface TopNavProps {
  isAdmin: boolean
  userName: string
  onToggleAdmin: () => void
  onLogout: () => void
}

export function TopNav({ isAdmin, userName, onToggleAdmin, onLogout }: TopNavProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const isLandingRoute = location.pathname === '/'

  const landingMenuItems = useMemo(
    () => [
      {
        label: 'Login',
        link: '/login',
        ariaLabel: 'Go to login',
        onClick: () => navigate('/login'),
      },
      {
        label: 'Sign Up',
        link: '/signup',
        ariaLabel: 'Go to sign up',
        onClick: () => navigate('/signup'),
      },
    ],
    [navigate],
  )

  const appMenuItems = useMemo(
    () => [
      ...navItems.map((item) => ({
        label: item.label,
        link: item.to,
        ariaLabel: `Go to ${item.label}`,
        onClick: () => navigate(item.to),
      })),
      {
        label: isAdmin ? 'Admin On' : 'Admin Off',
        link: '/admin',
        ariaLabel: 'Toggle admin mode',
        onClick: () => onToggleAdmin(),
      },
      {
        label: 'Logout',
        link: '/login',
        ariaLabel: 'Logout',
        onClick: () => onLogout(),
      },
    ],
    [isAdmin, navigate, onLogout, onToggleAdmin],
  )

  const menuItems = useMemo(
    () => (isLandingRoute ? landingMenuItems : appMenuItems),
    [appMenuItems, isLandingRoute, landingMenuItems],
  )

  return (
    <header className='neo-header-sweep sticky top-0 z-20 border-b-4 border-neo-ink text-neo-ink'>
      <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex flex-wrap items-center gap-3'>
          <div className='flex items-center gap-3 border-4 border-neo-ink bg-neo-accent px-3 py-2 font-black uppercase tracking-[0.15em] shadow-neo-sm'>
            <Star className='h-5 w-5 stroke-[3px]' />
            <span className='text-xs sm:text-sm'>Behavioral Schedule Learning</span>
          </div>
          {userName ? (
            <span className='inline-flex items-center border-4 border-neo-ink bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.2em] shadow-neo-sm'>
              {userName}
            </span>
          ) : null}
        </div>

        <div className='flex items-center justify-between gap-3'>
          <div className='hidden items-center gap-2 text-xs font-black uppercase tracking-[0.35em] text-neo-ink/70 sm:flex'>
            {isLandingRoute ? 'Welcome' : 'Operator Console'}
          </div>
          <div className='rts-nav-menu h-12 w-[170px]'>
            <StaggeredMenu
              position='right'
              items={menuItems}
              socialItems={[]}
              displaySocials={false}
              displayItemNumbering={true}
              colors={['rgb(var(--neo-muted))', 'rgb(var(--neo-accent))']}
              menuButtonColor='rgb(var(--neo-ink))'
              openMenuButtonColor='rgb(var(--neo-ink))'
              changeMenuColorOnOpen={true}
              logoUrl='/favicon.svg'
              accentColor='rgb(var(--neo-accent))'
              className='rts-nav-menu'
            />
          </div>
        </div>
      </div>
    </header>
  )
}
