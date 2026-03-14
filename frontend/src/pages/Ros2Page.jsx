/**
 * ROS2 Monitor Page
 * Muestra nodos, topics y frecuencias en tiempo real.
 * Funciona con ROS2 en Docker o en host nativo.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Cpu, Radio, RefreshCw, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle, Activity, Eye, Box
} from 'lucide-react'
import { apiFetch } from '../utils/format'

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ available, distro, type, container }) {
  if (!available) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border font-mono text-[10px]" style={{borderColor:"var(--color-border)",background:"var(--color-surface)"}}>
        <span className="w-1.5 h-1.5 rounded-full bg-jet-dim"/>
        <span className="text-jet-dim">ROS2 NOT RUNNING</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg border font-mono text-[10px]" style={{borderColor:"var(--color-border)",background:"var(--color-surface)"}}>
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-jet-green animate-pulse"/>
        <span className="text-jet-green">ACTIVE</span>
      </span>
      <span className="text-jet-muted">|</span>
      <span><span className="text-jet-muted">DISTRO </span><span className="text-jet-cyan">{distro}</span></span>
      <span><span className="text-jet-muted">TYPE </span><span className="text-jet-dim">{type}</span></span>
      {container && <span><span className="text-jet-muted">CTR </span><span className="text-jet-dim">{container}</span></span>}
    </div>
  )
}

// ── Node card ─────────────────────────────────────────────────────────────────
function NodeCard({ node }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="panel">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors" style={{background:"transparent"}} onMouseEnter={e=>e.currentTarget.style.background="var(--color-surface)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
           onClick={() => setOpen(o => !o)}>
        <Box size={12} className="text-jet-cyan flex-shrink-0"/>
        <span className="font-mono text-sm text-jet-text flex-1 truncate">{node.name}</span>
        <div className="flex items-center gap-3 font-mono text-[10px] text-jet-dim">
          <span>{node.publishers.length} pub</span>
          <span>{node.subscribers.length} sub</span>
          <span>{node.services.length} svc</span>
        </div>
        {open ? <ChevronUp size={12} className="text-jet-dim"/> : <ChevronDown size={12} className="text-jet-dim"/>}
      </div>

      {open && (
        <div className="border-t px-4 py-3 space-y-3" style={{borderColor:"var(--color-border)",background:"var(--color-surface)"}}>
          {node.publishers.length > 0 && (
            <div>
              <div className="font-mono text-[10px] text-jet-muted mb-1.5 uppercase tracking-widest">Publishers</div>
              {node.publishers.map((p, i) => (
                <div key={i} className="flex justify-between font-mono text-[11px] py-0.5">
                  <span className="text-jet-cyan">{p.topic}</span>
                  <span className="text-jet-dim">{p.type}</span>
                </div>
              ))}
            </div>
          )}
          {node.subscribers.length > 0 && (
            <div>
              <div className="font-mono text-[10px] text-jet-muted mb-1.5 uppercase tracking-widest">Subscribers</div>
              {node.subscribers.map((s, i) => (
                <div key={i} className="flex justify-between font-mono text-[11px] py-0.5">
                  <span className="text-jet-text">{s.topic}</span>
                  <span className="text-jet-dim">{s.type}</span>
                </div>
              ))}
            </div>
          )}
          {node.services.length > 0 && (
            <div>
              <div className="font-mono text-[10px] text-jet-muted mb-1.5 uppercase tracking-widest">Services</div>
              {node.services.map((s, i) => (
                <div key={i} className="font-mono text-[11px] py-0.5 text-jet-dim">{s.topic}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Topic row ─────────────────────────────────────────────────────────────────
function TopicRow({ topic, onEcho }) {
  const hzColor = topic.hz === null ? 'text-jet-dim'
    : topic.hz > 10 ? 'text-jet-green'
    : topic.hz > 1  ? 'text-jet-yellow'
    : 'text-jet-orange'

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-jet-border/50 hover:bg-jet-surface/30 font-mono text-[11px]">
      <Radio size={10} className="text-jet-cyan flex-shrink-0"/>
      <span className="flex-1 text-jet-text truncate">{topic.name}</span>
      <span className="text-jet-dim truncate max-w-[200px] hidden md:block">{topic.type}</span>
      <span className={`w-16 text-right ${hzColor}`}>
        {topic.hz !== null ? `${topic.hz} Hz` : '—'}
      </span>
      <span className="text-jet-dim w-10 text-right">{topic.publishers}p</span>
      <span className="text-jet-dim w-10 text-right">{topic.subscribers}s</span>
      <button onClick={() => onEcho(topic.name)}
              className="flex items-center gap-1 px-2 py-0.5 border border-jet-border rounded hover:border-jet-cyan/40 hover:text-jet-cyan text-jet-dim transition-colors">
        <Eye size={9}/>Echo
      </button>
    </div>
  )
}

// ── Echo modal ────────────────────────────────────────────────────────────────
function EchoModal({ topic, data, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl border rounded-xl flex flex-col" style={{borderColor:"var(--color-border)",background:"var(--color-surface)"}}
           style={{ maxHeight: '70vh' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{borderColor:"var(--color-border)"}}>
          <div className="flex items-center gap-2">
            <Eye size={13} className="text-jet-cyan"/>
            <span className="font-mono text-sm text-jet-text">{topic}</span>
          </div>
          <button onClick={onClose}
                  className="font-mono text-[10px] px-3 py-1 border border-jet-border rounded text-jet-dim hover:text-jet-cyan hover:border-jet-cyan/40 transition-colors">
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <pre className="font-mono text-[11px] text-jet-dim whitespace-pre-wrap break-all">
            {data || 'No data received'}
          </pre>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Ros2Page() {
  const [status,    setStatus]    = useState(null)
  const [nodes,     setNodes]     = useState([])
  const [topics,    setTopics]    = useState([])
  const [tab,       setTab]       = useState('nodes')  // nodes | topics
  const [loading,   setLoading]   = useState(true)
  const [loadingTopics, setLoadingTopics] = useState(false)
  const [echo,      setEcho]      = useState(null)  // { topic, data }
  const [lastUpdate, setLastUpdate] = useState(null)

  const fetchStatus = useCallback(async () => {
    try {
      const r = await apiFetch('/ros2/status')
      setStatus(r)
      return r.available
    } catch(e) {
      setStatus({ available: false, reason: e.message })
      return false
    }
  }, [])

  const fetchNodes = useCallback(async () => {
    try {
      const r = await apiFetch('/ros2/nodes')
      setNodes(r.nodes || [])
    } catch(e) {
      setNodes([])
    }
  }, [])

  const fetchTopics = useCallback(async () => {
    setLoadingTopics(true)
    try {
      const r = await apiFetch('/ros2/topics')
      setTopics(r.topics || [])
    } catch(e) {
      setTopics([])
    } finally {
      setLoadingTopics(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    const available = await fetchStatus()
    if (available) {
      await fetchNodes()
      if (tab === 'topics') await fetchTopics()
    }
    setLastUpdate(new Date().toLocaleTimeString())
    setLoading(false)
  }, [fetchStatus, fetchNodes, fetchTopics, tab])

  useEffect(() => { refresh() }, [])

  useEffect(() => {
    if (tab === 'topics' && topics.length === 0 && status?.available) {
      fetchTopics()
    }
  }, [tab])

  // Auto-refresh cada 10s
  useEffect(() => {
    const t = setInterval(refresh, 10000)
    return () => clearInterval(t)
  }, [refresh])

  const echoTopic = async (topicName) => {
    setEcho({ topic: topicName, data: 'Loading...' })
    try {
      const r = await apiFetch(`/ros2/topics${topicName}/echo`)
      setEcho({ topic: topicName, data: r.message })
    } catch(e) {
      setEcho({ topic: topicName, data: `Error: ${e.message}` })
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity size={18} className="text-jet-cyan"/>
          <h1 className="font-display text-lg font-bold tracking-widest">ROS2</h1>
          {status && (
            <span className="font-mono text-[10px] text-jet-dim">
              {status.node_count ?? 0} nodes · {status.topic_count ?? 0} topics
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="font-mono text-[10px] text-jet-muted">Updated {lastUpdate}</span>
          )}
          <button onClick={refresh}
                  className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] border border-jet-border rounded hover:border-jet-cyan/40 hover:text-jet-cyan text-jet-dim transition-colors">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''}/>Refresh
          </button>
        </div>
      </div>

      {/* Status */}
      {status && (
        <StatusBadge
          available={status.available}
          distro={status.distro}
          type={status.type}
          container={status.container}
        />
      )}

      {/* Not available message */}
      {status && !status.available && (
        <div className="panel p-6 text-center space-y-3">
          <AlertCircle size={32} className="mx-auto text-jet-dim"/>
          <p className="font-mono text-sm text-jet-dim">ROS2 is not running</p>
          <p className="font-mono text-[11px] text-jet-muted max-w-md mx-auto">
            {status.reason || 'Start a ROS2 container or install ROS2 on the host to begin monitoring.'}
          </p>
          <div className="mt-4 p-3 rounded-lg border text-left" style={{borderColor:"var(--color-border)",background:"var(--color-surface)"}}>
            <p className="font-mono text-[10px] text-jet-muted mb-2">Start ROS2 on your Jetson:</p>
            <code className="font-mono text-[11px] text-jet-cyan block">jros</code>
            <code className="font-mono text-[11px] text-jet-cyan block mt-1">jcam_node  # IMX219 camera node</code>
          </div>
        </div>
      )}

      {/* Content — only when available */}
      {status?.available && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 border-b border-jet-border">
            {[
              { id: 'nodes',  label: 'Nodes',  icon: Box,   count: nodes.length },
              { id: 'topics', label: 'Topics', icon: Radio, count: topics.length },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                      className={`flex items-center gap-1.5 px-4 py-2 font-mono text-[10px] border-b-2 -mb-px transition-colors ${
                        tab === t.id
                          ? 'border-jet-cyan text-jet-cyan'
                          : 'border-transparent text-jet-dim hover:text-jet-text'
                      }`}>
                <t.icon size={10}/>
                {t.label}
                <span className="px-1.5 py-0.5 rounded-full bg-jet-border text-[9px]">{t.count}</span>
              </button>
            ))}
          </div>

          {/* Nodes tab */}
          {tab === 'nodes' && (
            <div className="space-y-2">
              {loading ? (
                <div className="text-center py-10 font-mono text-sm text-jet-dim">
                  <RefreshCw size={20} className="mx-auto mb-2 animate-spin opacity-40"/>
                  Loading nodes...
                </div>
              ) : nodes.length === 0 ? (
                <div className="text-center py-10 font-mono text-sm text-jet-dim">No nodes running</div>
              ) : (
                nodes.map(n => <NodeCard key={n.name} node={n}/>)
              )}
            </div>
          )}

          {/* Topics tab */}
          {tab === 'topics' && (
            <div className="panel">
              {/* Header row */}
              <div className="panel-header font-mono text-[10px] uppercase tracking-widest" style={{color:"var(--color-dim)"}}>
                <span className="w-4"/>
                <span className="flex-1">Topic</span>
                <span className="hidden md:block max-w-[200px] w-full">Type</span>
                <span className="w-16 text-right">Hz</span>
                <span className="w-10 text-right">Pub</span>
                <span className="w-10 text-right">Sub</span>
                <span className="w-14"/>
              </div>
              {loadingTopics ? (
                <div className="text-center py-10 font-mono text-sm text-jet-dim">
                  <RefreshCw size={20} className="mx-auto mb-2 animate-spin opacity-40"/>
                  Loading topics & frequencies...
                </div>
              ) : topics.length === 0 ? (
                <div className="text-center py-10 font-mono text-sm text-jet-dim">No topics found</div>
              ) : (
                topics.map(t => (
                  <TopicRow key={t.name} topic={t} onEcho={echoTopic}/>
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* Echo modal */}
      {echo && (
        <EchoModal
          topic={echo.topic}
          data={echo.data}
          onClose={() => setEcho(null)}
        />
      )}
    </div>
  )
}
