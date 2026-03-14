/**
 * Camera Page — IMX219 CSI Camera
 * Polling de frames autenticados via apiFetch → canvas
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Camera, CameraOff, Image, RefreshCw, Download, Play, Square, Info } from 'lucide-react'
import { API_BASE } from '../utils/format'

// apiFetch retorna JSON, pero para imágenes necesitamos fetch raw con auth
async function fetchFrame() {
  const token = localStorage.getItem('jetson_dashboard_token')
  const headers = token && token !== 'auth-disabled'
    ? { Authorization: `Bearer ${token}` }
    : {}
  const res = await fetch(`${API_BASE}/camera/frame`, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

async function fetchSnapshot() {
  const token = localStorage.getItem('jetson_dashboard_token')
  const headers = token && token !== 'auth-disabled'
    ? { Authorization: `Bearer ${token}` }
    : {}
  const res = await fetch(`${API_BASE}/camera/snapshot`, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

async function apiPost(path) {
  const token = localStorage.getItem('jetson_dashboard_token')
  const headers = {
    'Content-Type': 'application/json',
    ...(token && token !== 'auth-disabled' ? { Authorization: `Bearer ${token}` } : {})
  }
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function apiGet(path) {
  const token = localStorage.getItem('jetson_dashboard_token')
  const headers = token && token !== 'auth-disabled'
    ? { Authorization: `Bearer ${token}` }
    : {}
  const res = await fetch(`${API_BASE}${path}`, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export default function CameraPage() {
  const [streaming,  setStreaming]  = useState(false)
  const [status,     setStatus]     = useState(null)
  const [capturing,  setCapturing]  = useState(false)
  const [snapshot,   setSnapshot]   = useState(null)
  const [error,      setError]      = useState(null)
  const [fps,        setFps]        = useState(0)
  const imgRef      = useRef(null)
  const pollRef     = useRef(null)
  const frameCount  = useRef(0)
  const fpsTimer    = useRef(null)
  const currentUrl  = useRef(null)

  const fetchStatus = useCallback(async () => {
    try {
      const r = await apiGet('/camera/status')
      setStatus(r)
    } catch(e) { /* silent */ }
  }, [])

  useEffect(() => {
    fetchStatus()
    const t = setInterval(fetchStatus, 5000)
    return () => clearInterval(t)
  }, [fetchStatus])

  // FPS counter
  useEffect(() => {
    fpsTimer.current = setInterval(() => {
      setFps(frameCount.current)
      frameCount.current = 0
    }, 1000)
    return () => clearInterval(fpsTimer.current)
  }, [])

  const startPolling = useCallback(() => {
    if (pollRef.current) return

    const poll = async () => {
      try {
        const blob = await fetchFrame()
        // Revocar URL anterior para evitar memory leak
        if (currentUrl.current) URL.revokeObjectURL(currentUrl.current)
        const url = URL.createObjectURL(blob)
        currentUrl.current = url
        if (imgRef.current) imgRef.current.src = url
        frameCount.current++
        setError(null)
      } catch(e) {
        setError(`Frame error: ${e.message}`)
      }
      // Programar siguiente frame (100ms = ~10fps)
      pollRef.current = setTimeout(poll, 100)
    }

    poll()
  }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current)
      pollRef.current = null
    }
    if (currentUrl.current) {
      URL.revokeObjectURL(currentUrl.current)
      currentUrl.current = null
    }
    if (imgRef.current) imgRef.current.src = ''
  }, [])

  const startStream = async () => {
    try {
      await apiPost('/camera/start')
      setStreaming(true)
      setError(null)
      startPolling()
    } catch(e) {
      setError(e.message)
    }
  }

  const stopStream = async () => {
    try {
      stopPolling()
      await apiPost('/camera/stop')
      setStreaming(false)
    } catch(e) {
      setError(e.message)
    }
  }

  // Cleanup al desmontar
  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  const takeSnapshot = async () => {
    setCapturing(true)
    try {
      const blob = await fetchSnapshot()
      if (snapshot?.url) URL.revokeObjectURL(snapshot.url)
      const url = URL.createObjectURL(blob)
      setSnapshot({ url, ts: new Date().toLocaleTimeString() })
    } catch(e) {
      setError(`Snapshot failed: ${e.message}`)
    } finally {
      setCapturing(false)
    }
  }

  const downloadSnapshot = () => {
    if (!snapshot) return
    const a = document.createElement('a')
    a.href = snapshot.url
    a.download = `jetson-${Date.now()}.jpg`
    a.click()
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Camera size={18} className="text-jet-cyan"/>
          <h1 className="font-display text-lg font-bold tracking-widest">CAMERA</h1>
          <span className="font-mono text-[10px] text-jet-dim">IMX219 CSI</span>
        </div>
        <button onClick={fetchStatus}
                className="btn-ghost text-[10px]">
          <RefreshCw size={11}/>Status
        </button>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg border font-mono text-[10px]" style={{borderColor:"var(--color-border)",background:"var(--color-surface)"}}>
        <span className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${streaming ? 'bg-jet-green animate-pulse' : 'bg-jet-dim'}`}/>
          <span className="text-jet-muted">STATUS</span>
          <span className={streaming ? 'text-jet-green' : 'text-jet-dim'}>
            {streaming ? 'STREAMING' : 'IDLE'}
          </span>
        </span>
        <span className="text-jet-muted">|</span>
        <span><span className="text-jet-muted">DEVICE </span><span className="text-jet-dim">/dev/video0</span></span>
        <span><span className="text-jet-muted">RES </span><span className="text-jet-dim">1280×720</span></span>
        {streaming && (
          <span><span className="text-jet-muted">FPS </span><span className="text-jet-cyan">{fps}</span></span>
        )}
        {status?.last_frame_age != null && (
          <span><span className="text-jet-muted">LAST FRAME </span><span className="text-jet-dim">{status.last_frame_age}s ago</span></span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 font-mono text-xs text-red-400">
          ⚠ {error}
        </div>
      )}

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Stream panel */}
        <div className="lg:col-span-2 space-y-3">
          <div className="panel overflow-hidden relative" style={{background:"#000"}}
               style={{ aspectRatio: '16/9' }}>

            <img ref={imgRef} alt="Camera feed"
                 className="w-full h-full object-contain"
                 style={{ display: streaming ? 'block' : 'none' }}/>

            {!streaming && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <CameraOff size={40} className="text-jet-border"/>
                <span className="font-mono text-xs text-jet-dim">Stream not active</span>
                <span className="font-mono text-[10px] text-jet-muted">Press Start to begin</span>
              </div>
            )}

            {streaming && (
              <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 bg-black/70 rounded font-mono text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"/>
                <span className="text-white">LIVE</span>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {!streaming ? (
              <button onClick={startStream}
                      className="flex items-center gap-2 px-4 py-2 font-mono text-xs border border-jet-cyan/40 text-jet-cyan rounded hover:bg-jet-cyan/10 transition-colors">
                <Play size={12}/>Start Stream
              </button>
            ) : (
              <button onClick={stopStream}
                      className="flex items-center gap-2 px-4 py-2 font-mono text-xs border border-red-500/40 text-red-400 rounded hover:bg-red-500/10 transition-colors">
                <Square size={12}/>Stop Stream
              </button>
            )}
            <button onClick={takeSnapshot} disabled={capturing}
                    className="btn-ghost disabled:opacity-40">
              {capturing ? <RefreshCw size={12} className="animate-spin"/> : <Image size={12}/>}
              {capturing ? 'Capturing...' : 'Snapshot'}
            </button>
          </div>
        </div>

        {/* Right panel */}
        <div className="space-y-3">
          <div className="panel p-4 space-y-3">
            <div className="flex items-center gap-2 font-mono text-[10px] text-jet-muted uppercase tracking-widest">
              <Info size={10}/>Camera Info
            </div>
            <div className="space-y-2 font-mono text-[11px]">
              {[
                ['Sensor',    'IMX219'],
                ['Interface', 'CSI-2'],
                ['Format',    'RAW10 Bayer BG'],
                ['Pipeline',  'v4l2 → debayer → JPEG'],
                ['Driver',    'tegra-video'],
              ].map(([k,v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-jet-muted">{k}</span>
                  <span className="text-jet-dim">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {snapshot && (
            <div className="panel">
              <div className="panel-header">
                <span className="font-mono text-[10px] text-jet-muted">SNAPSHOT — {snapshot.ts}</span>
                <button onClick={downloadSnapshot}
                        className="flex items-center gap-1 font-mono text-[10px] text-jet-cyan hover:underline">
                  <Download size={10}/>Save
                </button>
              </div>
              <img src={snapshot.url} alt="Snapshot" className="w-full object-contain"/>
            </div>
          )}

          <div className="panel p-3">
            <p className="font-mono text-[10px] text-jet-muted leading-relaxed">
              ℹ Captura RAW10 Bayer procesada en software.
              nvargus no disponible en Ubuntu 24 sin JetPack nativo.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
