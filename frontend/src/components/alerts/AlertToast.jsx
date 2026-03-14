/**
 * Alert Toast - Notificaciones flotantes en tiempo real
 */
import { useState, useEffect } from 'react'
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react'

const SEVERITY_STYLE = {
  critical: { color: '#f85149', bg: '#1a0a0a', border: 'rgba(248,81,73,0.4)', Icon: AlertCircle },
  warning:  { color: '#d29922', bg: '#1a1400', border: 'rgba(210,153,34,0.4)', Icon: AlertTriangle },
  info:     { color: '#58a6ff', bg: '#0a0f1a', border: 'rgba(88,166,255,0.4)', Icon: Info },
}

function Toast({ alert, onClose }) {
  const s = SEVERITY_STYLE[alert.severity] || SEVERITY_STYLE.info
  const { Icon } = s

  useEffect(() => {
    const duration = alert.severity === 'critical' ? 8000 : 5000
    const id = setTimeout(onClose, duration)
    return () => clearTimeout(id)
  }, [])

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border shadow-2xl min-w-72 max-w-sm"
         style={{ background: s.bg, borderColor: s.border,
                  boxShadow: `0 0 20px ${s.color}20`,
                  animation: 'slideIn 0.2s ease-out' }}>
      <Icon size={16} style={{ color: s.color, flexShrink: 0, marginTop: 1 }} />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[10px] font-bold mb-0.5" style={{ color: s.color }}>
          {alert.severity.toUpperCase()} ALERT
        </div>
        <div className="font-mono text-xs text-jet-text">{alert.message}</div>
      </div>
      <button onClick={onClose} className="text-jet-muted hover:text-jet-dim flex-shrink-0">
        <X size={12} />
      </button>
    </div>
  )
}

export function AlertToastContainer({ alerts }) {
  const [visible, setVisible] = useState([])

  useEffect(() => {
    if (!alerts?.length) return
    const newToasts = alerts.map(a => ({ ...a, _toastId: `${a.id}_${Date.now()}` }))
    setVisible(prev => [...prev, ...newToasts].slice(-5))
  }, [alerts])

  const dismiss = (toastId) => setVisible(prev => prev.filter(t => t._toastId !== toastId))

  if (!visible.length) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      {visible.map(toast => (
        <Toast key={toast._toastId} alert={toast} onClose={() => dismiss(toast._toastId)} />
      ))}
    </div>
  )
}
