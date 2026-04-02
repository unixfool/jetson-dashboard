import { Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Cpu, Zap, MemoryStick, HardDrive,
  Network, Thermometer, Activity, Container, FileText, Shield,
  Settings, Wifi, WifiOff, ChevronLeft, ChevronRight, ChevronDown,
  Server, LogOut, Bell, TrendingUp, Camera, Sun, Moon,
  CalendarClock, BatteryFull, Bot, BrainCircuit
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { useMetricsStore } from '../../store/metricsStore'
import { useAuthStore } from '../../store/authStore'
import { useThemeStore } from '../../store/themeStore'
import { AlertToastContainer } from '../alerts/AlertToast'
import clsx from 'clsx'

// ─── Nav groups ───────────────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { path: '/history',   icon: TrendingUp,      label: 'History'   },
      { path: '/alerts',    icon: Bell,            label: 'Alerts', alertBadge: true },
    ],
  },
  {
    id: 'hardware',
    label: 'Hardware',
    items: [
      { path: '/cpu',      icon: Cpu,         label: 'CPU'      },
      { path: '/gpu',      icon: Zap,         label: 'GPU'      },
      { path: '/memory',   icon: MemoryStick, label: 'Memory'   },
      { path: '/storage',  icon: HardDrive,   label: 'Storage'  },
      { path: '/network',  icon: Network,     label: 'Network'  },
      { path: '/thermals', icon: Thermometer, label: 'Thermals' },
      { path: '/battery',  icon: BatteryFull, label: 'Battery'  },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { path: '/processes', icon: Activity,      label: 'Processes' },
      { path: '/docker',    icon: Container,     label: 'Docker'    },
      { path: '/systemd',   icon: Server,        label: 'Systemd'   },
      { path: '/logs',      icon: FileText,      label: 'Logs'      },
      { path: '/scheduler', icon: CalendarClock, label: 'Scheduler' },
    ],
  },
  {
    id: 'robot',
    label: 'Robot',
    items: [
      { path: '/camera', icon: Camera,   label: 'Camera'        },
      { path: '/motor',  icon: Bot,      label: 'Motor Control' },
      { path: '/ros2',   icon: Activity,     label: 'ROS2'          },
      { path: '/ml',     icon: BrainCircuit, label: 'ML Workspace'   },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [
      { path: '/backup',   icon: Shield,   label: 'Backup'   },
      { path: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
]

// ─── Small helpers ────────────────────────────────────────────────────────────
function ThemeToggle() {
  const { theme, toggle } = useThemeStore()
  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to Light mode' : 'Switch to Dark mode'}
      className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[10px] border border-jet-border text-jet-dim hover:text-jet-cyan hover:border-jet-cyan/40 transition-colors"
    >
      {theme === 'dark' ? <Sun size={11} /> : <Moon size={11} />}
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}

function LogoutButton() {
  const { logout, username, authEnabled } = useAuthStore()
  if (!authEnabled) return null
  return (
    <button
      onClick={logout}
      title={`Logout (${username})`}
      className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[10px] border border-jet-border text-jet-dim hover:text-jet-red hover:border-jet-red/30 transition-colors"
    >
      <LogOut size={10} />
      {username}
    </button>
  )
}

function AlertBadge({ count }) {
  if (!count) return null
  return (
    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center font-mono text-[9px] font-bold bg-jet-red text-white">
      {count > 9 ? '9+' : count}
    </span>
  )
}

// ─── Collapsible nav group ─────────────────────────────────────────────────────
// pathname passed as prop — no useLocation() inside this component
function NavGroup({ group, collapsed, activeAlertCount, pathname }) {
  const hasActive = group.items.some(item => pathname === item.path)
  const [open, setOpen] = useState(true)

  // Re-open if navigating into this group while it was closed
  useEffect(() => {
    if (hasActive) setOpen(true)
  }, [pathname, hasActive])

  // ── Collapsed sidebar: plain icons, no group headers ──
  if (collapsed) {
    return (
      <>
        {group.items.map(({ path, icon: Icon, label, alertBadge }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) => clsx(
              'nav-item mx-2 my-0.5 relative justify-center px-0',
              isActive && 'active'
            )}
            title={label}
          >
            <div className="relative">
              <Icon size={15} className="flex-shrink-0" />
              {alertBadge && <AlertBadge count={activeAlertCount} />}
            </div>
          </NavLink>
        ))}
      </>
    )
  }

  // ── Expanded sidebar: group header + collapsible items ──
  return (
    <div className="mb-0.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 pt-3 pb-1 group select-none"
      >
        <span className="font-mono text-[9px] uppercase tracking-widest text-jet-dim group-hover:text-jet-text transition-colors">
          {group.label}
        </span>
        <ChevronDown
          size={10}
          className={clsx('text-jet-dim transition-transform duration-200', !open && '-rotate-90')}
        />
      </button>

      {open && (
        <div>
          {group.items.map(({ path, icon: Icon, label, alertBadge }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => clsx(
                'nav-item mx-2 my-0.5 relative',
                isActive && 'active'
              )}
            >
              <div className="relative">
                <Icon size={15} className="flex-shrink-0" />
                {alertBadge && <AlertBadge count={activeAlertCount} />}
              </div>
              <span className="text-xs">{label}</span>
              {alertBadge && activeAlertCount > 0 && (
                <span className="ml-auto px-1.5 py-0.5 rounded-full font-mono text-[9px] font-bold bg-jet-red/15 text-jet-red">
                  {activeAlertCount}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Layout ──────────────────────────────────────────────────────────────
export default function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const { connected, hardware, metrics, lastUpdate, newAlerts, activeAlertCount } = useMetricsStore()
  const { pathname } = useLocation()

  const hostname = metrics?.system?.system?.hostname || hardware?.model || 'Jetson'
  const model    = hardware?.model || 'NVIDIA Jetson'

  return (
    <div className="flex h-screen bg-jet-bg overflow-hidden">
      <AlertToastContainer alerts={newAlerts} />

      {/* Sidebar */}
      <aside className={clsx(
        'flex flex-col bg-jet-surface border-r border-jet-border transition-all duration-300',
        collapsed ? 'w-[60px]' : 'w-[220px]'
      )}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-3 py-4 border-b border-jet-border min-h-[60px]">
          <div className="flex-shrink-0 w-8 h-8 rounded bg-jet-cyan/10 border border-jet-cyan/30 flex items-center justify-center">
            <Server size={14} className="text-jet-cyan" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-display text-xs font-bold text-jet-cyan truncate tracking-wider">JETSON</div>
              <div className="font-mono text-[10px] text-jet-dim truncate">{model.replace('Jetson ', '')}</div>
            </div>
          )}
        </div>

        {/* Connection status */}
        {!collapsed && (
          <div className="px-3 py-2 border-b border-jet-border">
            <div className="flex items-center gap-2">
              <div className={clsx('w-2 h-2 rounded-full', connected ? 'bg-jet-green animate-pulse' : 'bg-jet-red')} />
              <span className="font-mono text-[10px] text-jet-dim">{connected ? 'LIVE' : 'OFFLINE'}</span>
              {lastUpdate && (
                <span className="font-mono text-[10px] text-jet-muted ml-auto">
                  {new Date(lastUpdate).toLocaleTimeString('en', { hour12: false })}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV_GROUPS.map(group => (
            <NavGroup
              key={group.id}
              group={group}
              collapsed={collapsed}
              activeAlertCount={activeAlertCount}
              pathname={pathname}
            />
          ))}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center p-3 border-t border-jet-border text-jet-dim hover:text-jet-text transition-colors"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-6 py-3 border-b border-jet-border bg-jet-surface min-h-[60px]">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-jet-dim uppercase tracking-widest">{hostname}</span>
          </div>
          <div className="flex items-center gap-3">
            {hardware?.jetpack_version && (
              <span className="font-mono text-[10px] text-jet-dim">JetPack {hardware.jetpack_version}</span>
            )}
            {hardware?.cuda_version && (
              <span className="font-mono text-[10px] text-jet-dim">CUDA {hardware.cuda_version}</span>
            )}
            {activeAlertCount > 0 && (
              <NavLink to="/alerts"
                className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[10px] border bg-jet-red/10 text-jet-red border-jet-red/30 transition-colors">
                <Bell size={10} />
                {activeAlertCount} ALERT{activeAlertCount > 1 ? 'S' : ''}
              </NavLink>
            )}
            <ThemeToggle />
            <div className={clsx(
              'flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[10px] border',
              connected
                ? 'bg-jet-green/10 text-jet-green border-jet-green/20'
                : 'bg-jet-red/10 text-jet-red border-jet-red/20'
            )}>
              {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
              {connected ? 'CONNECTED' : 'RECONNECTING'}
            </div>
            <LogoutButton />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 grid-bg">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
