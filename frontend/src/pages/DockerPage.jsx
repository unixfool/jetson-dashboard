import { useState, useEffect, useCallback } from 'react'
import { apiFetch, formatBytes } from '../utils/format'
import { Container, Play, Square, RotateCcw, FileText, RefreshCw, AlertCircle } from 'lucide-react'
import clsx from 'clsx'

function StatusBadge({ status }) {
  const map = {
    running: 'badge-green',
    exited: 'badge-red',
    paused: 'badge-yellow',
    created: 'badge-cyan',
  }
  return (
    <span className={`badge ${map[status] || 'badge-yellow'}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

function LogsModal({ containerId, containerName, onClose }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch(`/docker/containers/${containerId}/logs?tail=200`)
      .then(data => { setLogs(data.logs || []); setLoading(false) })
      .catch(e => { setLogs([`Error: ${e.message}`]); setLoading(false) })
  }, [containerId])

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-jet-card border border-jet-border rounded-lg w-full max-w-4xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-jet-border">
          <div>
            <span className="font-mono text-sm font-bold text-jet-text">{containerName}</span>
            <span className="font-mono text-[10px] text-jet-dim ml-2">container logs</span>
          </div>
          <button onClick={onClose} className="btn-ghost text-xs">Close</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 bg-jet-bg font-mono text-[11px] text-jet-dim space-y-0.5">
          {loading ? (
            <div className="text-jet-dim text-center py-8">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="text-jet-dim text-center py-8">No logs available</div>
          ) : (
            logs.map((line, i) => (
              <div key={i} className="leading-5 hover:text-jet-text hover:bg-jet-surface/50 px-1 rounded">
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default function DockerPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState({})
  const [logsModal, setLogsModal] = useState(null)
  const [showAll, setShowAll] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const result = await apiFetch('/docker')
      setData(result)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  const doAction = async (containerId, action) => {
    setActionLoading(prev => ({ ...prev, [containerId + action]: true }))
    try {
      await apiFetch(`/docker/containers/${containerId}/${action}`, { method: 'POST' })
      await fetchData()
    } catch (e) {
      console.error(`Docker ${action} error:`, e)
    } finally {
      setActionLoading(prev => ({ ...prev, [containerId + action]: false }))
    }
  }

  const info = data?.info || {}
  const containers = (data?.containers || []).filter(c =>
    showAll ? true : c.status === 'running'
  )

  return (
    <div className="space-y-6">
      {logsModal && (
        <LogsModal
          containerId={logsModal.id}
          containerName={logsModal.name}
          onClose={() => setLogsModal(null)}
        />
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Container size={18} className="text-jet-cyan" />
          <h1 className="font-display text-lg font-bold tracking-widest">DOCKER</h1>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-mono text-jet-dim cursor-pointer">
            <input
              type="checkbox"
              checked={showAll}
              onChange={e => setShowAll(e.target.checked)}
              className="rounded"
            />
            Show all
          </label>
          <button onClick={fetchData} className="btn-ghost">
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
      </div>

      {/* Docker info */}
      {info.available !== false && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'RUNNING', value: info.containers_running, color: '#3fb950' },
            { label: 'STOPPED', value: info.containers_stopped, color: '#f85149' },
            { label: 'TOTAL', value: info.containers, color: '#58a6ff' },
            { label: 'IMAGES', value: info.images, color: '#bc8cff' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card text-center">
              <div className="card-title mb-2">{label}</div>
              <div className="font-display text-2xl font-bold" style={{ color }}>
                {value ?? '--'}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="card border-jet-red/30 bg-jet-red/5">
          <div className="flex items-center gap-2 text-jet-red font-mono text-sm">
            <AlertCircle size={14} />
            {error}
          </div>
        </div>
      )}

      {/* Container list */}
      {loading ? (
        <div className="card text-center py-12 font-mono text-jet-dim">Loading containers...</div>
      ) : containers.length === 0 ? (
        <div className="card text-center py-12 font-mono text-jet-dim">
          {info.available === false ? 'Docker not available or not running' : 'No containers found'}
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <span className="card-title">CONTAINERS</span>
            <span className="font-mono text-[10px] text-jet-dim">{containers.length} items</span>
          </div>
          <div className="space-y-2">
            {containers.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 p-3 bg-jet-surface rounded-md hover:bg-jet-muted/20 transition-colors"
              >
                {/* Status */}
                <StatusBadge status={c.status} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm font-semibold text-jet-text truncate">
                    {c.name}
                  </div>
                  <div className="font-mono text-[10px] text-jet-dim truncate mt-0.5">
                    {c.image}
                  </div>
                  {Object.keys(c.ports || {}).length > 0 && (
                    <div className="font-mono text-[10px] text-jet-cyan mt-0.5">
                      {Object.entries(c.ports).map(([k, v]) =>
                        v ? `${v[0]} → ${k}` : k
                      ).join(', ')}
                    </div>
                  )}
                </div>

                {/* ID */}
                <span className="font-mono text-[10px] text-jet-muted hidden md:block">
                  {c.id}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  {c.status === 'running' ? (
                    <button
                      onClick={() => doAction(c.id, 'stop')}
                      disabled={actionLoading[c.id + 'stop']}
                      className="btn-danger py-1 px-2 text-[10px]"
                      title="Stop"
                    >
                      <Square size={10} />
                      {actionLoading[c.id + 'stop'] ? '...' : 'Stop'}
                    </button>
                  ) : (
                    <button
                      onClick={() => doAction(c.id, 'start')}
                      disabled={actionLoading[c.id + 'start']}
                      className="btn-success py-1 px-2 text-[10px]"
                      title="Start"
                    >
                      <Play size={10} />
                      {actionLoading[c.id + 'start'] ? '...' : 'Start'}
                    </button>
                  )}
                  <button
                    onClick={() => doAction(c.id, 'restart')}
                    disabled={actionLoading[c.id + 'restart']}
                    className="btn-ghost py-1 px-2 text-[10px]"
                    title="Restart"
                  >
                    <RotateCcw size={10} />
                  </button>
                  <button
                    onClick={() => setLogsModal({ id: c.id, name: c.name })}
                    className="btn-ghost py-1 px-2 text-[10px]"
                    title="Logs"
                  >
                    <FileText size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
