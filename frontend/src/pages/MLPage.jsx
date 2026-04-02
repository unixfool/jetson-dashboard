import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../utils/format'

// ─── Constants ────────────────────────────────────────────────────────────────
const TABS = ['Run', 'Jobs', 'Models', 'Datasets']

const STATUS_COLOR = {
  pending:   'text-yellow-400',
  running:   'text-blue-400',
  completed: 'text-green-400',
  failed:    'text-red-400',
  cancelled: 'text-jet-dim',
  error:     'text-red-400',
}

const STATUS_DOT = {
  pending:   'bg-yellow-400 animate-pulse',
  running:   'bg-blue-400 animate-pulse',
  completed: 'bg-green-400',
  failed:    'bg-red-400',
  cancelled: 'bg-jet-dim',
  error:     'bg-red-400',
}

function formatBytes(b) {
  if (!b) return '0 B'
  if (b < 1024) return `${b} B`
  if (b < 1024*1024) return `${(b/1024).toFixed(1)} KB`
  if (b < 1024*1024*1024) return `${(b/1024/1024).toFixed(1)} MB`
  return `${(b/1024/1024/1024).toFixed(2)} GB`
}

function formatDuration(s) {
  if (!s) return '—'
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

// ─── Run Tab ──────────────────────────────────────────────────────────────────
function RunTab({ available, onJobSubmitted }) {
  const [examples,    setExamples]    = useState([])
  const [selectedEx,  setSelectedEx]  = useState(null)
  const [jobName,     setJobName]     = useState('')
  const [script,      setScript]      = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState(null)
  const [success,     setSuccess]     = useState(null)

  useEffect(() => {
    apiFetch('/ml/examples').then(setExamples).catch(() => {})
  }, [])

  const loadExample = async (id) => {
    try {
      const ex = await apiFetch(`/ml/examples/${id}`)
      setSelectedEx(id)
      setJobName(ex.name)
      setScript(ex.script)
      setError(null)
    } catch (e) {
      setError('Failed to load example')
    }
  }

  const submit = async () => {
    if (!script.trim()) { setError('Script cannot be empty'); return }
    if (!jobName.trim()) { setError('Job name cannot be empty'); return }
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await apiFetch('/ml/jobs', {
        method: 'POST',
        body: JSON.stringify({ name: jobName, script }),
      })
      setSuccess(`Job submitted — ID: ${res.job_id}`)
      onJobSubmitted(res.job_id)
    } catch (e) {
      setError(e.message || 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Examples */}
      <div className="rounded-xl border border-jet-border bg-jet-surface p-4 space-y-3">
        <span className="text-[10px] font-mono text-jet-dim uppercase tracking-widest">
          Built-in Examples
        </span>
        <div className="grid grid-cols-2 gap-2">
          {examples.map(ex => (
            <button key={ex.id} onClick={() => loadExample(ex.id)}
              className={`text-left p-3 rounded-lg border transition-all
                ${selectedEx === ex.id
                  ? 'border-green-500/50 bg-green-500/5 text-green-400'
                  : 'border-jet-border hover:border-green-500/30 text-jet-text'}`}>
              <div className="text-xs font-mono font-bold">{ex.name}</div>
              <div className="text-[10px] text-jet-dim mt-0.5">{ex.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Script editor */}
      <div className="rounded-xl border border-jet-border bg-jet-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-jet-border">
          <span className="text-[10px] font-mono text-jet-dim uppercase tracking-widest">Script Editor</span>
          <button onClick={() => { setScript(''); setJobName(''); setSelectedEx(null) }}
            className="text-[10px] font-mono text-jet-dim hover:text-jet-text transition-colors">
            Clear
          </button>
        </div>

        <div className="p-4 space-y-3">
          <input
            type="text"
            placeholder="Job name..."
            value={jobName}
            onChange={e => setJobName(e.target.value)}
            disabled={!available}
            className="w-full bg-jet-bg border border-jet-border rounded-lg px-3 py-2
              text-xs font-mono text-jet-text placeholder-jet-dim
              focus:outline-none focus:border-green-500/50 disabled:opacity-40"
          />
          <textarea
            value={script}
            onChange={e => setScript(e.target.value)}
            placeholder="# Write your Python script here&#10;# The script runs inside the jetson-ai container&#10;# /workspace → ~/jetson-workspace&#10;import numpy as np&#10;print('Hello from JetBot ML!')"
            disabled={!available}
            rows={16}
            className="w-full bg-jet-bg border border-jet-border rounded-lg px-3 py-2
              text-xs font-mono text-jet-text placeholder-jet-dim resize-y
              focus:outline-none focus:border-green-500/50 disabled:opacity-40"
            style={{ minHeight: '300px' }}
          />
        </div>
      </div>

      {/* Error / success */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-xs font-mono text-red-400">
          ⚠ {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-2.5 text-xs font-mono text-green-400">
          ✓ {success}
        </div>
      )}

      {/* Submit */}
      <button onClick={submit} disabled={!available || submitting}
        className={`w-full py-3 rounded-xl font-mono font-bold text-sm tracking-widest border-2 transition-all
          ${!available || submitting
            ? 'border-jet-border text-jet-dim opacity-40 cursor-not-allowed'
            : 'border-green-500/50 text-green-400 hover:bg-green-500/10 hover:border-green-500 active:scale-95'}`}>
        {submitting ? '⏳ Submitting...' : '▶ Run Script'}
      </button>

      {/* Info */}
      <div className="text-[10px] font-mono text-jet-dim space-y-0.5 border-t border-jet-border/40 pt-3">
        <p>Scripts run inside <span className="text-jet-text">jetson-ai:latest</span> container</p>
        <p>Workspace mounted at <span className="text-jet-text">/workspace</span> → <span className="text-jet-text">~/jetson-workspace</span></p>
        <p>Available: Python 3.12, OpenCV, NumPy, scikit-learn, pandas, matplotlib</p>
      </div>
    </div>
  )
}

// ─── Log Viewer ───────────────────────────────────────────────────────────────
function LogViewer({ jobId, status }) {
  const [log, setLog]   = useState('')
  const [live, setLive] = useState(false)
  const bottomRef       = useRef(null)
  const evtRef          = useRef(null)

  const isRunning = status === 'running' || status === 'pending'

  useEffect(() => {
    if (!jobId) return
    // Load initial log
    apiFetch(`/ml/jobs/${jobId}/log`).then(r => setLog(r.log || '')).catch(() => {})

    if (isRunning) {
      // SSE stream
      setLive(true)
      const url = `/api/ml/jobs/${jobId}/stream`
      const token = localStorage.getItem('jetson_dashboard_token')
      // Use polling since EventSource doesn't support custom headers easily
      const iv = setInterval(async () => {
        try {
          const r = await apiFetch(`/ml/jobs/${jobId}/log`)
          setLog(r.log || '')
          const job = await apiFetch(`/ml/jobs/${jobId}`)
          if (job.status !== 'running' && job.status !== 'pending') {
            clearInterval(iv)
            setLive(false)
          }
        } catch {}
      }, 1000)
      evtRef.current = iv
      return () => { clearInterval(iv); setLive(false) }
    }
  }, [jobId, status])

  useEffect(() => {
    if (bottomRef.current && live) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [log, live])

  if (!jobId) return null

  return (
    <div className="rounded-xl border border-jet-border bg-jet-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-jet-border">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-jet-dim uppercase tracking-widest">Log Output</span>
          {live && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
        </div>
        <span className="text-[10px] font-mono text-jet-dim">
          {log.split('\n').length} lines
        </span>
      </div>
      <pre className="p-4 text-[10px] font-mono text-jet-text overflow-auto max-h-80 whitespace-pre-wrap break-words">
        {log || 'No output yet...'}
        <div ref={bottomRef} />
      </pre>
    </div>
  )
}

// ─── Jobs Tab ─────────────────────────────────────────────────────────────────
function JobsTab() {
  const [jobs,       setJobs]       = useState([])
  const [selected,   setSelected]   = useState(null)
  const [loading,    setLoading]    = useState(true)

  const fetchJobs = useCallback(async () => {
    try {
      const data = await apiFetch('/ml/jobs')
      setJobs(data)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchJobs()
    const iv = setInterval(fetchJobs, 3000)
    return () => clearInterval(iv)
  }, [fetchJobs])

  const cancelJob = async (id) => {
    await apiFetch(`/ml/jobs/${id}/cancel`, { method: 'POST' })
    fetchJobs()
  }

  const deleteJob = async (id) => {
    await apiFetch(`/ml/jobs/${id}`, { method: 'DELETE' })
    if (selected?.id === id) setSelected(null)
    fetchJobs()
  }

  const selectJob = async (job) => {
    const full = await apiFetch(`/ml/jobs/${job.id}`)
    setSelected(full)
  }

  if (loading) return (
    <div className="text-center py-12 text-xs font-mono text-jet-dim">Loading jobs...</div>
  )

  if (jobs.length === 0) return (
    <div className="text-center py-12 text-xs font-mono text-jet-dim">
      No jobs yet — run a script from the Run tab
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Job list */}
      <div className="rounded-xl border border-jet-border bg-jet-surface overflow-hidden">
        <div className="divide-y divide-jet-border/50">
          {jobs.map(job => (
            <div key={job.id}
              onClick={() => selectJob(job)}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors
                ${selected?.id === job.id ? 'bg-green-500/5' : 'hover:bg-jet-border/10'}`}>
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[job.status] || 'bg-jet-dim'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono font-bold text-jet-text truncate">{job.name}</div>
                <div className="text-[10px] font-mono text-jet-dim">{formatDate(job.created_at)}</div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={`text-[10px] font-mono font-bold ${STATUS_COLOR[job.status] || 'text-jet-dim'}`}>
                  {job.status.toUpperCase()}
                </span>
                <span className="text-[10px] font-mono text-jet-dim">{formatDuration(job.duration_s)}</span>
                {(job.status === 'running' || job.status === 'pending') && (
                  <button onClick={e => { e.stopPropagation(); cancelJob(job.id) }}
                    className="text-[10px] font-mono text-red-400 border border-red-500/30 px-2 py-0.5 rounded
                      hover:bg-red-500/10 transition-colors">
                    Cancel
                  </button>
                )}
                {job.status !== 'running' && job.status !== 'pending' && (
                  <button onClick={e => { e.stopPropagation(); deleteJob(job.id) }}
                    className="text-[10px] font-mono text-jet-dim hover:text-red-400 transition-colors">
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Job detail */}
      {selected && (
        <div className="space-y-3">
          <div className="rounded-xl border border-jet-border bg-jet-surface p-4 space-y-2">
            <div className="text-[10px] font-mono text-jet-dim uppercase tracking-widest">Job Details</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
              <span className="text-jet-dim">ID</span><span className="text-jet-text truncate">{selected.id}</span>
              <span className="text-jet-dim">Status</span>
              <span className={STATUS_COLOR[selected.status]}>{selected.status}</span>
              <span className="text-jet-dim">Started</span><span className="text-jet-text">{formatDate(selected.started_at)}</span>
              <span className="text-jet-dim">Finished</span><span className="text-jet-text">{formatDate(selected.finished_at)}</span>
              <span className="text-jet-dim">Duration</span><span className="text-jet-text">{formatDuration(selected.duration_s)}</span>
              <span className="text-jet-dim">Exit code</span>
              <span className={selected.exit_code === 0 ? 'text-green-400' : 'text-red-400'}>
                {selected.exit_code ?? '—'}
              </span>
            </div>
            {selected.error && (
              <div className="text-[10px] font-mono text-red-400 border border-red-500/20 rounded p-2 mt-2">
                {selected.error}
              </div>
            )}
          </div>
          <LogViewer jobId={selected.id} status={selected.status} />
        </div>
      )}
    </div>
  )
}

// ─── Models Tab ───────────────────────────────────────────────────────────────
function ModelsTab() {
  const [models,  setModels]  = useState([])
  const [loading, setLoading] = useState(true)

  const fetchModels = useCallback(async () => {
    try {
      const data = await apiFetch('/ml/models')
      setModels(data)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { fetchModels() }, [fetchModels])

  const deleteModel = async (name) => {
    if (!confirm(`Delete model "${name}"?`)) return
    await apiFetch(`/ml/models/${encodeURIComponent(name)}`, { method: 'DELETE' })
    fetchModels()
  }

  if (loading) return <div className="text-center py-12 text-xs font-mono text-jet-dim">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-jet-border bg-jet-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-jet-border flex items-center justify-between">
          <span className="text-[10px] font-mono text-jet-dim uppercase tracking-widest">
            Models — ~/jetson-workspace/models/
          </span>
          <button onClick={fetchModels}
            className="text-[10px] font-mono text-jet-dim hover:text-jet-text transition-colors">
            Refresh
          </button>
        </div>

        {models.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-jet-dim">
            No models yet — run a training script to generate models
          </div>
        ) : (
          <div className="divide-y divide-jet-border/50">
            {models.map(m => (
              <div key={m.name} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono font-bold text-jet-text truncate">{m.name}</div>
                  <div className="text-[10px] font-mono text-jet-dim">
                    {m.type} · {formatBytes(m.size_bytes)} · {formatDate(m.modified)}
                  </div>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-jet-border text-jet-dim">
                  {m.type}
                </span>
                <button onClick={() => deleteModel(m.name)}
                  className="text-jet-dim hover:text-red-400 transition-colors text-xs font-mono">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-[10px] font-mono text-jet-dim border-t border-jet-border/40 pt-3">
        <p>Supported formats: .onnx (ONNX) · .pkl (scikit-learn) · .pt .pth (PyTorch) · .h5 (Keras) · .trt (TensorRT)</p>
        <p className="mt-0.5">Save models to <span className="text-jet-text">/workspace/models/</span> from your scripts</p>
      </div>
    </div>
  )
}

// ─── Datasets Tab ─────────────────────────────────────────────────────────────
function DatasetsTab() {
  const [datasets, setDatasets] = useState([])
  const [loading,  setLoading]  = useState(true)

  const fetchDatasets = useCallback(async () => {
    try {
      const data = await apiFetch('/ml/datasets')
      setDatasets(data)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { fetchDatasets() }, [fetchDatasets])

  if (loading) return <div className="text-center py-12 text-xs font-mono text-jet-dim">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-jet-border bg-jet-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-jet-border flex items-center justify-between">
          <span className="text-[10px] font-mono text-jet-dim uppercase tracking-widest">
            Datasets — ~/jetson-workspace/datasets/
          </span>
          <button onClick={fetchDatasets}
            className="text-[10px] font-mono text-jet-dim hover:text-jet-text transition-colors">
            Refresh
          </button>
        </div>

        {datasets.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-jet-dim space-y-2">
            <p>No datasets yet</p>
            <p className="text-[10px]">Add datasets to <span className="text-jet-text">~/jetson-workspace/datasets/</span></p>
          </div>
        ) : (
          <div className="divide-y divide-jet-border/50">
            {datasets.map(d => (
              <div key={d.name} className="flex items-center gap-3 px-4 py-3">
                <span className="text-base">{d.type === 'directory' ? '📁' : '📄'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono font-bold text-jet-text truncate">{d.name}</div>
                  <div className="text-[10px] font-mono text-jet-dim">
                    {d.type} · {formatBytes(d.size_bytes)} · {formatDate(d.modified)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-[10px] font-mono text-jet-dim border-t border-jet-border/40 pt-3">
        <p>Access datasets from scripts at <span className="text-jet-text">/workspace/datasets/</span></p>
        <p className="mt-0.5">Add datasets via SSH: <span className="text-jet-text">scp data.zip jetbot@192.168.1.138:~/jetson-workspace/datasets/</span></p>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MLPage() {
  const [status,     setStatus]     = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [tab,        setTab]        = useState('Run')
  const [activeJob,  setActiveJob]  = useState(null)

  useEffect(() => {
    const fetch = async () => {
      try {
        const s = await apiFetch('/ml/status')
        setStatus(s)
      } catch {
        setStatus({ available: false, error: 'Backend unreachable' })
      } finally {
        setLoading(false)
      }
    }
    fetch()
    const iv = setInterval(fetch, 8000)
    return () => clearInterval(iv)
  }, [])

  const handleJobSubmitted = (jobId) => {
    setActiveJob(jobId)
    setTab('Jobs')
  }

  const available = status?.available ?? false

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-jet-text tracking-tight">ML Workspace</h1>
          <p className="text-xs text-jet-dim mt-0.5 font-mono">
            jetson-ai:latest · Python 3.12 · OpenCV · scikit-learn · pandas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${available ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          <span className={`text-[10px] font-mono ${available ? 'text-green-400' : 'text-red-400'}`}>
            {loading ? 'DETECTING…' : available ? 'READY' : 'UNAVAILABLE'}
          </span>
          {available && status?.current_job && (
            <span className="text-[10px] font-mono text-blue-400 border border-blue-400/30 px-2 py-0.5 rounded">
              JOB RUNNING
            </span>
          )}
        </div>
      </div>

      {/* Unavailable */}
      {!loading && !available && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-1">
          <p className="text-sm font-mono text-red-400">⚠ ML environment not available</p>
          <p className="text-xs text-jet-dim">{status?.error}</p>
          <p className="text-xs text-jet-dim mt-2">
            Make sure the <span className="text-jet-text">jetson-ai:latest</span> Docker image is built:
            <span className="text-jet-text ml-1">cd ~/jetson-docker && docker build -t jetson-ai:latest .</span>
          </p>
        </div>
      )}

      {/* GPU devices info */}
      {available && (
        <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg border border-jet-border bg-jet-surface font-mono text-[10px]">
          <span className="text-jet-dim">GPU DEVICES</span>
          <span className="text-jet-text">{(status?.gpu_devices || []).length} mounted</span>
          <span className="text-jet-dim">|</span>
          <span className="text-jet-dim">WORKSPACE</span>
          <span className="text-jet-text truncate">{status?.workspace}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-jet-surface rounded-xl border border-jet-border w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-mono font-bold tracking-wide transition-all
              ${tab === t
                ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                : 'text-jet-dim hover:text-jet-text'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'Run'      && <RunTab available={available} onJobSubmitted={handleJobSubmitted} />}
      {tab === 'Jobs'     && <JobsTab />}
      {tab === 'Models'   && <ModelsTab />}
      {tab === 'Datasets' && <DatasetsTab />}

    </div>
  )
}
