/**
 * History Page - Gráficas históricas desde SQLite
 * Selector de rango: 1h / 6h / 24h / 3d / 7d / 30d
 */
import { useState, useEffect, useCallback } from 'react'
import { Database, RefreshCw, TrendingUp } from 'lucide-react'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts'
import { apiFetch } from '../utils/format'

// ─── Config ───────────────────────────────────────────────────────────────────

const RANGES = [
  { id: '1h',  label: '1H'  },
  { id: '6h',  label: '6H'  },
  { id: '24h', label: '24H' },
  { id: '3d',  label: '3D'  },
  { id: '7d',  label: '7D'  },
  { id: '30d', label: '30D' },
]

const PANELS = [
  {
    id: 'cpu',
    title: 'CPU Usage',
    unit: '%',
    yDomain: [0, 100],
    color: '#58a6ff',
    metrics: [{ key: 'cpu_percent', label: 'CPU %', color: '#58a6ff' }],
  },
  {
    id: 'cpu_temp',
    title: 'CPU Temperature',
    unit: '°C',
    yDomain: ['auto', 'auto'],
    yPadding: 2,
    color: '#f78166',
    metrics: [{ key: 'cpu_temp', label: 'CPU Temp', color: '#f78166' }],
  },
  {
    id: 'ram',
    title: 'RAM Usage',
    unit: '%',
    yDomain: ['auto', 'auto'],
    yPadding: 5,
    color: '#3fb950',
    metrics: [
      { key: 'ram_percent',  label: 'RAM %',  color: '#3fb950' },
      { key: 'swap_percent', label: 'Swap %', color: '#d29922' },
    ],
  },
  {
    id: 'gpu',
    title: 'GPU Usage',
    unit: '%',
    yDomain: ['auto', 'auto'],
    yPadding: 1,
    color: '#a371f7',
    metrics: [{ key: 'gpu_percent', label: 'GPU %', color: '#a371f7' }],
  },
  {
    id: 'gpu_temp',
    title: 'GPU Temperature',
    unit: '°C',
    yDomain: ['auto', 'auto'],
    yPadding: 2,
    color: '#ff7b72',
    metrics: [{ key: 'gpu_temp', label: 'GPU Temp', color: '#ff7b72' }],
  },
  {
    id: 'network',
    title: 'Network Traffic (primary interface)',
    unit: 'KB/s',
    yDomain: ['auto', 'auto'],
    yPadding: 0.05,
    color: '#39d353',
    metrics: [
      { key: 'net_rx_kbps', label: 'RX KB/s', color: '#39d353' },
      { key: 'net_tx_kbps', label: 'TX KB/s', color: '#58a6ff' },
    ],
  },
  {
    id: 'disk',
    title: 'Disk Usage',
    unit: '%',
    yDomain: ['auto', 'auto'],
    yPadding: 1,
    color: '#d29922',
    metrics: [{ key: 'disk_percent', label: 'Disk %', color: '#d29922' }],
  },
]

// ─── Utils ────────────────────────────────────────────────────────────────────

