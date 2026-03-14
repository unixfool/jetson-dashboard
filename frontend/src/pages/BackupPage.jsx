/**
 * Backup / Restore Page - Jetson Dashboard
 */
import { useState, useEffect, useRef } from 'react'
import {
  Download, Upload, Shield, Trash2, RefreshCw,
  CheckCircle, AlertCircle, Info, Archive, Clock
} from 'lucide-react'
import { apiFetch } from '../utils/format'

function formatBytes(b) {
  if (b === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(b) / Math.log(k))
  return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

// ── File row ──────────────────────────────────────────────────────────────────
function FileRow({ file }) {
  const exists = file.exists !== false
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-jet-border/50 font-mono text-[11px]">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${exists ? 'bg-jet-green' : 'bg-jet-dim'}`}/>
      <span className={`flex-1 ${exists ? 'text-jet-text' : 'text-jet-dim'}`}>{file.name}</span>
      <span className="text-jet-dim w-20 text-right">{exists ? formatBytes(file.size) : 'not found'}</span>
      <span className="text-jet-muted w-36 text-right hidden md:block">
        {file.modified ? formatDate(file.modified) : '—'}
      </span>
    </div>
  )
}

// ── Safety backup row ─────────────────────────────────────────────────────────
function SafetyRow({ backup, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-jet-border/50 font-mono text-[11px]">
      <Archive size={11} className="text-jet-dim flex-shrink-0"/>
      <span className="flex-1 text-jet-dim">{backup.name}</span>
      <span className="text-jet-dim w-16 text-right">{formatBytes(backup.size)}</span>
      <span className="text-jet-muted w-36 text-right hidden md:block">{formatDate(backup.created)}</span>
      {confirming ? (
        <div className="flex items-center gap-1.5">
          <button onClick={() => { onDelete(backup.name); setConfirming(false) }}
                  className="px-2 py-0.5 border border-red-500/40 rounded text-red-400 hover:bg-red-500/10 transition-colors">
            Confirm
          </button>
          <button onClick={() => setConfirming(false)}
                  className="px-2 py-0.5 border border-jet-border rounded text-jet-dim hover:text-jet-text transition-colors">
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)}
                className="p-1 text-jet-dim hover:text-red-400 transition-colors">
          <Trash2 size={11}/>
        </button>
      )}
    </div>
  )
}

