/**
 * Alerts Page - Gestión completa de alertas
 * Config persistente en data/alerts_config.json via API
 */
import { useState, useEffect, useCallback } from 'react'
import { Bell, BellOff, CheckCheck, Settings, Mail, Send,
         AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp, Save } from 'lucide-react'
import { apiFetch } from '../utils/format'

const SEVERITY_STYLE = {
  critical: { color: '#f85149', bg: 'rgba(248,81,73,0.1)',  border: 'rgba(248,81,73,0.3)',  icon: AlertCircle,  label: 'CRITICAL' },
  warning:  { color: '#d29922', bg: 'rgba(210,153,34,0.1)', border: 'rgba(210,153,34,0.3)', icon: AlertTriangle,label: 'WARNING'  },
  info:     { color: '#58a6ff', bg: 'rgba(88,166,255,0.1)', border: 'rgba(88,166,255,0.3)', icon: Info,         label: 'INFO'     },
}

const METRIC_LABELS = {
  cpu_percent: 'CPU Usage',    ram_percent: 'RAM Usage',
  cpu_temp:    'CPU Temp',     gpu_percent: 'GPU Usage',
  gpu_temp:    'GPU Temp',     disk_percent:'Disk Usage',
}
const METRIC_UNITS = {
  cpu_percent: '%', ram_percent: '%', cpu_temp: '°C',
  gpu_percent: '%', gpu_temp:    '°C', disk_percent: '%',
}

function timeAgo(ts) {
  const d = Math.floor((Date.now()/1000) - ts)
  if (d < 60)    return `${d}s ago`
  if (d < 3600)  return `${Math.floor(d/60)}m ago`
  if (d < 86400) return `${Math.floor(d/3600)}h ago`
  return `${Math.floor(d/86400)}d ago`
}

function AlertBadge({ severity }) {
  const s = SEVERITY_STYLE[severity] || SEVERITY_STYLE.info
  const Icon = s.icon
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] font-bold"
          style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
      <Icon size={10}/>{s.label}
    </span>
  )
}

