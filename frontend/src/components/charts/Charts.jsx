import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import { getUsageColor } from '../../utils/format'

const CustomTooltip = ({ active, payload, formatter }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-jet-card border border-jet-border rounded px-2 py-1.5 text-xs font-mono shadow-xl">
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span style={{ color: p.color }}>{p.name || 'Value'}:</span>
          <span className="text-jet-text">
            {formatter ? formatter(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export function MiniAreaChart({ data, color = '#58a6ff', formatter, height = 60 }) {
  // Usar indice como eje X para evitar problemas con timestamps grandes
  const normalized = (data || []).map((d, i) => ({
    i,
    v: typeof d === 'object' && 'v' in d ? d.v : d
  }))
  const gradId = `grad-${color.replace('#', '')}`
  // Calcular dominio dinamico con algo de padding
  const values = normalized.map(d => d.v).filter(v => typeof v === 'number' && !isNaN(v))
  const minVal = values.length > 0 ? Math.min(...values) : 0
  const maxVal = values.length > 0 ? Math.max(...values) : 100
  const padding = Math.max((maxVal - minVal) * 0.1, 1)
  const domain = [Math.max(0, minVal - padding), maxVal + padding]

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={normalized} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="i" hide type="number" domain={['dataMin', 'dataMax']} />
        <YAxis hide domain={domain} />
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradId})`}
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip
          content={<CustomTooltip formatter={formatter} />}
          cursor={{ stroke: color, strokeWidth: 1, opacity: 0.3 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function MultiLineChart({ data, lines, height = 120, yDomain = [0, 100], formatter }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
        <XAxis dataKey="t" hide />
        <YAxis domain={yDomain} tick={{ fontSize: 10, fill: '#7d8590', fontFamily: 'JetBrains Mono' }} width={28} />
        <Tooltip content={<CustomTooltip formatter={formatter} />} />
        {lines.map(({ key, color, name }) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            name={name || key}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function UsageGauge({ percent, size = 80 }) {
  const color = getUsageColor(percent)
  const radius = (size - 8) / 2
  const circumference = 2 * Math.PI * radius
  const dashArray = circumference
  const dashOffset = circumference * (1 - (percent || 0) / 100)

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#21262d"
        strokeWidth={6}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeDasharray={dashArray}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.7s ease-out, stroke 0.3s' }}
        filter={`drop-shadow(0 0 4px ${color})`}
      />
    </svg>
  )
}

export function ProgressBar({ percent, color, className = '', showLabel = false }) {
  const barColor = color || getUsageColor(percent)
  return (
    <div className={`gauge-bar ${className}`}>
      <div
        className="gauge-fill"
        style={{
          width: `${Math.min(100, percent || 0)}%`,
          backgroundColor: barColor,
          boxShadow: `0 0 6px ${barColor}40`,
        }}
      />
    </div>
  )
}

export function StatCard({ title, value, unit, color = '#58a6ff', children, trend }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{title}</span>
        {trend !== undefined && (
          <span className={`font-mono text-[10px] ${trend >= 0 ? 'text-jet-green' : 'text-jet-red'}`}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      {value !== undefined && (
        <div className="flex items-baseline gap-1 mb-3">
          <span className="metric-value" style={{ color }}>{value}</span>
          {unit && <span className="metric-unit">{unit}</span>}
        </div>
      )}
      {children}
    </div>
  )
}

export function CoreBar({ index, usage, freq }) {
  const color = getUsageColor(usage)
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] text-jet-dim w-8">C{index}</span>
      <div className="flex-1 gauge-bar">
        <div
          className="gauge-fill"
          style={{
            width: `${usage || 0}%`,
            backgroundColor: color,
          }}
        />
      </div>
      <span className="font-mono text-[10px] text-jet-dim w-12 text-right">
        {(usage || 0).toFixed(0)}%
      </span>
      {freq && (
        <span className="font-mono text-[10px] text-jet-muted w-16 text-right">
          {freq >= 1000 ? `${(freq/1000).toFixed(1)}G` : `${freq}M`}
        </span>
      )}
    </div>
  )
}
