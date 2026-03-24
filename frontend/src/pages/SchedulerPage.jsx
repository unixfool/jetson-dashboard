/**
 * SchedulerPage — Task scheduler for Jetson Dashboard
 * Create, manage and monitor scheduled commands on the Jetson host
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Clock, Plus, Play, Trash2, Edit2, Check, X,
  ChevronDown, ChevronUp, Calendar, Terminal,
  CheckCircle, XCircle, RefreshCw, Zap
} from 'lucide-react'
import { apiFetch } from '../utils/format'
import clsx from 'clsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(isoStr) {
  if (!isoStr) return '—'
  if (isoStr === 'overdue') return 'overdue'
  const diff = new Date(isoStr) - new Date()
  const abs  = Math.abs(diff)
  const mins = Math.floor(abs / 60000)
  const hrs  = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (days > 0)  return `in ${days}d ${hrs % 24}h`
  if (hrs > 0)   return `in ${hrs}h ${mins % 60}m`
  if (mins > 0)  return `in ${mins}m`
  return 'soon'
}

function formatAgo(isoStr) {
  if (!isoStr) return 'never'
  const diff = new Date() - new Date(isoStr)
  const mins = Math.floor(diff / 60000)
  const hrs  = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (days > 0)  return `${days}d ago`
  if (hrs > 0)   return `${hrs}h ago`
  if (mins > 0)  return `${mins}m ago`
  return 'just now'
}

// ── Task Form ─────────────────────────────────────────────────────────────────

function TaskForm({ schedules, initial, onSave, onCancel }) {
  const [name,    setName]    = useState(initial?.name        || '')
  const [cmd,     setCmd]     = useState(initial?.command     || '')
  const [sched,   setSched]   = useState(initial?.schedule    || 'daily')
  const [desc,    setDesc]    = useState(initial?.description || '')
  const [timeout, setTimeout] = useState(initial?.timeout     || 60)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    if (!cmd.trim())  { setError('Command is required'); return }
    setLoading(true)
    setError('')
    try {
      await onSave({ name, command: cmd, schedule: sched, description: desc, timeout })
    } catch(e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Name */}
        <div>
          <label className="font-mono text-[10px] text-jet-dim uppercase tracking-widest block mb-1.5">
            Task name
          </label>
          <input
            className="jet-input"
            placeholder="e.g. Daily backup"
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
          />
        </div>

        {/* Schedule */}
        <div>
          <label className="font-mono text-[10px] text-jet-dim uppercase tracking-widest block mb-1.5">
            Schedule
          </label>
          <select
            className="jet-input"
            value={sched}
            onChange={e => setSched(e.target.value)}
          >
            {schedules.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Command */}
      <div>
        <label className="font-mono text-[10px] text-jet-dim uppercase tracking-widest block mb-1.5">
          Command
        </label>
        <input
          className="jet-input font-mono"
          placeholder="e.g. docker system prune -f"
          value={cmd}
          onChange={e => { setCmd(e.target.value); setError('') }}
        />
        <p className="font-mono text-[10px] text-jet-muted mt-1">
          Executed on the Jetson host via nsenter. Use full paths when needed.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Description */}
        <div>
          <label className="font-mono text-[10px] text-jet-dim uppercase tracking-widest block mb-1.5">
            Description (optional)
          </label>
          <input
            className="jet-input"
            placeholder="What does this task do?"
            value={desc}
            onChange={e => setDesc(e.target.value)}
          />
        </div>

        {/* Timeout */}
        <div>
          <label className="font-mono text-[10px] text-jet-dim uppercase tracking-widest block mb-1.5">
            Timeout (seconds)
          </label>
          <input
            className="jet-input"
            type="number"
            min={5}
            max={3600}
            value={timeout}
            onChange={e => setTimeout(parseInt(e.target.value) || 60)}
          />
        </div>
      </div>

      {error && (
        <div className="font-mono text-xs px-3 py-2 rounded border bg-jet-red/10 border-jet-red/30 text-jet-red">
          ✘ {error}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={loading}
          className="btn-success"
        >
          <Check size={12} />
          {loading ? 'Saving...' : initial ? 'Save changes' : 'Create task'}
        </button>
        <button onClick={onCancel} className="btn-ghost">
          <X size={12} /> Cancel
        </button>
      </div>
    </div>
  )
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({ task, schedules, onUpdate, onDelete, onRunNow }) {
  const [expanded,  setExpanded]  = useState(false)
  const [editing,   setEditing]   = useState(false)
  const [running,   setRunning]   = useState(false)
  const [runResult, setRunResult] = useState(null)
  const [deleting,  setDeleting]  = useState(false)

  const handleToggleEnabled = async () => {
    await onUpdate(task.id, { enabled: !task.enabled })
  }

  const handleRunNow = async () => {
    setRunning(true)
    setRunResult(null)
    try {
      const result = await onRunNow(task.id)
      setRunResult(result)
      setExpanded(true)
    } finally {
      setRunning(false)
    }
  }

  const handleSaveEdit = async (data) => {
    await onUpdate(task.id, data)
    setEditing(false)
  }

  const statusColor = task.last_result === 'success'
    ? 'var(--color-green)'
    : task.last_result === 'failed'
    ? 'var(--color-red)'
    : 'var(--color-muted)'

  return (
    <div className={clsx(
      'panel transition-all duration-200',
      !task.enabled && 'opacity-60'
    )}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">

        {/* Enable toggle */}
        <button
          onClick={handleToggleEnabled}
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
          style={{
            background: task.enabled ? 'rgba(63,185,80,0.12)' : 'rgba(128,128,128,0.1)',
            border: `1px solid ${task.enabled ? 'rgba(63,185,80,0.3)' : 'var(--color-border)'}`,
          }}
          title={task.enabled ? 'Disable task' : 'Enable task'}
        >
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: task.enabled ? 'var(--color-green)' : 'var(--color-muted)' }}
          />
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold" style={{color:'var(--color-text)'}}>
              {task.name}
            </span>
            <span className="badge badge-cyan text-[10px]">{task.schedule_label}</span>
            {task.last_result === 'success' && (
              <span className="badge badge-green text-[10px]">last run OK</span>
            )}
            {task.last_result === 'failed' && (
              <span className="badge badge-red text-[10px]">last run FAILED</span>
            )}
          </div>
          <div className="font-mono text-[11px] mt-0.5 truncate" style={{color:'var(--color-dim)'}}>
            <Terminal size={10} className="inline mr-1" />
            {task.command}
          </div>
        </div>

        {/* Next run */}
        <div className="hidden md:flex flex-col items-end mr-2">
          <span className="font-mono text-[10px]" style={{color:'var(--color-dim)'}}>
            next run
          </span>
          <span className="font-mono text-[11px] font-bold"
                style={{color: task.next_run === 'overdue' ? 'var(--color-yellow)' : 'var(--color-cyan)'}}>
            {task.enabled ? formatRelative(task.next_run) : 'disabled'}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleRunNow}
            disabled={running}
            className="btn-primary py-1 px-2 text-[10px]"
            title="Run now"
          >
            {running
              ? <RefreshCw size={11} className="animate-spin" />
              : <Play size={11} />
            }
          </button>
          <button
            onClick={() => { setEditing(!editing); setExpanded(false) }}
            className="btn-ghost py-1 px-2 text-[10px]"
            title="Edit"
          >
            <Edit2 size={11} />
          </button>
          <button
            onClick={() => setDeleting(true)}
            className="btn-danger py-1 px-2 text-[10px]"
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
          <button
            onClick={() => { setExpanded(!expanded); setEditing(false) }}
            className="btn-ghost py-1 px-2 text-[10px]"
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      </div>

      {/* Delete confirm */}
      {deleting && (
        <div className="px-4 py-3 border-t flex items-center gap-3"
             style={{borderColor:'var(--color-border)', background:'rgba(248,81,73,0.05)'}}>
          <span className="font-mono text-xs" style={{color:'var(--color-red)'}}>
            Delete "{task.name}"?
          </span>
          <button onClick={() => onDelete(task.id)} className="btn-danger py-1 px-2 text-[10px]">
            <Check size={10} /> Confirm
          </button>
          <button onClick={() => setDeleting(false)} className="btn-ghost py-1 px-2 text-[10px]">
            Cancel
          </button>
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="px-4 py-4 border-t" style={{borderColor:'var(--color-border)', background:'var(--color-surface)'}}>
          <TaskForm
            schedules={schedules}
            initial={task}
            onSave={handleSaveEdit}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}

      {/* Expanded details */}
      {expanded && !editing && (
        <div className="border-t" style={{borderColor:'var(--color-border)'}}>

          {/* Run result (if just ran) */}
          {runResult && (
            <div className="px-4 py-3 border-b" style={{
              borderColor:'var(--color-border)',
              background: runResult.success ? 'rgba(63,185,80,0.05)' : 'rgba(248,81,73,0.05)'
            }}>
              <div className="flex items-center gap-2 mb-2">
                {runResult.success
                  ? <CheckCircle size={13} style={{color:'var(--color-green)'}} />
                  : <XCircle size={13} style={{color:'var(--color-red)'}} />
                }
                <span className="font-mono text-xs font-bold"
                      style={{color: runResult.success ? 'var(--color-green)' : 'var(--color-red)'}}>
                  {runResult.success ? 'Task completed successfully' : 'Task failed'}
                </span>
              </div>
              {runResult.output && (
                <pre className="font-mono text-[11px] p-2 rounded overflow-x-auto"
                     style={{background:'var(--color-bg)', color:'var(--color-text)', maxHeight:'150px'}}>
                  {runResult.output}
                </pre>
              )}
            </div>
          )}

          {/* Task details */}
          <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-4 border-b"
               style={{borderColor:'var(--color-border)', background:'var(--color-surface)'}}>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{color:'var(--color-dim)'}}>Last run</div>
              <div className="font-mono text-xs" style={{color:'var(--color-text)'}}>{formatAgo(task.last_run)}</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{color:'var(--color-dim)'}}>Next run</div>
              <div className="font-mono text-xs" style={{color:'var(--color-cyan)'}}>
                {task.enabled ? formatRelative(task.next_run) : 'disabled'}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{color:'var(--color-dim)'}}>Timeout</div>
              <div className="font-mono text-xs" style={{color:'var(--color-text)'}}>{task.timeout}s</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{color:'var(--color-dim)'}}>Runs total</div>
              <div className="font-mono text-xs" style={{color:'var(--color-text)'}}>{task.history?.length || 0}</div>
            </div>
          </div>

          {/* Description */}
          {task.description && (
            <div className="px-4 py-2 border-b font-mono text-xs"
                 style={{borderColor:'var(--color-border)', color:'var(--color-dim)'}}>
              {task.description}
            </div>
          )}

          {/* History */}
          {task.history?.length > 0 && (
            <div className="px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-widest mb-2" style={{color:'var(--color-dim)'}}>
                Recent runs
              </div>
              <div className="space-y-1">
                {task.history.slice(0, 5).map((run, i) => (
                  <div key={i} className="flex items-center gap-3 font-mono text-[11px]">
                    {run.success
                      ? <CheckCircle size={11} style={{color:'var(--color-green)', flexShrink:0}} />
                      : <XCircle size={11} style={{color:'var(--color-red)', flexShrink:0}} />
                    }
                    <span style={{color:'var(--color-dim)'}}>{formatAgo(run.started)}</span>
                    {run.output && (
                      <span className="truncate" style={{color:'var(--color-text)'}}>
                        {run.output.split('\n')[0].slice(0, 80)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Presets Modal ─────────────────────────────────────────────────────────────

function PresetsModal({ presets, onAdd, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-xl border overflow-hidden"
           style={{background:'var(--color-card)', borderColor:'var(--color-border)'}}>
        <div className="flex items-center justify-between px-4 py-3 border-b"
             style={{borderColor:'var(--color-border)', background:'var(--color-surface)'}}>
          <span className="font-mono text-sm font-bold" style={{color:'var(--color-cyan)'}}>
            <Zap size={13} className="inline mr-2" />
            Preset Tasks
          </span>
          <button onClick={onClose} className="btn-ghost py-1 px-2">
            <X size={13} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="font-mono text-xs" style={{color:'var(--color-dim)'}}>
            Ready-to-use tasks for common Jetson maintenance operations.
          </p>
          {presets.map((preset, i) => (
            <div key={i} className="panel">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm font-bold" style={{color:'var(--color-text)'}}>{preset.name}</div>
                  <div className="font-mono text-[11px] mt-0.5" style={{color:'var(--color-dim)'}}>{preset.description}</div>
                  <div className="font-mono text-[10px] mt-1 flex items-center gap-2">
                    <span className="badge badge-cyan">{preset.schedule}</span>
                    <code style={{color:'var(--color-cyan)'}}>{preset.command}</code>
                  </div>
                </div>
                <button
                  onClick={() => onAdd(i)}
                  className="btn-primary ml-4 flex-shrink-0"
                >
                  <Plus size={11} /> Add
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SchedulerPage() {
  const [tasks,       setTasks]       = useState([])
  const [schedules,   setSchedules]   = useState([])
  const [presets,     setPresets]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showForm,    setShowForm]    = useState(false)
  const [showPresets, setShowPresets] = useState(false)
  const [error,       setError]       = useState(null)

  const loadData = useCallback(async () => {
    try {
      const [tasksData, schedData, presetsData] = await Promise.all([
        apiFetch('/scheduler/tasks'),
        apiFetch('/scheduler/schedules'),
        apiFetch('/scheduler/presets'),
      ])
      setTasks(tasksData.tasks || [])
      setSchedules(schedData.schedules || [])
      setPresets(presetsData.presets || [])
      setError(null)
    } catch(e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [loadData])

  const handleCreate = async (data) => {
    await apiFetch('/scheduler/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    setShowForm(false)
    loadData()
  }

  const handleUpdate = async (id, data) => {
    await apiFetch(`/scheduler/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    loadData()
  }

  const handleDelete = async (id) => {
    await apiFetch(`/scheduler/tasks/${id}`, { method: 'DELETE' })
    loadData()
  }

  const handleRunNow = async (id) => {
    const result = await apiFetch(`/scheduler/tasks/${id}/run`, { method: 'POST' })
    loadData()
    return result
  }

  const handleAddPreset = async (index) => {
    await apiFetch(`/scheduler/presets/${index}`, { method: 'POST' })
    setShowPresets(false)
    loadData()
  }

  const enabledCount  = tasks.filter(t => t.enabled).length
  const overdueCount  = tasks.filter(t => t.next_run === 'overdue' && t.enabled).length
  const failedCount   = tasks.filter(t => t.last_result === 'failed').length

  return (
    <div className="space-y-6">

      {/* Presets modal */}
      {showPresets && (
        <PresetsModal
          presets={presets}
          onAdd={handleAddPreset}
          onClose={() => setShowPresets(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Clock size={18} style={{color:'var(--color-dim)'}} />
          <h1 className="font-display text-lg font-bold tracking-widest" style={{color:'var(--color-text)'}}>
            SCHEDULER
          </h1>
          {!loading && (
            <div className="flex items-center gap-2">
              <span className="badge badge-green">{enabledCount} active</span>
              {overdueCount > 0 && <span className="badge badge-yellow">{overdueCount} overdue</span>}
              {failedCount  > 0 && <span className="badge badge-red">{failedCount} failed</span>}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowPresets(true)} className="btn-ghost">
            <Zap size={12} /> Presets
          </button>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            <Plus size={12} /> New Task
          </button>
        </div>
      </div>

      {/* New task form */}
      {showForm && (
        <div className="panel">
          <div className="panel-header">
            <Plus size={13} style={{color:'var(--color-cyan)'}} />
            <span className="font-mono text-xs font-bold tracking-widest" style={{color:'var(--color-cyan)'}}>
              NEW TASK
            </span>
          </div>
          <div className="panel-body">
            <TaskForm
              schedules={schedules}
              onSave={handleCreate}
              onCancel={() => setShowForm(false)}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card border-jet-red/30 bg-jet-red/5">
          <p className="font-mono text-xs text-jet-red">✘ {error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={20} className="animate-spin" style={{color:'var(--color-dim)'}} />
        </div>
      )}

      {/* Empty state */}
      {!loading && tasks.length === 0 && (
        <div className="card text-center py-12 space-y-3">
          <Calendar size={32} className="mx-auto" style={{color:'var(--color-muted)'}} />
          <p className="font-mono text-sm font-bold" style={{color:'var(--color-dim)'}}>No scheduled tasks</p>
          <p className="font-mono text-xs" style={{color:'var(--color-muted)'}}>
            Create a task or add one from the presets
          </p>
          <div className="flex gap-2 justify-center pt-2">
            <button onClick={() => setShowPresets(true)} className="btn-ghost">
              <Zap size={12} /> Browse presets
            </button>
            <button onClick={() => setShowForm(true)} className="btn-primary">
              <Plus size={12} /> Create task
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      {!loading && tasks.length > 0 && (
        <div className="space-y-3">
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              schedules={schedules}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onRunNow={handleRunNow}
            />
          ))}
        </div>
      )}

      {/* Info footer */}
      {!loading && tasks.length > 0 && (
        <p className="font-mono text-[10px] text-center" style={{color:'var(--color-muted)'}}>
          Scheduler checks every 10 seconds · Commands run on the Jetson host via nsenter · Page auto-refreshes every 30s
        </p>
      )}
    </div>
  )
}