// ─── Alert History ────────────────────────────────────────────────────────────
function AlertHistory({ alerts, onAcknowledge }) {
  if (!alerts.length) return (
    <div className="text-center py-12 font-mono text-sm text-jet-dim">
      <BellOff size={32} className="mx-auto mb-3 opacity-30"/>
      No alerts in history
    </div>
  )
  return (
    <div className="space-y-2">
      {alerts.map(alert => {
        const s = SEVERITY_STYLE[alert.severity] || SEVERITY_STYLE.info
        return (
          <div key={alert.id} className="flex items-start gap-3 p-3 rounded-lg border"
               style={{ background: s.bg, borderColor: s.border, opacity: alert.acknowledged ? 0.5 : 1 }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <AlertBadge severity={alert.severity}/>
                <span className="font-mono text-[10px] text-jet-dim">{timeAgo(alert.timestamp)}</span>
                {alert.notified && <span className="font-mono text-[10px] text-jet-green">✓ notified</span>}
              </div>
              <div className="font-mono text-sm text-jet-text">{alert.message}</div>
              <div className="font-mono text-[10px] text-jet-dim mt-1">
                {METRIC_LABELS[alert.metric] || alert.metric}: {alert.value}
                {METRIC_UNITS[alert.metric] || ''} · threshold: {alert.threshold}{METRIC_UNITS[alert.metric] || ''}
              </div>
            </div>
            {!alert.acknowledged && (
              <button onClick={() => onAcknowledge(alert.id)}
                      className="font-mono text-[10px] text-jet-dim hover:text-jet-cyan px-2 py-1 border border-jet-border rounded hover:border-jet-cyan/30 transition-colors whitespace-nowrap">
                Ack
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Rule Row ─────────────────────────────────────────────────────────────────
function RuleRow({ ruleId, rule, onChange }) {
  const [open, setOpen] = useState(false)
  const unit = METRIC_UNITS[rule.metric] || ''
  return (
    <div className="panel">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors" style={{background:"transparent"}} onMouseEnter={e=>e.currentTarget.style.background="var(--color-surface)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
           onClick={() => setOpen(!open)}>
        <input type="checkbox" checked={rule.enabled || false}
               onChange={e => { e.stopPropagation(); onChange(ruleId, { enabled: e.target.checked }) }}
               className="accent-jet-cyan"/>
        <div className="flex-1 font-mono text-sm text-jet-text">
          {METRIC_LABELS[rule.metric] || rule.metric}
        </div>
        <AlertBadge severity={rule.severity}/>
        <span className="font-mono text-xs text-jet-dim">&gt; {rule.threshold}{unit}</span>
        {open ? <ChevronUp size={12} className="text-jet-dim"/> : <ChevronDown size={12} className="text-jet-dim"/>}
      </div>
      {open && (
        <div className="px-4 pb-4 pt-2 border-t grid grid-cols-2 gap-4" style={{borderColor:"var(--color-border)",background:"var(--color-surface)"}}>
          <label className="block">
            <span className="font-mono text-[10px] text-jet-dim block mb-1">THRESHOLD ({unit})</span>
            <input type="number" value={rule.threshold}
                   onChange={e => onChange(ruleId, { threshold: Number(e.target.value) })}
                   className="jet-input text-sm"/>
          </label>
          <label className="block">
            <span className="font-mono text-[10px] text-jet-dim block mb-1">SEVERITY</span>
            <select value={rule.severity}
                    onChange={e => onChange(ruleId, { severity: e.target.value })}
                    className="jet-input text-sm">
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="block col-span-2">
            <span className="font-mono text-[10px] text-jet-dim block mb-1">COOLDOWN (seconds — mínimo tiempo entre alertas repetidas)</span>
            <input type="number" value={rule.cooldown_seconds}
                   onChange={e => onChange(ruleId, { cooldown_seconds: Number(e.target.value) })}
                   className="jet-input text-sm"/>
          </label>
        </div>
      )}
    </div>
  )
}

// ─── Notifications Config ─────────────────────────────────────────────────────
// Usa estado local completamente independiente para evitar pérdida de datos al escribir
function NotifConfig({ initialConfig, onSave, testResult, onTestEmail, onTestTelegram }) {
  const [email, setEmail] = useState(initialConfig?.email || {})
  const [tg,    setTg]    = useState(initialConfig?.telegram || {})

  // Sincronizar cuando llegan los datos reales del servidor (initialConfig pasa de null a objeto)
  useEffect(() => {
    if (initialConfig) {
      setEmail(initialConfig.email || {})
      setTg(initialConfig.telegram || {})
    }
  }, [initialConfig])
  // Nota: este efecto solo se dispara cuando initialConfig cambia desde null a datos reales
  // y no interfiere con edición del usuario porque después de cargar, initialConfig
  // no cambia (el padre solo lo actualiza si el usuario hace Save + recarga)

  const updEmail = (key, val) => setEmail(prev => ({ ...prev, [key]: val }))
  const updTg    = (key, val) => setTg(prev    => ({ ...prev, [key]: val }))

  const handleSave = () => onSave({ email, telegram: tg })

  const Field = ({ label, fieldKey, state, updFn, type='text', placeholder='' }) => (
    <label className="block">
      <span className="font-mono text-[10px] text-jet-dim block mb-1">{label.toUpperCase()}</span>
      <input
        type={type}
        value={state[fieldKey] || ''}
        placeholder={placeholder}
        onChange={e => updFn(fieldKey, e.target.value)}
        className="jet-input text-xs"
      />
    </label>
  )

  return (
    <div className="space-y-4">
      {/* Email */}
      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <Mail size={14} className="text-jet-cyan"/>
          <span className="font-mono text-xs font-bold tracking-widest">EMAIL (SMTP)</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[10px] text-jet-dim">Enable</span>
            <input type="checkbox" checked={email.enabled || false}
                   onChange={e => updEmail('enabled', e.target.checked)}
                   className="accent-jet-cyan"/>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SMTP Host"          fieldKey="smtp_host"     state={email} updFn={updEmail} placeholder="smtp.gmail.com"/>
          <Field label="SMTP Port"          fieldKey="smtp_port"     state={email} updFn={updEmail} placeholder="587"/>
          <Field label="Username"           fieldKey="smtp_user"     state={email} updFn={updEmail} placeholder="you@gmail.com"/>
          <Field label="App Password"       fieldKey="smtp_password" state={email} updFn={updEmail} type="password" placeholder="••••••••"/>
          <Field label="From Address"       fieldKey="from_addr"     state={email} updFn={updEmail} placeholder="jetson@gmail.com"/>
          <Field label="To Address"         fieldKey="to_addr"       state={email} updFn={updEmail} placeholder="alerts@example.com"/>
          <label className="block">
            <span className="font-mono text-[10px] text-jet-dim block mb-1">MIN SEVERITY</span>
            <select value={email.min_severity || 'warning'}
                    onChange={e => updEmail('min_severity', e.target.value)}
                    className="jet-input text-xs">
              <option value="info">Info+</option>
              <option value="warning">Warning+</option>
              <option value="critical">Critical only</option>
            </select>
          </label>
          <div className="flex items-end">
            <button onClick={() => onTestEmail({ email, telegram: tg })}
                    className="w-full px-3 py-1.5 font-mono text-xs border border-jet-cyan/40 text-jet-cyan rounded hover:bg-jet-cyan/10 transition-colors">
              Send Test Email
            </button>
          </div>
        </div>
      </div>

      {/* Telegram */}
      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <Send size={14} className="text-jet-cyan"/>
          <span className="font-mono text-xs font-bold tracking-widest">TELEGRAM</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[10px] text-jet-dim">Enable</span>
            <input type="checkbox" checked={tg.enabled || false}
                   onChange={e => updTg('enabled', e.target.checked)}
                   className="accent-jet-cyan"/>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bot Token" fieldKey="bot_token" state={tg} updFn={updTg} type="password" placeholder="123456:ABC-DEF..."/>
          <Field label="Chat ID"   fieldKey="chat_id"   state={tg} updFn={updTg} placeholder="-1001234567890"/>
          <label className="block">
            <span className="font-mono text-[10px] text-jet-dim block mb-1">MIN SEVERITY</span>
            <select value={tg.min_severity || 'warning'}
                    onChange={e => updTg('min_severity', e.target.value)}
                    className="jet-input text-xs">
              <option value="info">Info+</option>
              <option value="warning">Warning+</option>
              <option value="critical">Critical only</option>
            </select>
          </label>
          <div className="flex items-end">
            <button onClick={() => onTestTelegram({ email, telegram: tg })}
                    className="w-full px-3 py-1.5 font-mono text-xs border border-jet-cyan/40 text-jet-cyan rounded hover:bg-jet-cyan/10 transition-colors">
              Send Test Message
            </button>
          </div>
        </div>
      </div>

      {/* Save button */}
      <button onClick={handleSave}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 font-mono text-sm border border-jet-cyan/50 text-jet-cyan rounded-lg hover:bg-jet-cyan/10 transition-colors">
        <Save size={14}/> Save Notification Settings
      </button>

      {testResult && (
        <div className={`font-mono text-xs px-3 py-2 rounded border ${
          testResult.success
            ? 'text-jet-green border-jet-green/30 bg-jet-green/10'
            : 'text-red-400 border-red-400/30 bg-red-400/10'
        }`}>
          {testResult.success ? '✓ Test sent successfully' : `✗ ${testResult.error}`}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AlertsPage() {
  const [tab,     setTab]     = useState('active')
  const [config,  setConfig]  = useState(null)
  const [history, setHistory] = useState([])
  const [active,  setActive]  = useState([])
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [testResult, setTestResult] = useState(null)

  const load = useCallback(async () => {
    try {
      const [cfg, hist, act] = await Promise.all([
        apiFetch('/alerts/config'),
        apiFetch('/alerts/history?limit=100'),
        apiFetch('/alerts/active'),
      ])
      setConfig(cfg)
      setHistory(hist.alerts || [])
      setActive(act.alerts  || [])
    } catch(e) { console.error('Alerts load error:', e) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [load])

  // Guardar reglas + enabled global
  const saveRules = async () => {
    setSaving(true)
    try {
      await apiFetch('/alerts/config', {
        method: 'PUT',
        body: JSON.stringify({ enabled: config.enabled, rules: config.rules }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch(e) { console.error('Save failed:', e) }
    finally { setSaving(false) }
  }

  // Guardar notificaciones (llamado desde NotifConfig)
  const saveNotifications = async (notifData) => {
    setSaving(true)
    try {
      await apiFetch('/alerts/config', {
        method: 'PUT',
        body: JSON.stringify({ notifications: notifData }),
      })
      // Actualizar config local con los nuevos valores
      setConfig(prev => ({ ...prev, notifications: { ...prev.notifications, ...notifData } }))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch(e) { console.error('Save notif failed:', e) }
    finally { setSaving(false) }
  }

  const handleRuleChange = (ruleId, changes) => {
    setConfig(prev => ({
      ...prev,
      rules: { ...prev.rules, [ruleId]: { ...prev.rules[ruleId], ...changes } }
    }))
  }

  const handleAcknowledge = async (id) => {
    await apiFetch(`/alerts/acknowledge/${id}`, { method: 'POST' })
    load()
  }
  const handleAcknowledgeAll = async () => {
    await apiFetch('/alerts/acknowledge-all', { method: 'POST' })
    load()
  }

  const handleTestEmail = async (notifData) => {
    await saveNotifications(notifData)
    const r = await apiFetch('/alerts/test/email', { method: 'POST' })
    setTestResult(r)
    setTimeout(() => setTestResult(null), 6000)
  }
  const handleTestTelegram = async (notifData) => {
    await saveNotifications(notifData)
    const r = await apiFetch('/alerts/test/telegram', { method: 'POST' })
    setTestResult(r)
    setTimeout(() => setTestResult(null), 6000)
  }

  const tabs = [
    { id: 'active',        label: 'Active',        count: active.length  },
    { id: 'history',       label: 'History',       count: history.length },
    { id: 'rules',         label: 'Rules',         icon: Settings        },
    { id: 'notifications', label: 'Notifications', icon: Mail            },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell size={18} style={{ color: '#d29922' }}/>
          <h1 className="font-display text-lg font-bold tracking-widest">ALERTS</h1>
          {active.length > 0 && (
            <span className="px-2 py-0.5 rounded-full font-mono text-[10px] font-bold"
                  style={{ background:'rgba(248,81,73,0.15)', color:'#f85149', border:'1px solid rgba(248,81,73,0.3)' }}>
              {active.length} ACTIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(tab === 'active' || tab === 'history') && active.length > 0 && (
            <button onClick={handleAcknowledgeAll}
                    className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs border border-jet-border rounded hover:border-jet-cyan/40 hover:text-jet-cyan text-jet-dim transition-colors">
              <CheckCheck size={12}/> Ack All
            </button>
          )}
          {tab === 'rules' && (
            <button onClick={saveRules} disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs border border-jet-cyan/40 text-jet-cyan rounded hover:bg-jet-cyan/10 disabled:opacity-40 transition-colors">
              <Save size={12}/>{saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Rules'}
            </button>
          )}
          {config && (
            <div className="flex items-center gap-2 px-3 py-1.5 border rounded" style={{borderColor:"var(--color-border)"}}>
              <span className="font-mono text-[10px] text-jet-dim">ALERTS</span>
              <input type="checkbox" checked={config.enabled || false}
                     onChange={e => setConfig(p => ({ ...p, enabled: e.target.checked }))}
                     className="accent-jet-cyan"/>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b" style={{borderColor:"var(--color-border)"}}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
                  className={`px-4 py-2 font-mono text-xs tracking-wider transition-colors border-b-2 -mb-px ${
                    tab === t.id ? 'border-jet-cyan text-jet-cyan' : 'border-transparent text-jet-dim hover:text-jet-text'
                  }`}>
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-jet-border">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'active'  && <AlertHistory alerts={active}  onAcknowledge={handleAcknowledge}/>}
      {tab === 'history' && <AlertHistory alerts={history} onAcknowledge={handleAcknowledge}/>}

      {tab === 'rules' && config?.rules && (
        <div className="space-y-2">
          <p className="font-mono text-xs text-jet-dim mb-4">
            Configura umbrales, severidad y cooldown. Pulsa "Save Rules" para persistir los cambios.
          </p>
          {Object.entries(config.rules).map(([id, rule]) => (
            <RuleRow key={id} ruleId={id} rule={rule} onChange={handleRuleChange}/>
          ))}
        </div>
      )}

      {tab === 'notifications' && (
        <NotifConfig
          initialConfig={config?.notifications}
          onSave={saveNotifications}
          testResult={testResult}
          onTestEmail={handleTestEmail}
          onTestTelegram={handleTestTelegram}
        />
      )}
    </div>
  )
}
