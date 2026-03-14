import { useMetricsStore } from '../store/metricsStore'
import {
  MiniAreaChart, UsageGauge, ProgressBar, StatCard, CoreBar
} from '../components/charts/Charts'
import {
  formatBytes, formatBytesPerSec, formatTemp, formatUptime,
  getUsageColor, getUsageColorClass, formatFreq
} from '../utils/format'
import {
  Cpu, Zap, MemoryStick, HardDrive, Network,
  Thermometer, Activity, Server, Shield, AlertTriangle
} from 'lucide-react'
import clsx from 'clsx'

function QuickMetric({ icon: Icon, label, value, percent, color, chart, unit }) {
  return (
    <div className="card scanline">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon size={14} style={{ color }} />
          <span className="card-title">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-display text-lg font-bold" style={{ color }}>
            {value}
          </span>
          {unit && <span className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>{unit}</span>}
        </div>
      </div>
      {percent !== undefined && (
        <ProgressBar percent={percent} color={color} className="mb-2" />
      )}
      {chart && (
        <MiniAreaChart data={chart} color={color} height={40} />
      )}
    </div>
  )
}

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

  const cpuPercent = cpu.usage_percent || 0
  const gpuPercent = gpu.utilization_percent || 0
  const memPercent = mem.percent || 0

  const partitions = storage.partitions || []
  const rootPart   = partitions.find(p => p.mountpoint === '/') || partitions[0] || {}
  const diskPercent = rootPart.percent || 0

  const sensors  = thermals.sensors || {}
  const temps    = Object.values(sensors).map(s => s.temp_c)
  const maxTemp  = temps.length > 0 ? Math.max(...temps) : null
  const tempColor = maxTemp > 80 ? '#f85149' : maxTemp > 60 ? '#d29922' : '#3fb950'

  const interfaces = network.interfaces || {}

  return (
    <div className="space-y-4">

      {/* Device header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold tracking-widest" style={{color:'var(--color-text)'}}>
            {hardware?.model || 'NVIDIA JETSON'}
          </h1>
          <p className="font-mono text-xs mt-1" style={{color:'var(--color-dim)'}}>
            {sysInfo.hostname || '--'} &nbsp;·&nbsp;
            {sysInfo.os || 'Linux'} &nbsp;·&nbsp;
            Uptime: {formatUptime(sysInfo.uptime_seconds)}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {hardware?.cuda_version    && <span className="badge badge-cyan">CUDA {hardware.cuda_version}</span>}
          {hardware?.jetpack_version && <span className="badge badge-cyan">JetPack {hardware.jetpack_version}</span>}
          {hardware?.ai_frameworks?.pytorch && <span className="badge badge-green">PyTorch {hardware.ai_frameworks.pytorch}</span>}
        </div>
      </div>

      {/* Quick metrics row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickMetric icon={Cpu}        label="CPU"    value={cpuPercent.toFixed(1)}  unit="%" percent={cpuPercent}  color={getUsageColor(cpuPercent)}  chart={history.cpu} />
        <QuickMetric icon={Zap}        label="GPU"    value={gpuPercent.toFixed(1)}  unit="%" percent={gpuPercent}  color={getUsageColor(gpuPercent)}  chart={history.gpu} />
        <QuickMetric icon={MemoryStick} label="Memory" value={memPercent.toFixed(1)} unit="%" percent={memPercent}  color={getUsageColor(memPercent)}  chart={history.memory} />
        <QuickMetric icon={HardDrive}  label="Disk"   value={diskPercent.toFixed(1)} unit="%" percent={diskPercent} color={getUsageColor(diskPercent)} />
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">

        {/* Col 1: CPU CORES */}
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2">
              <Cpu size={12} /> CPU CORES
            </span>
            <span className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>
              {cpu.load_avg?.['1min']} / {cpu.load_avg?.['5min']} / {cpu.load_avg?.['15min']} load
            </span>
          </div>
          <div className="space-y-1.5">
            {(cpu.per_core_usage || []).map((usage, i) => (
              <CoreBar key={i} index={i} usage={usage} freq={cpu.per_core_freq?.[i]?.current} />
            ))}
            {!cpu.per_core_usage?.length && (
              <div className="font-mono text-xs py-4 text-center" style={{color:'var(--color-dim)'}}>
                Waiting for data...
              </div>
            )}
          </div>
        </div>

        {/* Col 2: GPU */}
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2"><Zap size={12} /> GPU</span>
            <span className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>{formatFreq(gpu.freq_mhz)}</span>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <UsageGauge percent={gpuPercent} size={64} />
            <div className="flex-1">
              <div className="font-display text-2xl font-bold" style={{ color: getUsageColor(gpuPercent) }}>
                {gpuPercent.toFixed(1)}%
              </div>
              <div className="font-mono text-[10px] mt-1" style={{color:'var(--color-dim)'}}>
                {gpu.temperature_c !== undefined && `${gpu.temperature_c}°C`}
                {gpu.power_mw && ` · ${(gpu.power_mw / 1000).toFixed(1)}W`}
              </div>
              <div className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>
                {gpu.nvpmodel?.mode && `Mode: ${gpu.nvpmodel.mode}`}
              </div>
            </div>
          </div>
          <MiniAreaChart data={history.gpu} color={getUsageColor(gpuPercent)} height={40} />
        </div>

        {/* Col 3: NETWORK */}
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2"><Network size={12} /> NETWORK</span>
          </div>
          <div className="space-y-2 mb-3">
            {Object.entries(interfaces).map(([iface, data]) => (
              <div key={iface} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={clsx('w-1.5 h-1.5 rounded-full', data.is_up ? 'bg-jet-green' : 'bg-jet-muted')} />
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
          <MiniAreaChart data={history.network_rx} color="#3fb950" height={35} />
        </div>

        {/* Col 1: MEMORY */}
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2"><MemoryStick size={12} /> MEMORY</span>
            <span className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>
              {formatBytes(mem.used)} / {formatBytes(mem.total)}
            </span>
          </div>
          <ProgressBar percent={memPercent} className="mb-1" />
          {mem.swap && (
            <>
              <div className="flex justify-between text-[10px] font-mono mt-2 mb-1" style={{color:'var(--color-dim)'}}>
                <span>SWAP</span>
                <span>{formatBytes(mem.swap.used)} / {formatBytes(mem.swap.total)}</span>
              </div>
              <ProgressBar percent={mem.swap.percent} color="#bc8cff" />
            </>
          )}
        </div>

        {/* Col 2: THERMALS */}
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2"><Thermometer size={12} /> THERMALS</span>
            {maxTemp && (
              <span className="font-mono text-sm font-bold" style={{ color: tempColor }}>
                {maxTemp.toFixed(1)}°C
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(sensors).slice(0, 6).map(([name, data]) => (
              <div key={name} className="rounded p-2" style={{background:'var(--color-surface)'}}>
                <div className="font-mono text-[9px] truncate" style={{color:'var(--color-dim)'}}>{data.type || name}</div>
                <div className="font-mono text-sm font-bold mt-0.5"
                  style={{ color: data.temp_c > 80 ? '#f85149' : data.temp_c > 60 ? '#d29922' : 'var(--color-text)' }}>
                  {data.temp_c.toFixed(1)}°C
                </div>
              </div>
            ))}
          </div>
          {thermals.fan_speed !== null && thermals.fan_speed !== undefined && (
            <div className="flex justify-between items-center mt-3 font-mono text-[10px]" style={{color:'var(--color-dim)'}}>
              <span>FAN</span>
              <span>{thermals.fan_speed} RPM</span>
            </div>
          )}
        </div>

        {/* Col 3: STORAGE */}
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2">
              <HardDrive size={12} /> STORAGE
            </span>
          </div>
          <div className="space-y-3">
            {partitions.map((part) => (
              <div key={part.mountpoint} className="rounded p-3" style={{background:'var(--color-surface)'}}>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="font-mono text-xs" style={{color:'var(--color-text)'}}>{part.mountpoint}</span>
                  <span className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>{part.device}</span>
                </div>
                <ProgressBar percent={part.percent} className="mb-1" />
                <div className="flex justify-between font-mono text-[10px] mt-1" style={{color:'var(--color-dim)'}}>
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

      </div>{/* fin main grid */}


    </div>
  )
}
