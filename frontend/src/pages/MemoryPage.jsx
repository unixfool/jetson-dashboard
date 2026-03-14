// Memory Page
import { useMetricsStore } from '../store/metricsStore'
import { MiniAreaChart, MultiLineChart, ProgressBar, UsageGauge } from '../components/charts/Charts'
import { formatBytes, getUsageColor } from '../utils/format'
import { MemoryStick } from 'lucide-react'

export function MemoryPage() {
  const { metrics, history } = useMetricsStore()
  const mem = metrics?.system?.memory || {}
  const swap = mem.swap || {}
  const chartData = history.memory.map(p => ({ t: p.t, mem: p.v }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <MemoryStick size={18} className="text-jet-purple" />
        <h1 className="font-display text-lg font-bold tracking-widest">MEMORY</h1>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'TOTAL', value: formatBytes(mem.total), color: '#58a6ff' },
          { label: 'USED', value: formatBytes(mem.used), color: getUsageColor(mem.percent) },
          { label: 'FREE', value: formatBytes(mem.free), color: '#3fb950' },
          { label: 'CACHED', value: formatBytes(mem.cached), color: '#bc8cff' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <div className="card-title mb-2">{label}</div>
            <div className="font-display text-xl font-bold" style={{ color }}>{value || '--'}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card flex flex-col items-center py-6">
          <div className="relative mb-4">
            <UsageGauge percent={mem.percent} size={120} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-xl font-bold" style={{ color: getUsageColor(mem.percent) }}>
                {(mem.percent || 0).toFixed(1)}%
              </span>
              <span className="font-mono text-[9px] text-jet-dim">RAM</span>
            </div>
          </div>
          <div className="font-mono text-xs text-jet-dim text-center">
            {formatBytes(mem.used)} / {formatBytes(mem.total)}
          </div>
        </div>
        <div className="card lg:col-span-2">
          <div className="card-header"><span className="card-title">MEMORY HISTORY</span></div>
          <MultiLineChart data={chartData} lines={[{ key: 'mem', color: getUsageColor(mem.percent), name: 'RAM %' }]}
            height={140} yDomain={[0, 100]} formatter={v => `${v.toFixed(1)}%`} />
        </div>
      </div>
      {swap.total > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">SWAP MEMORY</span>
            <span className="font-mono text-[10px] text-jet-dim">{formatBytes(swap.used)} / {formatBytes(swap.total)}</span>
          </div>
          <ProgressBar percent={swap.percent} color="#bc8cff" className="mb-2" />
          <div className="font-mono text-[10px] text-jet-dim">{(swap.percent || 0).toFixed(1)}% used</div>
        </div>
      )}
    </div>
  )
}

export default MemoryPage
