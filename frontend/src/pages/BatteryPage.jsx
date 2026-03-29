/**
 * BatteryPage — INA219 battery monitor for WaveShare JetBot
 * Shows voltage, current, power and historical charts
 */
import { useState, useEffect, useCallback } from 'react'
import { Battery, BatteryLow, BatteryFull, BatteryMedium, BatteryCharging, Zap, RefreshCw, Activity, PlugZap } from 'lucide-react'
import { apiFetch } from '../utils/format'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

function BatteryIcon({ state, charging, size = 24, color }) {
  const props = { size, color }
  if (charging)                             return <BatteryCharging {...props} />
  if (state === 'full' || state === 'good') return <BatteryFull {...props} />
  if (state === 'low')                      return <BatteryMedium {...props} />
  return <BatteryLow {...props} />
}

function PercentGauge({ percent, color }) {
  return (
    <div className="relative h-4 rounded-full overflow-hidden"
         style={{ background: 'var(--color-border)' }}>
      <div className="h-full rounded-full transition-all duration-700"
           style={{ width: `${percent}%`, background: color }} />
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold"
            style={{ color: 'var(--color-text)' }}>
        {percent}%
      </span>
    </div>
  )
}

function MetricCard({ label, value, unit, icon: Icon, color, sub }) {
  return (
    <div className="card text-center space-y-2">
      <div className="flex items-center justify-center gap-2">
        {Icon && <Icon size={14} style={{ color }} />}
        <span className="card-title">{label}</span>
      </div>
      <div className="font-display text-3xl font-bold" style={{ color }}>{value}</div>
      <div className="font-mono text-xs" style={{ color: 'var(--color-dim)' }}>{unit}</div>
      {sub && <div className="font-mono text-[10px]" style={{ color: 'var(--color-muted)' }}>{sub}</div>}
    </div>
  )
}

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null
  return (
    <div className="px-3 py-2 rounded-lg border font-mono text-xs"
         style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
      <div style={{ color: 'var(--color-dim)' }}>
        {new Date(label * 1000).toLocaleTimeString('en', { hour12: false })}
      </div>
      <div className="font-bold" style={{ color: payload[0].color }}>
        {payload[0].value?.toFixed(2)} {unit}
      </div>
    </div>
  )
}