// ── Toggle option ─────────────────────────────────────────────────────────────
function RestoreOption({ label, description, checked, onChange, warning }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="relative mt-0.5">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
               className="sr-only"/>
        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
          checked ? 'border-jet-cyan bg-jet-cyan/20' : 'border-jet-border'
        }`}>
          {checked && <div className="w-2 h-2 rounded-sm bg-jet-cyan"/>}
        </div>
      </div>
      <div>
        <span className={`font-mono text-[11px] ${checked ? 'text-jet-text' : 'text-jet-dim'}`}>
          {label}
        </span>
        {description && (
          <p className="font-mono text-[10px] text-jet-muted mt-0.5">{description}</p>
        )}
        {warning && checked && (
          <p className="font-mono text-[10px] text-jet-orange mt-0.5">⚠ {warning}</p>
        )}
      </div>
    </label>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BackupPage() {
  const [info,           setInfo]          = useState(null)
  const [safetyBackups,  setSafetyBackups] = useState([])
  const [loading,        setLoading]       = useState(true)
  const [downloading,    setDownloading]   = useState(false)
  const [restoring,      setRestoring]     = useState(false)
  const [result,         setResult]        = useState(null)  // { type: 'success'|'error', message, detail }
  const fileRef = useRef(null)

  // Restore options
  const [optSettings, setOptSettings] = useState(true)
  const [optAlerts,   setOptAlerts]   = useState(true)
  const [optHistory,  setOptHistory]  = useState(true)
  const [optMetrics,  setOptMetrics]  = useState(false)
  const [optSsl,      setOptSsl]      = useState(false)

  const loadInfo = async () => {
    setLoading(true)
    try {
      const [infoRes, safetyRes] = await Promise.all([
        apiFetch('/backup/info'),
        apiFetch('/backup/safety-backups'),
      ])
      setInfo(infoRes)
      setSafetyBackups(safetyRes.backups || [])
    } catch(e) {
      setResult({ type: 'error', message: 'Failed to load backup info', detail: e.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadInfo() }, [])

  const handleDownload = async () => {
    setDownloading(true)
    setResult(null)
    try {
      const token = localStorage.getItem('jetson_dashboard_token')
      const res = await fetch('/api/backup/download', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const cd   = res.headers.get('content-disposition') || ''
      const match = cd.match(/filename=(.+)/)
      a.download = match ? match[1] : 'jetson-dashboard-backup.zip'
      a.href = url
      a.click()
      URL.revokeObjectURL(url)
      setResult({ type: 'success', message: 'Backup downloaded successfully' })
    } catch(e) {
      setResult({ type: 'error', message: 'Download failed', detail: e.message })
    } finally {
      setDownloading(false)
    }
  }

  const handleRestore = async (file) => {
    if (!file) return
    setRestoring(true)
    setResult(null)
    try {
      const token = localStorage.getItem('jetson_dashboard_token')

      // Build FormData — do NOT set Content-Type header manually.
      // The browser sets it automatically with the correct multipart boundary.
      const fd = new FormData()
      fd.append('file', file)

      // Pass boolean options as query params (FastAPI reads them from the URL)
      const params = new URLSearchParams({
        restore_settings: optSettings  ? 'true' : 'false',
        restore_alerts:   optAlerts    ? 'true' : 'false',
        restore_history:  optHistory   ? 'true' : 'false',
        restore_metrics:  optMetrics   ? 'true' : 'false',
        restore_ssl:      optSsl       ? 'true' : 'false',
      })

      const res = await fetch(`/api/backup/restore?${params}`, {
        method: 'POST',
        // Only Authorization — no Content-Type (browser handles multipart)
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })

      // Safe JSON parse — server may return HTML on unexpected errors
      let data
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        data = await res.json()
      } else {
        const text = await res.text()
        throw new Error(`Server error (HTTP ${res.status}): ${text.slice(0, 120)}`)
      }

      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)

      setResult({
        type:    'success',
        message: `Restored ${data.restored?.length ?? 0} file(s) successfully`,
        detail:  data.note,
        items:   data.restored  || [],
        skipped: data.skipped   || [],
      })
      loadInfo()
    } catch(e) {
      setResult({ type: 'error', message: 'Restore failed', detail: e.message })
    } finally {
      setRestoring(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDeleteSafety = async (name) => {
    try {
      await apiFetch(`/backup/safety-backups/${name}`, { method: 'DELETE' })
      setSafetyBackups(sb => sb.filter(b => b.name !== name))
    } catch(e) {
      setResult({ type: 'error', message: 'Delete failed', detail: e.message })
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield size={18} className="text-jet-cyan"/>
          <h1 className="font-display text-lg font-bold tracking-widest">BACKUP & RESTORE</h1>
        </div>
        <button onClick={loadInfo}
                className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] border border-jet-border rounded hover:border-jet-cyan/40 hover:text-jet-cyan text-jet-dim transition-colors">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''}/>Refresh
        </button>
      </div>

      {/* Result message */}
      {result && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border font-mono text-[11px] ${
          result.type === 'success'
            ? 'border-jet-green/30 bg-jet-green/5 text-jet-green'
            : 'border-red-500/30 bg-red-500/5 text-red-400'
        }`}>
          {result.type === 'success'
            ? <CheckCircle size={14} className="flex-shrink-0 mt-0.5"/>
            : <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>
          }
          <div className="space-y-1">
            <p>{result.message}</p>
            {result.detail && <p className="text-jet-dim">{result.detail}</p>}
            {result.items?.length > 0 && (
              <p className="text-jet-muted">Files: {result.items.join(', ')}</p>
            )}
          </div>
          <button onClick={() => setResult(null)} className="ml-auto text-jet-dim hover:text-jet-text">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Backup */}
        <div className="panel">
          <div className="panel-header">
            <Download size={13} className="text-jet-cyan"/>
            <span className="font-mono text-xs font-bold tracking-widest text-jet-text">CREATE BACKUP</span>
          </div>

          <div className="panel-body space-y-4">
            {/* Files list */}
            <div className="panel">
              <div className="panel-header font-mono text-[10px] uppercase tracking-widest" style={{color:"var(--color-dim)"}}>
                <span className="w-1.5"/>
                <span className="flex-1">File</span>
                <span className="w-20 text-right">Size</span>
                <span className="w-36 text-right hidden md:block">Modified</span>
              </div>
              {loading ? (
                <div className="py-6 text-center font-mono text-[11px] text-jet-dim">Loading...</div>
              ) : (
                info?.files.map(f => <FileRow key={f.name} file={f}/>)
              )}
              {info && (
                <div className="flex items-center justify-between px-4 py-2 font-mono text-[10px]" style={{background:"var(--color-surface)"}}>
                  <span className="text-jet-muted">Total</span>
                  <span className="text-jet-cyan">{formatBytes(info.total_bytes)}</span>
                </div>
              )}
            </div>

            <button
              onClick={handleDownload}
              disabled={downloading || loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 font-mono text-[11px] border border-jet-cyan/40 rounded-lg text-jet-cyan hover:bg-jet-cyan/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {downloading
                ? <><RefreshCw size={12} className="animate-spin"/>Generating backup...</>
                : <><Download size={12}/>Download Backup ZIP</>
              }
            </button>
          </div>
        </div>

        {/* Restore */}
        <div className="panel">
          <div className="panel-header">
            <Upload size={13} className="text-jet-yellow"/>
            <span className="font-mono text-xs font-bold tracking-widest text-jet-text">RESTORE BACKUP</span>
          </div>

          <div className="panel-body space-y-4">
            {/* Info box */}
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border" style={{borderColor:"var(--color-border)",background:"var(--color-surface)"}}>
              <Info size={11} className="text-jet-cyan flex-shrink-0 mt-0.5"/>
              <p className="font-mono text-[10px] text-jet-muted">
                Before restoring, a safety backup is created automatically.
                Select which data to restore below.
              </p>
            </div>

            {/* Options */}
            <div className="space-y-3 px-1">
              <RestoreOption
                label="Settings"
                description="Fan, power mode, general preferences"
                checked={optSettings}
                onChange={setOptSettings}
              />
              <RestoreOption
                label="Alert rules & notifications"
                description="Alert thresholds, email, Telegram config"
                checked={optAlerts}
                onChange={setOptAlerts}
              />
              <RestoreOption
                label="Alert history"
                description="Past alert events log"
                checked={optHistory}
                onChange={setOptHistory}
              />
              <RestoreOption
                label="Metrics database"
                description="SQLite history (can be large)"
                checked={optMetrics}
                onChange={setOptMetrics}
                warning="This will overwrite all historical metrics data"
              />
              <RestoreOption
                label="SSL certificates"
                description="HTTPS certificate and private key"
                checked={optSsl}
                onChange={setOptSsl}
                warning="Requires backend restart to take effect"
              />
            </div>

            {/* File input */}
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={e => handleRestore(e.target.files?.[0])}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={restoring}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 font-mono text-[11px] border border-jet-yellow/40 rounded-lg text-jet-yellow hover:bg-jet-yellow/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {restoring
                  ? <><RefreshCw size={12} className="animate-spin"/>Restoring...</>
                  : <><Upload size={12}/>Select Backup ZIP to Restore</>
                }
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Safety backups */}
      {safetyBackups.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <Clock size={13} className="text-jet-dim"/>
            <span className="font-mono text-xs font-bold tracking-widest text-jet-text">PRE-RESTORE SAFETY BACKUPS</span>
            <span className="font-mono text-[10px] text-jet-muted ml-auto">Auto-created before each restore</span>
          </div>
          {safetyBackups.map(b => (
            <SafetyRow key={b.name} backup={b} onDelete={handleDeleteSafety}/>
          ))}
        </div>
      )}
    </div>
  )
}
