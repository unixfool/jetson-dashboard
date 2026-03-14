import { useMetricsStore } from '../store/metricsStore'
import { MiniAreaChart, MultiLineChart, UsageGauge, ProgressBar, CoreBar } from '../components/charts/Charts'
import { formatFreq, getUsageColor } from '../utils/format'
import { Cpu } from 'lucide-react'

export default function CPUPage() {
  const { metrics, history } = useMetricsStore()
  const cpu = metrics?.system?.cpu || {}

  const cores = cpu.per_core_usage || []
  const freqs = cpu.per_core_freq || []
  const loadAvg = cpu.load_avg || {}
  const overall = cpu.usage_percent || 0

  // Build multi-core history (simplified: just show overall)
  const chartData = history.cpu.map(p => ({ t: p.t, cpu: p.v }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Cpu size={18} className="text-jet-cyan" />
        <h1 className="font-display text-lg font-bold tracking-widest">CPU MONITOR</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: '1 MIN', value: loadAvg['1min'] },
          { label: '5 MIN', value: loadAvg['5min'] },
          { label: '15 MIN', value: loadAvg['15min'] },
          { label: 'CORES', value: cpu.logical_cores },
        ].map(({ label, value }) => (
          <div key={label} className="card text-center">
            <div className="card-title mb-2">LOAD {label}</div>
            <div className="font-display text-2xl font-bold text-jet-cyan">
              {value ?? '--'}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Gauge */}
        <div className="card flex flex-col items-center justify-center py-6">
          <div className="relative">
            <UsageGauge percent={overall} size={120} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-xl font-bold" style={{ color: getUsageColor(overall) }}>
                {overall.toFixed(1)}%
              </span>
              <span className="font-mono text-[9px] text-jet-dim">OVERALL</span>
            </div>
          </div>
          <div className="mt-4 font-mono text-xs text-jet-dim">
            {cpu.architecture || 'ARM64'} · {cpu.physical_cores}P / {cpu.logical_cores}L cores
          </div>
        </div>

        {/* History chart */}
        <div className="card lg:col-span-2">
          <div className="card-header">
            <span className="card-title">CPU USAGE HISTORY</span>
          </div>
          <MultiLineChart
            data={chartData}
            lines={[{ key: 'cpu', color: getUsageColor(overall), name: 'CPU %' }]}
            height={140}
            yDomain={[0, 100]}
            formatter={v => `${v.toFixed(1)}%`}
          />
        </div>
      </div>

      {/* Per-core breakdown */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">PER-CORE UTILIZATION</span>
          <span className="font-mono text-[10px] text-jet-dim">
            {cpu.logical_cores || 0} logical cores
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {cores.map((usage, i) => (
            <CoreBar
              key={i}
              index={i}
              usage={usage}
              freq={freqs[i]?.current}
            />
          ))}
          {!cores.length && (
            <div className="col-span-2 text-center font-mono text-xs text-jet-dim py-8">
              Collecting CPU data...
            </div>
          )}
        </div>
      </div>

      {/* Frequencies */}
      {freqs.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">CLOCK FREQUENCIES</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {freqs.map((freq, i) => (
              <div key={i} className="bg-jet-surface rounded p-2 text-center">
                <div className="font-mono text-[9px] text-jet-dim mb-1">CORE {i}</div>
                <div className="font-mono text-sm font-bold text-jet-cyan">
                  {formatFreq(freq.current)}
                </div>
                {freq.max > 0 && (
                  <div className="font-mono text-[9px] text-jet-muted mt-0.5">
                    max {formatFreq(freq.max)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
