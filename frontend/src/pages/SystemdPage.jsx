/**
 * Systemd Page — Gestión de servicios del sistema
 * Lista, estado, start/stop/restart/enable/disable, logs
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Server, Play, Square, RotateCcw, Power, PowerOff,
  FileText, ChevronDown, ChevronUp, Search, RefreshCw,
  Shield, AlertCircle, CheckCircle, Clock, Minus
} from 'lucide-react'
import { apiFetch } from '../utils/format'

// ── Helpers ───────────────────────────────────────────────────────────────────
function StatusDot({ active, sub }) {
  const color =
    active === 'active'   ? '#3fb950' :
    active === 'failed'   ? '#f85149' :
    active === 'inactive' ? '#6e7681' : '#d29922'
  const label = sub || active
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px]" style={{ color }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }}/>
      {label.toUpperCase()}
    </span>
  )
}

function EnabledBadge({ state }) {
  const enabled = state === 'enabled'
  const color = enabled ? '#58a6ff' : '#6e7681'
  return (
    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded border"
          style={{ color, borderColor: color + '40', background: color + '10' }}>
      {state || 'unknown'}
    </span>
  )
}

function ActionBtn({ icon: Icon, label, onClick, color = 'text-jet-dim', disabled = false, danger = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex items-center gap-1 px-2 py-1 font-mono text-[10px] border rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed
        ${danger
          ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
          : 'border-jet-border hover:border-jet-cyan/40 hover:text-jet-cyan ' + color
        }`}
    >
      <Icon size={10}/>{label}
    </button>
  )
}

// ── Log Viewer ────────────────────────────────────────────────────────────────
function LogViewer({ name, onClose }) {
  const [logs,    setLogs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [lines,   setLines]   = useState(100)
  const bottomRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch(`/systemd/services/${name}/logs?lines=${lines}`)
      setLogs(r.lines || [])
    } catch(e) {
      setLogs([{ text: `Error loading logs: ${e.message}`, level: 'error' }])
    } finally {
      setLoading(false)
    }
  }, [name, lines])

  useEffect(() => { load() }, [load])
  useEffect(() => { bottomRef.current?.scrollIntoView() }, [logs])

  const levelColor = { error: '#f85149', warn: '#d29922', notice: '#58a6ff', info: '#6e7681' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-4xl border rounded-xl flex flex-col" style={{borderColor:"var(--color-border)",background:"var(--color-surface)"}}
           style={{ maxHeight: '80vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{borderColor:"var(--color-border)"}}>
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-jet-cyan"/>
            <span className="font-mono text-sm font-bold text-jet-text">{name}</span>
            <span className="font-mono text-[10px] text-jet-dim">journal logs</span>
          </div>
          <div className="flex items-center gap-2">
            <select value={lines} onChange={e => setLines(Number(e.target.value))}
                    className="border rounded px-2 py-1 font-mono text-[10px]" style={{background:"var(--color-bg)",borderColor:"var(--color-border)",color:"var(--color-dim)"}}>
              <option value={50}>50 lines</option>
              <option value={100}>100 lines</option>
              <option value={200}>200 lines</option>
              <option value={500}>500 lines</option>
            </select>
            <button onClick={load}
                    className="px-2 py-1 font-mono text-[10px] border border-jet-border rounded text-jet-dim hover:text-jet-cyan hover:border-jet-cyan/40 transition-colors">
              <RefreshCw size={10}/>
            </button>
            <button onClick={onClose}
                    className="px-3 py-1 font-mono text-[10px] border border-jet-border rounded text-jet-dim hover:text-jet-cyan hover:border-jet-cyan/40 transition-colors">
              Close
            </button>
          </div>
        </div>
        {/* Logs */}
        <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px]"
             style={{ background: '#0d1117' }}>
          {loading ? (
            <div className="text-jet-dim text-center py-8">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="text-jet-dim text-center py-8">No logs found</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="leading-5 whitespace-pre-wrap break-all"
                   style={{ color: levelColor[l.level] || '#6e7681' }}>
                {l.text}
              </div>
            ))
          )}
          <div ref={bottomRef}/>
        </div>
      </div>
    </div>
  )
}