function formatTs(ts, range) {
  const d = new Date(ts * 1000)
  if (range === '1h' || range === '6h') {
    return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (range === '24h') {
    return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function mergeTimeseries(metricDataMap) {
  // Combinar múltiples series en array de objetos { ts, key1, key2, ... }
  const tsMap = {}
  for (const [key, points] of Object.entries(metricDataMap)) {
    for (const pt of points) {
      if (!tsMap[pt.ts]) tsMap[pt.ts] = { ts: pt.ts }
      tsMap[pt.ts][key] = pt.value
    }
  }
  return Object.values(tsMap).sort((a, b) => a.ts - b.ts)
}

// ─── Chart Panel ──────────────────────────────────────────────────────────────

function ChartPanel({ panel, range, data, loading }) {
  const merged = mergeTimeseries(data)
  const hasData = merged.length > 0

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-jet-surface border border-jet-border rounded p-2 font-mono text-xs shadow-lg">
        <div className="text-jet-dim mb-1">{formatTs(label, range)}</div>
        {payload.map(p => (
          <div key={p.dataKey} style={{ color: p.color }}>
            {p.name}: {p.value != null ? `${Number(p.value).toFixed(1)}${panel.unit}` : '--'}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-xs font-bold tracking-wider text-jet-text">
          {panel.title.toUpperCase()}
        </span>
        {hasData && (() => {
          // Calcular min/max/avg de la primera métrica
          const key = panel.metrics[0].key
          const vals = merged.map(d => d[key]).filter(v => v != null)
          if (!vals.length) return null
          const min = Math.min(...vals)
          const max = Math.max(...vals)
          const avg = vals.reduce((a,b) => a+b, 0) / vals.length
          const isFlat = (max - min) < 0.01
          return (
            <div className="flex items-center gap-3 font-mono text-[10px]">
              <span className="text-jet-muted">
                min <span className="text-jet-dim">{min.toFixed(2)}</span>
              </span>
              <span className="text-jet-muted">
                avg <span className="text-jet-cyan">{avg.toFixed(2)}</span>
              </span>
              <span className="text-jet-muted">
                max <span className="text-jet-dim">{max.toFixed(2)}</span>
              </span>
              {isFlat && (
                <span className="text-jet-muted opacity-60 italic">stable</span>
              )}
            </div>
          )
        })()}
      </div>

      {loading ? (
        <div className="h-32 flex items-center justify-center">
          <div className="font-mono text-xs text-jet-dim animate-pulse">Loading...</div>
        </div>
      ) : !hasData ? (
        <div className="h-32 flex items-center justify-center">
          <div className="font-mono text-xs text-jet-muted">No data for this range yet</div>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={merged} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
            <defs>
              {panel.metrics.map(m => (
                <linearGradient key={m.key} id={`grad_${m.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={m.color} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={m.color} stopOpacity={0}   />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="ts"
              tickFormatter={ts => formatTs(ts, range)}
              tick={{ fontFamily: 'monospace', fontSize: 9, fill: '#484f58' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={panel.yDomain[0] === 'auto'
                ? [
                    (dataMin) => {
                      const pad = panel.yPadding !== undefined
                        ? panel.yPadding
                        : Math.max(1, dataMin * 0.1)
                      return Math.max(0, parseFloat((dataMin - pad).toFixed(3)))
                    },
                    (dataMax) => {
                      const pad = panel.yPadding !== undefined
                        ? panel.yPadding
                        : Math.max(1, dataMax * 0.1)
                      return parseFloat((dataMax + pad).toFixed(3))
                    }
                  ]
                : panel.yDomain}
              tick={{ fontFamily: 'monospace', fontSize: 9, fill: '#484f58' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => `${v}${panel.unit}`}
              width={45}
            />
            <Tooltip content={<CustomTooltip />} />
            {panel.metrics.length > 1 && (
              <Legend
                wrapperStyle={{ fontFamily: 'monospace', fontSize: 9, paddingTop: 4 }}
              />
            )}
            {panel.metrics.map(m => (
              <Area
                key={m.key}
                type="monotone"
                dataKey={m.key}
                name={m.label}
                stroke={m.color}
                strokeWidth={1.5}
                fill={`url(#grad_${m.key})`}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ─── DB Stats ─────────────────────────────────────────────────────────────────

function DBStats({ stats }) {
  if (!stats) return null
  const fmt = ts => ts ? new Date(ts * 1000).toLocaleString('en', { dateStyle: 'short', timeStyle: 'short', hour12: false }) : '--'

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Database size={13} className="text-jet-cyan" />
        <span className="font-mono text-xs font-bold tracking-wider">DATABASE</span>
        <span className="ml-auto font-mono text-xs text-jet-cyan">{stats.db_size_mb} MB</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Raw (1s)', table: 'metrics_1s', retention: '24h' },
          { label: 'Minute',   table: 'metrics_1m', retention: '30d' },
          { label: 'Hour',     table: 'metrics_1h', retention: '1yr' },
        ].map(({ label, table, retention }) => {
          const s = stats[table] || {}
          return (
            <div key={table} className="bg-jet-surface rounded p-2">
              <div className="font-mono text-[10px] text-jet-dim mb-1">{label} · {retention}</div>
              <div className="font-mono text-sm text-jet-text font-bold">
                {(s.count || 0).toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-jet-muted">
                {fmt(s.oldest)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const [range, setRange]   = useState('1h')
  const [data, setData]     = useState({})     // panelId → { metricKey → points[] }
  const [stats, setStats]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [lastLoad, setLastLoad] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Cargar todos los paneles en paralelo
      const allMetrics = PANELS.flatMap(p => p.metrics.map(m => m.key))
      const unique = [...new Set(allMetrics)].join(',')

      const [multi, dbStats] = await Promise.all([
        apiFetch(`/history/query-multi?metrics=${unique}&range=${range}&limit=800`),
        apiFetch('/history/stats'),
      ])

      // Organizar por panel
      const byPanel = {}
      for (const panel of PANELS) {
        byPanel[panel.id] = {}
        for (const m of panel.metrics) {
          byPanel[panel.id][m.key] = multi.data[m.key] || []
        }
      }
      setData(byPanel)
      setStats(dbStats)
      setLastLoad(new Date())
    } catch (e) {
      console.error('History load error:', e)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { loadData() }, [loadData])

  // Auto-refresh cada 60s
  useEffect(() => {
    const id = setInterval(loadData, 60000)
    return () => clearInterval(id)
  }, [loadData])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp size={18} className="text-jet-cyan" />
          <h1 className="font-display text-lg font-bold tracking-widest">HISTORY</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Range selector */}
          <div className="flex gap-1 bg-jet-surface border border-jet-border rounded-lg p-1">
            {RANGES.map(r => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`px-3 py-1 font-mono text-xs rounded transition-colors ${
                  range === r.id
                    ? 'bg-jet-cyan/15 text-jet-cyan border border-jet-cyan/30'
                    : 'text-jet-dim hover:text-jet-text'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {/* Refresh */}
          <button onClick={loadData} disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs border border-jet-border rounded hover:border-jet-cyan/40 text-jet-dim hover:text-jet-cyan transition-colors disabled:opacity-40">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {lastLoad ? lastLoad.toLocaleTimeString('en', { hour12: false }) : 'Refresh'}
          </button>
        </div>
      </div>

      {/* DB Stats */}
      <DBStats stats={stats} />

      {/* Charts grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {PANELS.map(panel => (
          <ChartPanel
            key={panel.id}
            panel={panel}
            range={range}
            data={data[panel.id] || {}}
            loading={loading}
          />
        ))}
      </div>
    </div>
  )
}
