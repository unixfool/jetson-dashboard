import { useState } from 'react'
import { useMetricsStore } from '../store/metricsStore'
import { MiniAreaChart, MultiLineChart, UsageGauge, ProgressBar } from '../components/charts/Charts'
import { formatFreq, formatTemp, getUsageColor, apiFetch } from '../utils/format'
import { Zap, Settings, Power } from 'lucide-react'

export default function GPUPage() {
  const { metrics, hardware, history } = useMetricsStore()
  const gpu = metrics?.gpu || {}
  const [powerLoading, setPowerLoading] = useState(false)
  const [clocksLoading, setClocksLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  const gpuPercent = gpu.utilization_percent || 0
  const color = getUsageColor(gpuPercent)

  const powerModes = hardware?.max_power_modes ? [] : []

  const handleSetPowerMode = async (modeId) => {
    setPowerLoading(true)
    try {
      await apiFetch('/hardware/power-mode', {
        method: 'POST',
        body: JSON.stringify({ mode_id: modeId }),
      })
      setStatusMsg(`Power mode ${modeId} applied`)
    } catch (e) {
      setStatusMsg(`Error: ${e.message}`)
    } finally {
      setPowerLoading(false)
    }
  }

  const handleJetsonClocks = async (enable) => {
    setClocksLoading(true)
    try {
      await apiFetch(`/hardware/jetson-clocks/${enable ? 'enable' : 'disable'}`, { method: 'POST' })
      setStatusMsg(`jetson_clocks ${enable ? 'enabled' : 'disabled'}`)
    } catch (e) {
      setStatusMsg(`Error: ${e.message}`)
    } finally {
      setClocksLoading(false)
    }
  }

  const chartData = history.gpu.map(p => ({ t: p.t, gpu: p.v }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Zap size={18} className="text-jet-yellow" />
        <h1 className="font-display text-lg font-bold tracking-widest">GPU / CUDA MONITOR</h1>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'GPU LOAD', value: `${gpuPercent.toFixed(1)}%`, color },
          { label: 'FREQ', value: formatFreq(gpu.freq_mhz) || '--', color: '#58a6ff' },
          { label: 'TEMPERATURE', value: formatTemp(gpu.temperature_c), color: getUsageColor((gpu.temperature_c / 100) * 100) },
          { label: 'POWER', value: (() => {
            // Sumar todos los rails de potencia INA3221
            const rails = gpu.power || {}
            const keys = Object.keys(rails)
            if (keys.length === 0) return '--'
            const total = keys.reduce((s, k) => s + (rails[k]?.watts || 0), 0)
            return total > 0 ? `${total.toFixed(1)}W` : '--'
          })(), color: '#bc8cff' },
        ].map(({ label, value, color: c }) => (
          <div key={label} className="card text-center">
            <div className="card-title mb-2">{label}</div>
            <div className="font-display text-xl font-bold" style={{ color: c }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Gauge */}
        <div className="card flex flex-col items-center py-6">
          <div className="relative mb-4">
            <UsageGauge percent={gpuPercent} size={130} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-2xl font-bold" style={{ color }}>
                {gpuPercent.toFixed(1)}%
              </span>
              <span className="font-mono text-[9px] text-jet-dim">GPU</span>
            </div>
          </div>
          <div className="text-center space-y-1">
            <div className="font-mono text-[10px] text-jet-dim">
              {hardware?.gpu_cores ? `${hardware.gpu_cores} CUDA Cores` : 'NVIDIA GPU'}
            </div>
            {hardware?.cuda_version && (
              <div className="font-mono text-[10px] text-jet-cyan">
                CUDA {hardware.cuda_version}
              </div>
            )}
            {hardware?.tensorrt_version && (
              <div className="font-mono text-[10px] text-jet-purple">
                TensorRT {hardware.tensorrt_version}
              </div>
            )}
          </div>
        </div>

        {/* History */}
        <div className="card lg:col-span-2">
          <div className="card-header">
            <span className="card-title">GPU USAGE HISTORY</span>
          </div>
          <MultiLineChart
            data={chartData}
            lines={[{ key: 'gpu', color, name: 'GPU %' }]}
            height={140}
            yDomain={[0, 100]}
            formatter={v => `${v.toFixed(1)}%`}
          />
        </div>
      </div>

      {/* Power info */}
      {gpu.power && Object.keys(gpu.power).length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2"><Power size={12} /> POWER RAILS</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(gpu.power).map(([rail, data]) => (
              <div key={rail} className="bg-jet-surface rounded p-3">
                <div className="font-mono text-[9px] text-jet-dim mb-1">{rail}</div>
                <div className="font-mono text-sm font-bold text-jet-purple">
                  {data.watts !== undefined ? `${data.watts}W` : `${data.current_mw}mW`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Jetson controls */}
      <div className="card">
        <div className="card-header">
          <span className="card-title flex items-center gap-2"><Settings size={12} /> JETSON CONTROLS</span>
          {statusMsg && (
            <span className="font-mono text-[10px] text-jet-green">{statusMsg}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-jet-dim">Power Mode:</span>
            <span className="font-mono text-xs font-bold text-jet-cyan">
              {gpu.nvpmodel?.mode || 'N/A'}
            </span>
          </div>
          <button
            onClick={() => handleJetsonClocks(true)}
            disabled={clocksLoading}
            className="btn-primary"
          >
            {clocksLoading ? '...' : 'Enable jetson_clocks'}
          </button>
          <button
            onClick={() => handleJetsonClocks(false)}
            disabled={clocksLoading}
            className="btn-ghost"
          >
            Disable jetson_clocks
          </button>
        </div>
      </div>

      {/* AI Frameworks */}
      {hardware?.ai_frameworks && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">AI FRAMEWORKS</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {Object.entries(hardware.ai_frameworks).map(([name, version]) => (
              <div key={name} className={`px-3 py-2 rounded border font-mono text-xs ${
                version
                  ? 'bg-jet-green/10 border-jet-green/30 text-jet-green'
                  : 'bg-jet-muted/10 border-jet-border text-jet-muted'
              }`}>
                <div className="capitalize font-semibold">{name}</div>
                <div className="text-[10px] mt-0.5">{version || 'Not installed'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