// ── Service Row ───────────────────────────────────────────────────────────────
function ServiceRow({ svc, onAction, onViewLogs }) {
  const [open,   setOpen]   = useState(false)
  const [acting, setActing] = useState(false)
  const [detail, setDetail] = useState(null)

  const loadDetail = useCallback(async () => {
    try {
      const r = await apiFetch(`/systemd/services/${svc.name}`)
      setDetail(r)
    } catch(e) { console.error(e) }
  }, [svc.name])

  const toggle = () => {
    setOpen(o => {
      if (!o) loadDetail()
      return !o
    })
  }

  const doAction = async (action) => {
    setActing(true)
    try {
      const r = await onAction(svc.name, action)
      if (r && detail) {
        setDetail(d => ({ ...d, active: r.active, sub: r.sub, enabled: r.enabled }))
      }
    } finally {
      setActing(false)
    }
  }

  const isActive  = svc.active === 'active'
  const isFailed  = svc.active === 'failed'
  const isEnabled = svc.enabled === 'enabled' || detail?.enabled === 'enabled'

  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${
      isFailed ? 'border-red-500/30' : ''
    }`}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors" style={{background:"transparent"}} onMouseEnter={e=>e.currentTarget.style.background="var(--color-surface)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
           onClick={toggle}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-sm text-jet-text truncate">{svc.short_name}</span>
            {svc.protected && (
              <Shield size={10} className="text-jet-muted flex-shrink-0" title="Protected service"/>
            )}
          </div>
          <div className="font-mono text-[10px] text-jet-dim truncate">{svc.description}</div>
        </div>
        <StatusDot active={svc.active} sub={svc.sub}/>
        <EnabledBadge state={svc.enabled}/>
        {open ? <ChevronUp size={12} className="text-jet-dim flex-shrink-0"/> 
               : <ChevronDown size={12} className="text-jet-dim flex-shrink-0"/>}
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3" style={{borderColor:"var(--color-border)",background:"var(--color-surface)"}}>
          {/* Detail info */}
          {detail && (
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              <span><span className="text-jet-muted">PID </span><span className="text-jet-dim">{detail.pid === '0' ? '—' : detail.pid}</span></span>
              <span><span className="text-jet-muted">Type </span><span className="text-jet-dim">{detail.type || '—'}</span></span>
              <span><span className="text-jet-muted">Restart </span><span className="text-jet-dim">{detail.restart || '—'}</span></span>
              <span><span className="text-jet-muted">Started </span><span className="text-jet-dim">{detail.started ? detail.started.split(' ')[0] : '—'}</span></span>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {!svc.protected ? (
              <>
                {isActive ? (
                  <>
                    <ActionBtn icon={Square}    label="Stop"    onClick={() => doAction('stop')}    disabled={acting} danger/>
                    <ActionBtn icon={RotateCcw} label="Restart" onClick={() => doAction('restart')} disabled={acting}/>
                    <ActionBtn icon={RotateCcw} label="Reload"  onClick={() => doAction('reload')}  disabled={acting}/>
                  </>
                ) : (
                  <ActionBtn icon={Play} label="Start" onClick={() => doAction('start')} disabled={acting}/>
                )}
                {isEnabled
                  ? <ActionBtn icon={PowerOff} label="Disable" onClick={() => doAction('disable')} disabled={acting}/>
                  : <ActionBtn icon={Power}    label="Enable"  onClick={() => doAction('enable')}  disabled={acting}/>
                }
              </>
            ) : (
              <>
                {isActive && (
                  <ActionBtn icon={RotateCcw} label="Restart" onClick={() => doAction('restart')} disabled={acting}/>
                )}
                <span className="flex items-center gap-1 font-mono text-[10px] text-jet-muted px-2">
                  <Shield size={10}/> Start/Stop protegido
                </span>
              </>
            )}
            <ActionBtn icon={FileText} label="Logs" onClick={() => onViewLogs(svc.short_name)}/>
          </div>

          {acting && (
            <div className="font-mono text-[10px] text-jet-cyan animate-pulse">Executing...</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SystemdPage() {
  const [services, setServices] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [filter,   setFilter]   = useState('all')  // all | active | failed | inactive
  const [logTarget, setLogTarget] = useState(null)
  const [toast,    setToast]    = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch('/systemd/services')
      setServices(r.services || [])
    } catch(e) {
      showToast(`Error: ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const handleAction = async (name, action) => {
    try {
      const r = await apiFetch(`/systemd/services/${name}/action`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      })
      showToast(`${name}: ${action} → ${r.active}`, 'success')
      // Actualizar el servicio en la lista local
      setServices(prev => prev.map(s =>
        s.name === name || s.name === name + '.service'
          ? { ...s, active: r.active, sub: r.sub, enabled: r.enabled }
          : s
      ))
      return r
    } catch(e) {
      showToast(`${action} failed: ${e.message}`, 'error')
      return null
    }
  }

  // Filtrar servicios
  const filtered = services.filter(s => {
    const matchSearch = !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
    const matchFilter =
      filter === 'all'      ? true :
      filter === 'active'   ? s.active === 'active' :
      filter === 'failed'   ? s.active === 'failed' :
      filter === 'inactive' ? s.active === 'inactive' : true
    return matchSearch && matchFilter
  })

  const counts = {
    all:      services.length,
    active:   services.filter(s => s.active === 'active').length,
    failed:   services.filter(s => s.active === 'failed').length,
    inactive: services.filter(s => s.active === 'inactive').length,
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Server size={18} className="text-jet-cyan"/>
          <h1 className="font-display text-lg font-bold tracking-widest">SYSTEMD</h1>
          <span className="font-mono text-[10px] text-jet-dim">{counts.all} services</span>
        </div>
        <button onClick={load}
                className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] border border-jet-border rounded hover:border-jet-cyan/40 hover:text-jet-cyan text-jet-dim transition-colors">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''}/>
          Refresh
        </button>
      </div>

      {/* Filter tabs + Search */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Tabs */}
        <div className="flex gap-1 border-b" style={{borderColor:"var(--color-border)"}}>
          {[
            { id: 'all',      label: 'All',      icon: Minus,        color: '' },
            { id: 'active',   label: 'Active',   icon: CheckCircle,  color: 'text-jet-green' },
            { id: 'failed',   label: 'Failed',   icon: AlertCircle,  color: 'text-red-400'   },
            { id: 'inactive', label: 'Inactive', icon: Clock,        color: 'text-jet-dim'   },
          ].map(t => (
            <button key={t.id} onClick={() => setFilter(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] border-b-2 -mb-px transition-colors ${
                      filter === t.id
                        ? 'border-jet-cyan text-jet-cyan'
                        : 'border-transparent text-jet-dim hover:text-jet-text'
                    }`}>
              <t.icon size={10} className={filter === t.id ? '' : t.color}/>
              {t.label}
              <span className="px-1.5 py-0.5 rounded-full bg-jet-border font-mono text-[9px]">
                {counts[t.id]}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <Search size={12} className="text-jet-dim flex-shrink-0"/>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter services..."
            className="jet-input text-xs"
          />
        </div>
      </div>

      {/* Failed banner */}
      {counts.failed > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0"/>
          <span className="font-mono text-xs text-red-400">
            {counts.failed} service{counts.failed > 1 ? 's' : ''} failed — check logs for details
          </span>
          <button onClick={() => setFilter('failed')}
                  className="ml-auto font-mono text-[10px] text-red-400 underline">
            Show failed
          </button>
        </div>
      )}

      {/* Service list */}
      {loading ? (
        <div className="text-center py-12 font-mono text-sm text-jet-dim">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin opacity-40"/>
          Loading services...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 font-mono text-sm text-jet-dim">
          No services match the current filter
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(svc => (
            <ServiceRow
              key={svc.name}
              svc={svc}
              onAction={handleAction}
              onViewLogs={name => setLogTarget(name)}
            />
          ))}
        </div>
      )}

      {/* Log viewer modal */}
      {logTarget && (
        <LogViewer name={logTarget} onClose={() => setLogTarget(null)}/>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg border font-mono text-xs max-w-sm
          ${toast.type === 'error'   ? 'bg-red-900/80 border-red-500/50 text-red-200' :
            toast.type === 'success' ? 'bg-green-900/80 border-green-500/50 text-green-200' :
                                       'text-jet-text'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