export default function BatteryPage() {
  const [status,  setStatus]  = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        apiFetch('/battery/status'),
        apiFetch('/battery/history'),
      ])
      setStatus(s)
      setHistory(h.history || [])
    } catch(e) {
      console.error('Battery load error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 2000)
    return () => clearInterval(interval)
  }, [load])

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--color-dim)' }} />
    </div>
  )

  if (status && !status.available) return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Battery size={18} style={{ color: 'var(--color-dim)' }} />
        <h1 className="font-display text-lg font-bold tracking-widest">BATTERY</h1>
      </div>
      <div className="card text-center py-12 space-y-4">
        <BatteryLow size={40} className="mx-auto" style={{ color: 'var(--color-muted)' }} />
        <p className="font-mono text-sm font-bold" style={{ color: 'var(--color-dim)' }}>
          INA219 sensor not detected
        </p>
        <p className="font-mono text-xs" style={{ color: 'var(--color-muted)' }}>
          {status.error}
        </p>
        <p className="font-mono text-[10px]" style={{ color: 'var(--color-muted)' }}>
          Expected at I2C bus 1, address 0x41
        </p>
        <button onClick={load} className="btn-ghost mx-auto">
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    </div>
  )

  const color           = status?.color            || '#3fb950'
  const state           = status?.state            || 'unknown'
  const percent         = status?.percent          ?? 0
  const voltage         = status?.voltage          ?? 0
  const current         = status?.current          ?? null
  const power           = status?.power            ?? null
  const charging        = status?.charging         ?? null
  const currentReliable = status?.current_reliable ?? false

  const stateLabel = charging
    ? '⚡ Charging'
    : {
        full:     'Fully charged',
        good:     'Good',
        low:      '⚠ Low — consider charging',
        critical: '🔴 Critical — charge immediately',
        depleted: '🔴 Depleted',
      }[state] || state

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Battery size={18} style={{ color: 'var(--color-dim)' }} />
          <h1 className="font-display text-lg font-bold tracking-widest"
              style={{ color: 'var(--color-text)' }}>BATTERY</h1>
          <span className="badge font-mono text-[10px]"
                style={{
                  background: charging ? 'rgba(88,166,255,0.12)' : `${color}18`,
                  color: charging ? '#58a6ff' : color,
                  border: `1px solid ${charging ? 'rgba(88,166,255,0.4)' : color+'40'}`,
                }}>
            {stateLabel}
          </span>
        </div>
        <span className="font-mono text-[10px]" style={{ color: 'var(--color-muted)' }}>
          Updates every 2s · INA219 @ 0x41
        </span>
      </div>

      {/* Big gauge */}
      <div className="card">
        <div className="flex items-center gap-4 mb-4">
          <BatteryIcon state={state} charging={charging} size={32} color={color} />
          <div className="flex-1">
            <div className="font-display text-4xl font-bold mb-1" style={{ color }}>
              {voltage.toFixed(2)} V
            </div>
            <div className="font-mono text-xs" style={{ color: 'var(--color-dim)' }}>
              Battery pack voltage · 3× 18650 Li-Ion
            </div>
          </div>
          <div className="font-display text-3xl font-bold" style={{ color }}>
            {percent}%
          </div>
        </div>
        <PercentGauge percent={percent} color={color} />
        <div className="flex justify-between mt-2 font-mono text-[10px]"
             style={{ color: 'var(--color-muted)' }}>
          <span>Critical 9.5V</span>
          <span>Low 10.5V</span>
          <span>Good 11.5V</span>
          <span>Full 12.4V</span>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="CURRENT"
          value={currentReliable && current !== null ? current.toFixed(0) : '—'}
          unit={currentReliable ? "milliamps (mA)" : "battery mode"}
          icon={Activity}
          color={currentReliable ? "var(--color-cyan)" : "var(--color-muted)"}
          sub={currentReliable ? '⚡ Charging current' : 'Connect charger to measure'}
        />
        <MetricCard
          label="POWER"
          value={currentReliable && power !== null ? power.toFixed(2) : '—'}
          unit={currentReliable ? "watts (W)" : "battery mode"}
          icon={Zap}
          color={currentReliable ? "var(--color-purple)" : "var(--color-muted)"}
          sub={currentReliable ? `${((voltage * current)/1000).toFixed(2)}W input` : 'Connect charger to measure'}
        />
        <MetricCard
          label="VOLTAGE"
          value={voltage.toFixed(3)}
          unit="volts (V)"
          icon={Battery}
          color={color}
          sub={stateLabel}
        />
      </div>

      {/* Charts */}
      {/* Voltage history — always shown when data available */}
      {history.length > 1 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2">
              <Battery size={12} /> VOLTAGE HISTORY
            </span>
            <span className="font-mono text-[10px]" style={{ color: 'var(--color-dim)' }}>
              last {history.length * 2}s
            </span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="voltGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
              <XAxis dataKey="ts" hide />
              <YAxis domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: 'var(--color-dim)', fontFamily: 'monospace' }}
                width={42} tickFormatter={v => `${v.toFixed(1)}V`} />
              <Tooltip content={<ChartTooltip unit="V" />} />
              <Area type="monotone" dataKey="voltage" stroke={color} strokeWidth={2}
                fill="url(#voltGrad)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Pack info */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">BATTERY PACK INFO</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Cells',    value: '3× 18650' },
            { label: 'Chemistry', value: 'Li-Ion' },
            { label: 'Full',     value: '12.4 – 12.6V' },
            { label: 'Critical', value: '< 9.5V' },
          ].map(({ label, value }) => (
            <div key={label} className="rounded p-3" style={{ background: 'var(--color-surface)' }}>
              <div className="font-mono text-[10px] mb-1" style={{ color: 'var(--color-dim)' }}>
                {label}
              </div>
              <div className="font-mono text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
