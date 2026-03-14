import { useMetricsStore } from '../store/metricsStore'
import { ProgressBar, MiniAreaChart } from '../components/charts/Charts'
import { formatBytes, formatBytesPerSec, formatTemp, getUsageColor, apiFetch } from '../utils/format'
import { HardDrive, Network, Thermometer, FileText, Settings, RefreshCw, Power, Wind, Cpu, Zap } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import clsx from 'clsx'

// ─── Storage Page ─────────────────────────────────────────────────────────────
export function StoragePage() {
  const { metrics } = useMetricsStore()
  const storage = metrics?.system?.storage || {}
  const partitions = storage.partitions || []
  const io = storage.io || {}

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <HardDrive size={18} className="text-jet-yellow" />
        <h1 className="font-display text-lg font-bold tracking-widest">STORAGE</h1>
      </div>
      <div className="space-y-3">
        {partitions.map(part => (
          <div key={part.mountpoint} className="card">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="font-mono text-sm font-bold text-jet-text">{part.mountpoint}</span>
                <span className="font-mono text-[10px] text-jet-dim ml-2">{part.device}</span>
                <span className="font-mono text-[10px] text-jet-muted ml-1">({part.fstype})</span>
              </div>
              <span className="font-display text-lg font-bold" style={{ color: getUsageColor(part.percent) }}>
                {part.percent?.toFixed(1)}%
              </span>
            </div>
            <ProgressBar percent={part.percent} className="mb-2" />
            <div className="flex justify-between font-mono text-[10px] text-jet-dim">
              <span>Used: {formatBytes(part.used)}</span>
              <span>Free: {formatBytes(part.free)}</span>
              <span>Total: {formatBytes(part.total)}</span>
            </div>
          </div>
        ))}
      </div>
      {Object.keys(io).length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">DISK I/O</span></div>
          <div className="space-y-2">
            {Object.entries(io).map(([disk, stats]) => (
              <div key={disk} className="flex items-center justify-between p-2 bg-jet-surface rounded">
                <span className="font-mono text-xs text-jet-text">{disk}</span>
                <div className="flex gap-4 font-mono text-[11px]">
                  <span className="text-jet-green">↓ {formatBytesPerSec(stats.read_bytes_sec)}</span>
                  <span className="text-jet-cyan">↑ {formatBytesPerSec(stats.write_bytes_sec)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Network Page ─────────────────────────────────────────────────────────────
export function NetworkPage() {
  const { metrics, history } = useMetricsStore()
  const interfaces = metrics?.system?.network?.interfaces || {}

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Network size={18} className="text-jet-green" />
        <h1 className="font-display text-lg font-bold tracking-widest">NETWORK</h1>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header"><span className="card-title">RX (Download)</span></div>
          <MiniAreaChart data={history.network_rx} color="#3fb950" height={80} formatter={v => formatBytesPerSec(v)} />
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">TX (Upload)</span></div>
          <MiniAreaChart data={history.network_tx} color="#58a6ff" height={80} formatter={v => formatBytesPerSec(v)} />
        </div>
      </div>
      <div className="space-y-3">
        {Object.entries(interfaces).map(([iface, data]) => (
          <div key={iface} className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={clsx('w-2 h-2 rounded-full', data.is_up ? 'bg-jet-green' : 'bg-jet-muted')} />
                <span className="font-mono text-sm font-bold">{iface}</span>
                {data.ip && <span className="font-mono text-xs text-jet-cyan">{data.ip}</span>}
                {data.speed > 0 && <span className="font-mono text-[10px] text-jet-dim">{data.speed} Mbps</span>}
              </div>
              <span className={clsx('badge', data.is_up ? 'badge-green' : 'badge-red')}>
                {data.is_up ? 'UP' : 'DOWN'}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'RX RATE', value: formatBytesPerSec(data.rx_bytes_sec), color: '#3fb950' },
                { label: 'TX RATE', value: formatBytesPerSec(data.tx_bytes_sec), color: '#58a6ff' },
                { label: 'TOTAL RX', value: formatBytes(data.bytes_recv), color: '#e6edf3' },
                { label: 'TOTAL TX', value: formatBytes(data.bytes_sent), color: '#e6edf3' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-jet-surface rounded p-2">
                  <div className="font-mono text-[9px] text-jet-dim mb-1">{label}</div>
                  <div className="font-mono text-xs font-bold" style={{ color }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {Object.keys(interfaces).length === 0 && (
          <div className="card text-center py-8 font-mono text-xs text-jet-dim">No interfaces detected</div>
        )}
      </div>
    </div>
  )
}

// ─── Thermal Page ─────────────────────────────────────────────────────────────
export function ThermalPage() {
  const { metrics, history } = useMetricsStore()
  const thermals = metrics?.system?.thermals || {}
  const fan = thermals.fan || {}

  // Combinar sensores de thermals.sensors y tegrastats temperatures
  const buildSensors = () => {
    const result = {}
    // Fuente 1: system.thermals.sensors (formato estandar)
    Object.entries(thermals.sensors || {}).forEach(([k, v]) => {
      result[k] = { temp_c: v?.temp_c ?? v, type: k }
    })
    // Fuente 2: gpu.tegrastats_raw.temperatures (Jetson Nano L4T)
    const tgTemps = metrics?.gpu?.tegrastats_raw?.temperatures || {}
    Object.entries(tgTemps).forEach(([k, v]) => {
      if (!result[k]) result[k] = { temp_c: v, type: k }
    })
    return result
  }
  const sensors = buildSensors()

  const fanDisplay = () => {
    if (!fan.available) return { label: 'N/A', sub: 'No fan detected' }
    if (fan.passive_cooling) return { label: '0% (Passive)', sub: 'Fan off — temperature OK', color: '#3fb950' }
    const pct = fan.percent ?? 0
    const rpm = fan.rpm != null ? ` · ${fan.rpm} RPM` : ''
    return { label: `${pct}%`, sub: `PWM${rpm}`, color: pct > 70 ? '#f85149' : pct > 30 ? '#d29922' : '#3fb950' }
  }
  const fanInfo = fanDisplay()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Thermometer size={18} className="text-jet-red" />
        <h1 className="font-display text-lg font-bold tracking-widest">THERMALS</h1>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title flex items-center gap-2"><Wind size={12} /> FAN STATUS</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="font-display text-2xl font-bold" style={{ color: fanInfo.color || '#58a6ff' }}>
            {fanInfo.label}
          </div>
          <div className="font-mono text-[11px] text-jet-dim">{fanInfo.sub}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">CPU TEMPERATURE HISTORY</span>
          <span className="font-mono text-[10px] text-jet-dim">90s · updates every 1.5s</span>
        </div>
        <MiniAreaChart data={history.temperature} color="#f85149" height={100} formatter={v => `${v?.toFixed(1)}°C`} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {Object.entries(sensors).map(([name, data]) => {
          const temp = data.temp_c
          const color = temp > 85 ? '#f85149' : temp > 70 ? '#d29922' : temp > 50 ? '#d18616' : '#3fb950'
          // PMIC en Jetson Nano reporta 50°C fijo — es el valor de reposo del regulador, no una alarma
          const isPmicFixed = (data.type || name).toUpperCase().includes('PMIC') && temp === 50.0
          return (
            <div key={name} className="card text-center" style={{ borderColor: `${color}30` }}
                 title={isPmicFixed ? 'PMIC: Power Management IC — reports 50°C at idle. Normal behavior on Jetson Nano.' : undefined}>
              <div className="font-mono text-[10px] mb-2 truncate" style={{color:'var(--color-dim)'}}>{data.type || name}</div>
              <div className="font-display text-3xl font-bold" style={{ color }}>
                {temp?.toFixed(1)}
              </div>
              <div className="font-mono text-[10px] mt-1" style={{color:'var(--color-dim)'}}>°C</div>
              <div className="mt-2 h-1 rounded-full overflow-hidden" style={{background:'var(--color-border)'}}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(100, (temp / 100) * 100)}%`, backgroundColor: color }} />
              </div>
              {isPmicFixed && (
                <div className="font-mono text-[9px] mt-1.5" style={{color:'var(--color-muted)'}}>idle baseline</div>
              )}
            </div>
          )
        })}
        {Object.keys(sensors).length === 0 && (
          <div className="col-span-4 card text-center py-8 font-mono text-xs text-jet-dim">
            No temperature sensors detected
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Logs Page ────────────────────────────────────────────────────────────────
export function LogsPage() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const logRef = useRef(null)

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/logs/system?lines=200')
      setLogs(data.logs || [])
    } catch (e) {
      setLogs([`Error: ${e.message}`])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLogs() }, [])
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  const filtered = search
    ? logs.filter(l => l.toLowerCase().includes(search.toLowerCase()))
    : logs

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <FileText size={18} className="text-jet-dim" />
          <h1 className="font-display text-lg font-bold tracking-widest">SYSTEM LOGS</h1>
        </div>
        <div className="flex items-center gap-2">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="bg-jet-surface border border-jet-border rounded px-3 py-1.5 font-mono text-xs text-jet-text placeholder-jet-muted focus:outline-none focus:border-jet-cyan/50 w-48" />
          <button onClick={fetchLogs} className="btn-ghost"><RefreshCw size={12} /></button>
        </div>
      </div>
      <div ref={logRef}
        className="bg-jet-bg border border-jet-border rounded-lg p-4 overflow-y-auto font-mono text-[11px] space-y-0.5 min-h-[400px] max-h-[600px]">
        {loading ? (
          <div className="text-jet-dim text-center py-12">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-jet-dim text-center py-12">No logs</div>
        ) : filtered.map((line, i) => (
          <div key={i} className={clsx('leading-5 px-1 rounded hover:bg-jet-surface/50',
            /error|fail|crit/i.test(line) ? 'text-jet-red' :
            /warn/i.test(line) ? 'text-jet-yellow' : 'text-jet-dim'
          )}>{line}</div>
        ))}
      </div>
    </div>
  )
}

// ─── Settings Page ────────────────────────────────────────────────────────────
export function SettingsPage() {
  const { hardware } = useMetricsStore()

  // Estado local sincronizado con backend
  const [settings, setSettings] = useState(null)
  const [fanValue, setFanValue] = useState(0)
  const [powerModes, setPowerModes] = useState([])
  const [currentMode, setCurrentMode] = useState(null)
  const [clocksStatus, setClocksStatus] = useState(null)
  const [fanInfo, setFanInfo] = useState(null)
  const [loading, setLoading] = useState({})
  const [messages, setMessages] = useState({})
  const [confirmAction, setConfirmAction] = useState(null)

  const setMsg = (key, msg, isError = false) => {
    setMessages(prev => ({ ...prev, [key]: { text: msg, error: isError } }))
    setTimeout(() => setMessages(prev => { const n = {...prev}; delete n[key]; return n }), 4000)
  }

  const setLoad = (key, val) => setLoading(prev => ({ ...prev, [key]: val }))

  // Cargar todo al montar
  useEffect(() => {
    fetchAll()
  }, [])

  const fetchAll = async () => {
    try {
      const [s, modes, mode, clocks, fan] = await Promise.all([
        apiFetch('/settings').catch(() => null),
        apiFetch('/hardware/power-modes').catch(() => []),
        apiFetch('/hardware/power-mode').catch(() => null),
        apiFetch('/hardware/jetson-clocks').catch(() => null),
        apiFetch('/hardware/fan').catch(() => null),
      ])
      if (s) {
        setSettings(s)
        setFanValue(s.fan_speed ?? 0)
      }
      setPowerModes(Array.isArray(modes) ? modes : [])
      setCurrentMode(mode)
      setClocksStatus(clocks)
      setFanInfo(fan)
    } catch (e) {
      console.error('fetchAll error:', e)
    }
  }

  // ── Fan ──
  const handleFanApply = async () => {
    setLoad('fan', true)
    try {
      const r = await apiFetch('/hardware/fan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speed: fanValue }),
      })
      if (r.success) {
        setMsg('fan', `Fan set to ${fanValue}% (PWM=${r.pwm ?? ''})`)
        setSettings(prev => ({ ...prev, fan_speed: fanValue }))
        fetchAll()
      } else {
        setMsg('fan', r.error || 'Error', true)
      }
    } catch (e) {
      setMsg('fan', e.message, true)
    } finally {
      setLoad('fan', false)
    }
  }

  const handleFanAuto = async () => {
    setLoad('fan', true)
    try {
      // PWM=0 → control automático por temperatura
      const r = await apiFetch('/hardware/fan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speed: 0 }),
      })
      if (r.success) {
        setFanValue(0)
        setMsg('fan', 'Fan set to automatic (thermal control)')
        fetchAll()
      }
    } catch (e) {
      setMsg('fan', e.message, true)
    } finally {
      setLoad('fan', false)
    }
  }

  // ── Power mode ──
  const handleSetPowerMode = async (modeId) => {
    setLoad(`mode_${modeId}`, true)
    try {
      const r = await apiFetch('/hardware/power-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode_id: modeId }),
      })
      if (r.success) {
        setMsg('power', `Power mode changed`)
        fetchAll()
      } else {
        setMsg('power', r.error || 'Error', true)
      }
    } catch (e) {
      setMsg('power', e.message, true)
    } finally {
      setLoad(`mode_${modeId}`, false)
    }
  }

  // ── jetson_clocks ──
  const handleClocksToggle = async () => {
    const enabled = clocksStatus?.enabled
    setLoad('clocks', true)
    try {
      const endpoint = enabled ? '/hardware/jetson-clocks/disable' : '/hardware/jetson-clocks/enable'
      const r = await apiFetch(endpoint, { method: 'POST' })
      if (r.success) {
        setMsg('clocks', enabled ? 'jetson_clocks disabled' : 'jetson_clocks enabled — all cores at max frequency')
        fetchAll()
      } else {
        setMsg('clocks', r.error || 'Error', true)
      }
    } catch (e) {
      setMsg('clocks', e.message, true)
    } finally {
      setLoad('clocks', false)
    }
  }

  // ── System actions ──
  const handleSystemAction = async (action) => {
    try {
      await apiFetch(`/system/${action}`, { method: 'POST' })
      setMsg('system', `${action} initiated...`)
    } catch (e) {
      setMsg('system', e.message, true)
    }
    setConfirmAction(null)
  }

  const Msg = ({ id }) => messages[id] ? (
    <span className={clsx('font-mono text-[11px]', messages[id].error ? 'text-jet-red' : 'text-jet-green')}>
      {messages[id].text}
    </span>
  ) : null

  return (
    <div className="space-y-6">
      {/* Confirm modal */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-jet-card border border-jet-red/40 rounded-lg p-6 max-w-sm w-full">
            <div className="font-mono font-bold text-jet-red mb-3 capitalize">Confirm {confirmAction}</div>
            <p className="font-mono text-sm text-jet-dim mb-5">
              This will {confirmAction} the system immediately. All containers will stop.
            </p>
            <div className="flex gap-2">
              <button onClick={() => handleSystemAction(confirmAction)}
                className="flex-1 bg-jet-red/20 border border-jet-red/40 text-jet-red font-mono text-xs py-2 rounded hover:bg-jet-red/30 transition-colors">
                Confirm {confirmAction}
              </button>
              <button onClick={() => setConfirmAction(null)}
                className="flex-1 btn-ghost">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Settings size={18} className="text-jet-dim" />
        <h1 className="font-display text-lg font-bold tracking-widest">SETTINGS</h1>
      </div>

      {/* ── Device Information ── */}
      <div className="card">
        <div className="card-header"><span className="card-title">DEVICE INFORMATION</span></div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: 'Model',      value: hardware?.model },
            { label: 'JetPack',    value: hardware?.jetpack_version },
            { label: 'L4T',        value: hardware?.l4t_version },
            { label: 'CUDA',       value: hardware?.cuda_version },
            { label: 'cuDNN',      value: hardware?.cudnn_version },
            { label: 'TensorRT',   value: hardware?.tensorrt_version },
            { label: 'OpenCV',     value: hardware?.opencv_version },
            { label: 'Chip',       value: hardware?.chip?.toUpperCase() },
            { label: 'GPU Cores',  value: hardware?.gpu_cores ? `${hardware.gpu_cores} CUDA cores` : null },
          ].map(({ label, value }) => (
            <div key={label} className="bg-jet-surface rounded p-3">
              <div className="font-mono text-[10px] text-jet-dim mb-1">{label}</div>
              <div className={clsx('font-mono text-sm font-bold truncate', value ? 'text-jet-cyan' : 'text-jet-muted')}>
                {value || 'Not detected'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Features ── */}
      {hardware?.features && (
        <div className="card">
          <div className="card-header"><span className="card-title">FEATURES</span></div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(hardware.features).map(([feat, available]) => (
              <div key={feat} className={clsx(
                'px-3 py-1.5 rounded border font-mono text-[11px]',
                available
                  ? 'bg-jet-green/10 border-jet-green/30 text-jet-green'
                  : 'bg-jet-muted/5 border-jet-border text-jet-muted'
              )}>
                {available ? '✓' : '✗'} {feat.replace(/_/g, ' ')}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── AI Frameworks ── */}
      {hardware?.ai_frameworks && (
        <div className="card">
          <div className="card-header"><span className="card-title">AI FRAMEWORKS</span></div>
          <div className="flex flex-wrap gap-3">
            {Object.entries(hardware.ai_frameworks).map(([name, version]) => (
              <div key={name} className={clsx('px-3 py-2 rounded border font-mono text-xs',
                version ? 'bg-jet-green/10 border-jet-green/30 text-jet-green'
                        : 'bg-jet-muted/10 border-jet-border text-jet-muted')}>
                <div className="capitalize font-semibold">{name}</div>
                <div className="text-[10px] mt-0.5">{version || 'Not installed'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Fan Control ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title flex items-center gap-2"><Wind size={12} /> FAN CONTROL</span>
          <Msg id="fan" />
        </div>

        {/* Estado actual */}
        <div className="flex gap-3 mb-4">
          {fanInfo && (
            <>
              <div className="bg-jet-surface rounded p-2 text-center">
                <div className="font-mono text-[9px] text-jet-dim">CURRENT PWM</div>
                <div className="font-mono text-sm font-bold text-jet-cyan">{fanInfo.cur_pwm ?? '—'}</div>
              </div>
              <div className="bg-jet-surface rounded p-2 text-center">
                <div className="font-mono text-[9px] text-jet-dim">TARGET PWM</div>
                <div className="font-mono text-sm font-bold text-jet-cyan">{fanInfo.target_pwm ?? '—'}</div>
              </div>
              <div className="bg-jet-surface rounded p-2 text-center">
                <div className="font-mono text-[9px] text-jet-dim">RPM</div>
                <div className="font-mono text-sm font-bold text-jet-text">
                  {fanInfo.rpm != null ? fanInfo.rpm : '—'}
                </div>
              </div>
              {fanInfo.passive_cooling && (
                <div className="bg-jet-green/10 border border-jet-green/30 rounded p-2 text-center">
                  <div className="font-mono text-[9px] text-jet-green">PASSIVE COOLING</div>
                  <div className="font-mono text-[10px] text-jet-dim">0 RPM = normal</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Control */}
        <div className="flex items-center gap-3 mb-2">
          <span className="font-mono text-[10px] text-jet-dim w-4">0%</span>
          <input type="range" min="0" max="100" value={fanValue}
            onChange={e => setFanValue(Number(e.target.value))}
            className="flex-1 accent-jet-cyan" />
          <span className="font-mono text-[10px] text-jet-dim w-8">100%</span>
          <span className="font-mono text-sm font-bold text-jet-cyan w-12 text-center">{fanValue}%</span>
        </div>
        <div className="flex gap-2">
          <button onClick={handleFanApply} disabled={loading.fan}
            className="btn-primary flex-1">
            {loading.fan ? 'Applying...' : `Apply ${fanValue}%`}
          </button>
          <button onClick={handleFanAuto} disabled={loading.fan}
            className="btn-ghost">Auto</button>
        </div>
        <p className="font-mono text-[10px] text-jet-dim mt-2">
          0% = fan off (thermal control) · 100% = max · Setting persists on reboot
        </p>
      </div>

      {/* ── Power Mode ── */}
      {(powerModes.length > 0 || currentMode) && (
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2"><Zap size={12} /> POWER MODE (nvpmodel)</span>
            {currentMode?.available && (
              <span className="badge badge-cyan">Active: {currentMode.mode}</span>
            )}
            <Msg id="power" />
          </div>
          <div className="flex flex-wrap gap-2">
            {powerModes.map(mode => (
              <button key={mode.id}
                onClick={() => handleSetPowerMode(mode.id)}
                disabled={loading[`mode_${mode.id}`]}
                className={clsx('btn flex-col items-start gap-0.5 h-auto py-2',
                  currentMode?.id === mode.id ? 'btn-primary' : 'btn-ghost')}>
                <span className="font-bold">{mode.name}</span>
                {mode.description && <span className="text-[9px] opacity-60">{mode.description}</span>}
              </button>
            ))}
          </div>
          {!currentMode?.available && (
            <p className="font-mono text-[10px] text-jet-dim mt-2">nvpmodel not available on this system</p>
          )}
        </div>
      )}

      {/* ── jetson_clocks ── */}
      {clocksStatus !== null && (
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2"><Cpu size={12} /> JETSON_CLOCKS</span>
            {clocksStatus?.available && (
              <span className={clsx('badge', clocksStatus.enabled ? 'badge-green' : 'badge-red')}>
                {clocksStatus.enabled ? 'ENABLED' : 'DISABLED'}
              </span>
            )}
            <Msg id="clocks" />
          </div>
          {clocksStatus?.available ? (
            <>
              <p className="font-mono text-[10px] text-jet-dim mb-3">
                Locks all CPU/GPU/EMC clocks to maximum frequency. Disables dynamic scaling.
              </p>
              <button onClick={handleClocksToggle} disabled={loading.clocks}
                className={clsx('btn', clocksStatus.enabled ? 'btn-danger' : 'btn-primary')}>
                {loading.clocks ? 'Please wait...' : clocksStatus.enabled ? 'Disable jetson_clocks' : 'Enable jetson_clocks'}
              </button>
              {clocksStatus.output && (
                <pre className="mt-3 bg-jet-bg border border-jet-border rounded p-2 font-mono text-[10px] text-jet-dim overflow-auto max-h-32">
                  {clocksStatus.output}
                </pre>
              )}
            </>
          ) : (
            <p className="font-mono text-[10px] text-jet-dim">jetson_clocks not available on this system</p>
          )}
        </div>
      )}

      {/* ── System Actions ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title flex items-center gap-2"><Power size={12} /> SYSTEM ACTIONS</span>
          <Msg id="system" />
        </div>
        <div className="flex gap-3">
          <button onClick={() => setConfirmAction('reboot')}
            className="bg-jet-red/20 border border-jet-red/40 text-jet-red font-mono text-xs px-4 py-2 rounded hover:bg-jet-red/30 transition-colors">
            Reboot
          </button>
          <button onClick={() => setConfirmAction('shutdown')}
            className="bg-jet-red/20 border border-jet-red/40 text-jet-red font-mono text-xs px-4 py-2 rounded hover:bg-jet-red/30 transition-colors">
            Shutdown
          </button>
        </div>
        <p className="font-mono text-[10px] text-jet-dim mt-3">
          ⚠ All running containers and services will be stopped.
        </p>
      </div>
    </div>
  )
}
