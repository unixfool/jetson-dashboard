import { useState, useEffect, useCallback } from 'react'
import { apiFetch, formatBytes } from '../utils/format'
import { Activity, Search, RefreshCw, X, Skull, ChevronUp, ChevronDown } from 'lucide-react'
import clsx from 'clsx'

export default function ProcessesPage() {
  const [processes, setProcesses] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [sortBy, setSortBy] = useState('cpu_percent')
  const [sortDir, setSortDir] = useState('desc')
  const [killModal, setKillModal] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchProcesses = useCallback(async () => {
    try {
      const data = await apiFetch(`/processes?sort_by=${sortBy}&limit=100${filter ? `&filter=${filter}` : ''}`)
      setProcesses(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('Process fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [sortBy, filter])

  useEffect(() => {
    fetchProcesses()
    if (!autoRefresh) return
    const interval = setInterval(fetchProcesses, 3000)
    return () => clearInterval(interval)
  }, [fetchProcesses, autoRefresh])

  const handleKill = async (pid) => {
    try {
      const res = await apiFetch('/processes/kill', {
        method: 'POST',
        body: JSON.stringify({ pid, force: true }),
      })
      if (res.success === false) {
        setKillModal(m => ({ ...m, error: res.error || 'Kill failed' }))
        return
      }
      setKillModal(null)
      setTimeout(fetchProcesses, 500)
    } catch (e) {
      setKillModal(m => ({ ...m, error: e.message }))
    }
  }

  const handleSort = (col) => {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('desc')
    }
  }

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return null
    return sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
  }

  const sorted = [...processes].sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1
    if (sortBy === 'name') return mul * a.name.localeCompare(b.name)
    return mul * ((b[sortBy] || 0) - (a[sortBy] || 0))
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Activity size={18} className="text-jet-green" />
          <h1 className="font-display text-lg font-bold tracking-widest">PROCESSES</h1>
          <span className="font-mono text-[10px] text-jet-dim bg-jet-surface px-2 py-0.5 rounded">
            {processes.length} shown
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-jet-dim" />
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter processes..."
              className="bg-jet-surface border border-jet-border rounded pl-7 pr-3 py-1.5
                         font-mono text-xs text-jet-text placeholder-jet-muted
                         focus:outline-none focus:border-jet-cyan/50 w-48"
            />
            {filter && (
              <button onClick={() => setFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-jet-dim">
                <X size={10} />
              </button>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-[10px] font-mono text-jet-dim cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
            />
            Auto
          </label>
          <button onClick={fetchProcesses} className="btn-ghost">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {killModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
          <div className="rounded-lg p-6 max-w-sm w-full mx-4"
               style={{background:'var(--color-card)', border:'1px solid rgba(248,81,73,0.3)'}}>
            <div className="flex items-center gap-2 mb-4" style={{color:'var(--color-red)'}}>
              <Skull size={16} />
              <span className="font-mono font-bold">Kill Process</span>
            </div>
            <p className="font-mono text-sm mb-4" style={{color:'var(--color-dim)'}}>
              Kill <span className="font-bold" style={{color:'var(--color-text)'}}>{killModal.name}</span>
              {' '}<span style={{color:'var(--color-muted)'}}>PID {killModal.pid}</span>
            </p>
            {killModal.error && (
              <div className="font-mono text-xs mb-4 px-3 py-2 rounded"
                   style={{background:'rgba(248,81,73,0.1)', color:'var(--color-red)', border:'1px solid rgba(248,81,73,0.2)'}}>
                ✘ {killModal.error}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => handleKill(killModal.pid)} className="btn-danger flex-1">
                <Skull size={12} /> Kill
              </button>
              <button onClick={() => setKillModal(null)} className="btn-ghost flex-1">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-jet-border bg-jet-surface">
                {[
                  { key: 'pid', label: 'PID', w: 'w-16' },
                  { key: 'name', label: 'NAME', w: 'w-48' },
                  { key: 'username', label: 'USER', w: 'w-24' },
                  { key: 'cpu_percent', label: 'CPU%', w: 'w-20' },
                  { key: 'memory_percent', label: 'MEM%', w: 'w-20' },
                  { key: 'memory_rss', label: 'RSS', w: 'w-24' },
                  { key: 'status', label: 'STATUS', w: 'w-20' },
                  { key: 'num_threads', label: 'THR', w: 'w-16' },
                  { key: null, label: '', w: 'w-16' },
                ].map(({ key, label, w }) => (
                  <th
                    key={label}
                    onClick={key ? () => handleSort(key) : undefined}
                    className={clsx(
                      'px-3 py-2 text-left font-mono text-[10px] font-medium text-jet-dim uppercase tracking-wider',
                      key && 'cursor-pointer hover:text-jet-text select-none',
                      w
                    )}
                  >
                    <span className="flex items-center gap-1">
                      {label}
                      {key && <SortIcon col={key} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 font-mono text-xs text-jet-dim">
                    Loading processes...
                  </td>
                </tr>
              ) : sorted.map((proc) => (
                <tr
                  key={proc.pid}
                  className="border-b border-jet-border/50 hover:bg-jet-surface/50 transition-colors"
                >
                  <td className="px-3 py-1.5 font-mono text-[11px] text-jet-dim">{proc.pid}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-jet-text truncate max-w-[12rem]">
                    {proc.name}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-jet-dim">{proc.username}</td>
                  <td className="px-3 py-1.5">
                    <span className={clsx('font-mono text-[11px] font-bold',
                      proc.cpu_percent > 50 ? 'text-jet-red' :
                      proc.cpu_percent > 20 ? 'text-jet-yellow' : 'text-jet-text'
                    )}>
                      {proc.cpu_percent.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={clsx('font-mono text-[11px]',
                      proc.memory_percent > 10 ? 'text-jet-yellow' : 'text-jet-text'
                    )}>
                      {proc.memory_percent.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-jet-dim">
                    {formatBytes(proc.memory_rss)}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={clsx('font-mono text-[10px]',
                      proc.status === 'running' ? 'text-jet-green' :
                      proc.status === 'sleeping' ? 'text-jet-dim' : 'text-jet-yellow'
                    )}>
                      {proc.status}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-jet-dim">
                    {proc.num_threads}
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      onClick={() => setKillModal({ pid: proc.pid, name: proc.name })}
                      className="text-jet-muted hover:text-jet-red transition-colors"
                      title="Kill process"
                    >
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
