import { useMetricsStore } from '../store/metricsStore'
import { useState, useEffect } from 'react'
import {
  MiniAreaChart, UsageGauge, ProgressBar, CoreBar
} from '../components/charts/Charts'
import {
  formatBytes, formatBytesPerSec, formatUptime,
  getUsageColor, formatFreq, apiFetch
} from '../utils/format'
import {
  Cpu, Zap, MemoryStick, HardDrive, Network,
  Thermometer, BatteryFull, CalendarClock
} from 'lucide-react'
import clsx from 'clsx'

// ── Battery Card ──────────────────────────────────────────────────────────────
function BatteryCard() {
  const [data, setData] = useState(null)
  useEffect(() => {
    const load = async () => {
      try { setData(await apiFetch('/battery/status')) }
      catch { setData(null) }
    }
    load()
    const iv = setInterval(load, 4000)
    return () => clearInterval(iv)
  }, [])

  const stateColor = { full:'#3fb950', good:'#3fb950', low:'#d29922', critical:'#f85149', depleted:'#f85149' }

  if (!data?.available) return (
    <div className="card">
      <div className="card-header">
        <span className="card-title flex items-center gap-2"><BatteryFull size={12}/> BATTERY</span>
      </div>
      <div className="font-mono text-[10px] py-3 text-center" style={{color:'var(--color-dim)'}}>
        {data === null ? 'Loading...' : 'INA219 not available'}
      </div>
    </div>
  )

  const color  = stateColor[data.state] || '#7d8590'
  const pct    = data.percent ?? 0
  const volt   = (data.voltage ?? data.voltage_v ?? 0).toFixed(2)
  const currentMa = data.current ?? data.current_ma
  const powerW    = data.power ?? (data.power_mw != null ? data.power_mw / 1000 : null)

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title flex items-center gap-2">
          <BatteryFull size={12} style={{color}}/> BATTERY
        </span>
        <span className="font-mono text-[10px] font-bold uppercase" style={{color}}>
          {data.state}{data.charging && ' · ⚡'}
        </span>
      </div>
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-2xl font-bold" style={{color}}>{volt}V</span>
        <span className="font-mono text-sm font-bold" style={{color}}>{pct}%</span>
      </div>
      <ProgressBar percent={pct} color={color} className="mb-3"/>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded p-2" style={{background:'var(--color-surface)'}}>
          <div className="font-mono text-[9px]" style={{color:'var(--color-dim)'}}>CURRENT</div>
          <div className="font-mono text-sm font-bold mt-0.5" style={{color:'var(--color-text)'}}>
            {currentMa != null ? `${Number(currentMa).toFixed(0)} mA` : '—'}
          </div>
        </div>
        <div className="rounded p-2" style={{background:'var(--color-surface)'}}>
          <div className="font-mono text-[9px]" style={{color:'var(--color-dim)'}}>POWER</div>
          <div className="font-mono text-sm font-bold mt-0.5" style={{color:'var(--color-text)'}}>
            {powerW != null ? `${Number(powerW).toFixed(2)} W` : '—'}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Scheduler Card ────────────────────────────────────────────────────────────
function SchedulerCard() {
  const [tasks, setTasks] = useState(null)
  useEffect(() => {
    const load = async () => {
      try { const r = await apiFetch('/scheduler/tasks'); setTasks(Array.isArray(r) ? r : []) }
      catch { setTasks([]) }
    }
    load()
    const iv = setInterval(load, 10000)
    return () => clearInterval(iv)
  }, [])

  const safeTasks = Array.isArray(tasks) ? tasks : []
  const total   = safeTasks.length
  const enabled = safeTasks.filter(t => t.enabled).length

  const formatNext = (ts) => {
    if (!ts) return '—'
    const diff = ts * 1000 - Date.now()
    if (diff < 0) return 'overdue'
    const mins = Math.round(diff / 60000)
    if (mins < 60) return `${mins}m`
    const hrs = Math.round(diff / 3600000)
    return hrs < 24 ? `${hrs}h` : `${Math.round(hrs/24)}d`
  }

  if (tasks === null) return (
    <div className="card">
      <div className="card-header">
        <span className="card-title flex items-center gap-2"><CalendarClock size={12}/> SCHEDULER</span>
      </div>
      <div className="font-mono text-[10px] py-3 text-center" style={{color:'var(--color-dim)'}}>Loading...</div>
    </div>
  )

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title flex items-center gap-2"><CalendarClock size={12}/> SCHEDULER</span>
        <span className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>{enabled}/{total} active</span>
      </div>
      {total === 0
        ? <div className="font-mono text-[10px] py-3 text-center" style={{color:'var(--color-dim)'}}>No tasks configured</div>
        : <div className="space-y-1.5">
            {safeTasks.slice(0, 5).map(task => {
              const ok     = task.last_run?.exit_code === 0
              const hasRun = task.last_run != null
              const overdue= task.next_run && task.next_run * 1000 < Date.now() && task.enabled
              return (
                <div key={task.id} className="flex items-center gap-2 rounded px-2 py-1.5"
                  style={{background:'var(--color-surface)'}}>
                  <div className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0',
                    !task.enabled?'bg-jet-muted': overdue?'bg-yellow-500': !hasRun?'bg-jet-cyan': ok?'bg-jet-green':'bg-jet-red'
                  )}/>
                  <span className="font-mono text-[10px] flex-1 truncate"
                    style={{color:task.enabled?'var(--color-text)':'var(--color-dim)'}}>{task.name}</span>
                  {hasRun && <span className="font-mono text-[9px]" style={{color:ok?'#3fb950':'#f85149'}}>{ok?'✓':'✗'}</span>}
                  <span className="font-mono text-[9px]" style={{color:overdue?'#d29922':'var(--color-dim)'}}>
                    {task.enabled ? formatNext(task.next_run) : 'off'}
                  </span>
                </div>
              )
            })}
            {total > 5 && <div className="font-mono text-[9px] text-center pt-1" style={{color:'var(--color-dim)'}}>+{total-5} more</div>}
          </div>
      }
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { metrics, hardware, history } = useMetricsStore()

  const sys      = metrics?.system || {}
  const gpu      = metrics?.gpu    || {}
  const cpu      = sys.cpu         || {}
  const mem      = sys.memory      || {}
  const storage  = sys.storage     || {}
  const network  = sys.network     || {}
  const thermals = sys.thermals    || {}
  const sysInfo  = sys.system      || {}

  const cpuPercent = cpu.usage_percent       || 0
  const gpuPercent = gpu.utilization_percent || 0
  const memPercent = mem.percent             || 0

  const partitions  = storage.partitions || []
  const rootPart    = partitions.find(p => p.mountpoint === '/') || partitions[0] || {}
  const diskPercent = rootPart.percent || 0

  const sensors   = thermals.sensors || {}
  const temps     = Object.values(sensors).map(s => s.temp_c)
  const maxTemp   = temps.length > 0 ? Math.max(...temps) : null
  const tempColor = maxTemp > 80 ? '#f85149' : maxTemp > 60 ? '#d29922' : '#3fb950'
  const interfaces = network.interfaces || {}

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold tracking-widest" style={{color:'var(--color-text)'}}>
            {hardware?.model || 'NVIDIA JETSON'}
          </h1>
          <p className="font-mono text-xs mt-1" style={{color:'var(--color-dim)'}}>
            {sysInfo.hostname || '--'} &nbsp;·&nbsp; {sysInfo.os || 'Linux'} &nbsp;·&nbsp; Uptime: {formatUptime(sysInfo.uptime_seconds)}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {hardware?.cuda_version    && <span className="badge badge-cyan">CUDA {hardware.cuda_version}</span>}
          {hardware?.jetpack_version && <span className="badge badge-cyan">JetPack {hardware.jetpack_version}</span>}
          {hardware?.ai_frameworks?.pytorch && <span className="badge badge-green">PyTorch {hardware.ai_frameworks.pytorch}</span>}
        </div>
      </div>

      {/* ── Layout: left column (narrow) + right column (wide) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4 items-start">

        {/* ── LEFT COLUMN ── */}
        <div className="space-y-4">

          {/* CPU summary */}
          <div className="card scanline">
            <div className="card-header">
              <span className="card-title flex items-center gap-2"><Cpu size={12}/> CPU</span>
              <span className="font-display text-lg font-bold" style={{color:getUsageColor(cpuPercent)}}>
                {cpuPercent.toFixed(1)}<span className="font-mono text-[10px] ml-0.5" style={{color:'var(--color-dim)'}}>%</span>
              </span>
            </div>
            <ProgressBar percent={cpuPercent} color={getUsageColor(cpuPercent)} className="mb-2"/>
            <MiniAreaChart data={history.cpu} color={getUsageColor(cpuPercent)} height={35}/>
            <div className="mt-2 space-y-1">
              {(cpu.per_core_usage || []).map((usage, i) => (
                <CoreBar key={i} index={i} usage={usage} freq={cpu.per_core_freq?.[i]?.current}/>
              ))}
            </div>
            {cpu.load_avg && (
              <div className="font-mono text-[9px] mt-2" style={{color:'var(--color-dim)'}}>
                Load: {cpu.load_avg['1min']} / {cpu.load_avg['5min']} / {cpu.load_avg['15min']}
              </div>
            )}
          </div>

          {/* GPU summary */}
          <div className="card scanline">
            <div className="card-header">
              <span className="card-title flex items-center gap-2"><Zap size={12}/> GPU</span>
              <span className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>{formatFreq(gpu.freq_mhz)}</span>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <UsageGauge percent={gpuPercent} size={52}/>
              <div>
                <div className="font-display text-xl font-bold" style={{color:getUsageColor(gpuPercent)}}>
                  {gpuPercent.toFixed(1)}%
                </div>
                <div className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>
                  {gpu.temperature_c !== undefined && `${gpu.temperature_c}°C`}
                  {gpu.power_mw && ` · ${(gpu.power_mw/1000).toFixed(1)}W`}
                </div>
              </div>
            </div>
            <MiniAreaChart data={history.gpu} color={getUsageColor(gpuPercent)} height={35}/>
          </div>

          {/* Memory */}
          <div className="card">
            <div className="card-header">
              <span className="card-title flex items-center gap-2"><MemoryStick size={12}/> MEMORY</span>
              <span className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>
                {formatBytes(mem.used)} / {formatBytes(mem.total)}
              </span>
            </div>
            <ProgressBar percent={memPercent} className="mb-1"/>
            {mem.swap && <>
              <div className="flex justify-between text-[10px] font-mono mt-2 mb-1" style={{color:'var(--color-dim)'}}>
                <span>SWAP</span><span>{formatBytes(mem.swap.used)} / {formatBytes(mem.swap.total)}</span>
              </div>
              <ProgressBar percent={mem.swap.percent} color="#bc8cff"/>
            </>}
            <MiniAreaChart data={history.memory} color={getUsageColor(memPercent)} height={30} className="mt-2"/>
          </div>

          {/* Battery */}
          <BatteryCard/>

        </div>{/* end left column */}

        {/* ── RIGHT COLUMN ── */}
        <div className="space-y-4">

          {/* Network */}
          <div className="card">
            <div className="card-header">
              <span className="card-title flex items-center gap-2"><Network size={12}/> NETWORK</span>
            </div>
            <div className="space-y-2 mb-3">
              {Object.entries(interfaces).map(([iface, data]) => (
                <div key={iface} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={clsx('w-1.5 h-1.5 rounded-full', data.is_up ? 'bg-jet-green' : 'bg-jet-muted')}/>
                    <span className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>{iface}</span>
                    {data.ip && <span className="font-mono text-[10px]" style={{color:'var(--color-cyan)'}}>{data.ip}</span>}
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[10px]" style={{color:'var(--color-green)'}}>↓ {formatBytesPerSec(data.rx_bytes_sec)}</div>
                    <div className="font-mono text-[10px]" style={{color:'var(--color-cyan)'}}>↑ {formatBytesPerSec(data.tx_bytes_sec)}</div>
                  </div>
                </div>
              ))}
            </div>
            <MiniAreaChart data={history.network_rx} color="#3fb950" height={35}/>
          </div>

          {/* Thermals + Storage side by side */}
          <div className="grid grid-cols-2 gap-4">

            {/* Thermals */}
            <div className="card">
              <div className="card-header">
                <span className="card-title flex items-center gap-2"><Thermometer size={12}/> THERMALS</span>
                {maxTemp && <span className="font-mono text-sm font-bold" style={{color:tempColor}}>{maxTemp.toFixed(1)}°C</span>}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.entries(sensors).slice(0, 6).map(([name, data]) => (
                  <div key={name} className="rounded p-2" style={{background:'var(--color-surface)'}}>
                    <div className="font-mono text-[9px] truncate" style={{color:'var(--color-dim)'}}>{data.type || name}</div>
                    <div className="font-mono text-sm font-bold mt-0.5"
                      style={{color: data.temp_c > 80 ? '#f85149' : data.temp_c > 60 ? '#d29922' : 'var(--color-text)'}}>
                      {data.temp_c.toFixed(1)}°C
                    </div>
                  </div>
                ))}
              </div>
              {thermals.fan_speed != null && (
                <div className="flex justify-between mt-2 font-mono text-[10px]" style={{color:'var(--color-dim)'}}>
                  <span>FAN</span><span>{thermals.fan_speed} RPM</span>
                </div>
              )}
            </div>

            {/* Storage */}
            <div className="card">
              <div className="card-header">
                <span className="card-title flex items-center gap-2"><HardDrive size={12}/> STORAGE</span>
                <span className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>{diskPercent.toFixed(1)}%</span>
              </div>
              <div className="space-y-2">
                {partitions.map(part => (
                  <div key={part.mountpoint} className="rounded p-2" style={{background:'var(--color-surface)'}}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-mono text-xs" style={{color:'var(--color-text)'}}>{part.mountpoint}</span>
                      <span className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>{part.device}</span>
                    </div>
                    <ProgressBar percent={part.percent} className="mb-1"/>
                    <div className="flex justify-between font-mono text-[10px]" style={{color:'var(--color-dim)'}}>
                      <span>{formatBytes(part.used)}</span>
                      <span>{part.percent?.toFixed(1)}%</span>
                      <span>{formatBytes(part.total)}</span>
                    </div>
                  </div>
                ))}
                {!partitions.length && (
                  <div className="font-mono text-xs py-2 text-center" style={{color:'var(--color-dim)'}}>No partitions</div>
                )}
              </div>
            </div>

          </div>{/* end thermals+storage grid */}

          {/* Scheduler */}
          <SchedulerCard/>

        </div>{/* end right column */}

      </div>
    </div>
  )
}
