import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../utils/format'

// ─── Constants ───────────────────────────────────────────────────────────────
const SEND_INTERVAL_MS = 80
const STOP_DELAY_MS    = 150

// ─── Tabs ────────────────────────────────────────────────────────────────────
const TABS = ['Control', 'Patterns', 'Sequence', 'Precision']

// ─── Patterns ────────────────────────────────────────────────────────────────
const PATTERNS = [
  {
    id: 'square',
    name: 'Square',
    icon: '⬜',
    desc: 'Forward → Right → Back → Left',
    steps: [
      { left: 0.6, right: 0.6, ms: 1500 },
      { left: 0.5, right: -0.5, ms: 700 },
      { left: 0.6, right: 0.6, ms: 1500 },
      { left: 0.5, right: -0.5, ms: 700 },
      { left: 0.6, right: 0.6, ms: 1500 },
      { left: 0.5, right: -0.5, ms: 700 },
      { left: 0.6, right: 0.6, ms: 1500 },
      { left: 0.5, right: -0.5, ms: 700 },
    ],
  },
  {
    id: 'zigzag',
    name: 'Zigzag',
    icon: '〰️',
    desc: 'Alternating left/right curves',
    steps: [
      { left: 0.7, right: 0.3, ms: 600 },
      { left: 0.3, right: 0.7, ms: 600 },
      { left: 0.7, right: 0.3, ms: 600 },
      { left: 0.3, right: 0.7, ms: 600 },
      { left: 0.7, right: 0.3, ms: 600 },
      { left: 0.3, right: 0.7, ms: 600 },
    ],
  },
  {
    id: 'spin',
    name: 'Spin 360°',
    icon: '🔄',
    desc: 'Full rotation in place',
    steps: [
      { left: 0.5, right: -0.5, ms: 1400 },
    ],
  },
  {
    id: 'figure8',
    name: 'Figure 8',
    icon: '∞',
    desc: 'Left loop then right loop',
    steps: [
      { left: 0.3, right: 0.7, ms: 2800 },
      { left: 0.7, right: 0.3, ms: 2800 },
    ],
  },
  {
    id: 'circle_l',
    name: 'Circle L',
    icon: '↺',
    desc: 'Continuous left circle',
    steps: [
      { left: 0.3, right: 0.6, ms: 4000 },
    ],
  },
  {
    id: 'circle_r',
    name: 'Circle R',
    icon: '↻',
    desc: 'Continuous right circle',
    steps: [
      { left: 0.6, right: 0.3, ms: 4000 },
    ],
  },
  {
    id: 'triangle',
    name: 'Triangle',
    icon: '△',
    desc: '3 sides with 120° turns',
    steps: [
      { left: 0.6, right: 0.6, ms: 1200 },
      { left: 0.5, right: -0.5, ms: 550 },
      { left: 0.6, right: 0.6, ms: 1200 },
      { left: 0.5, right: -0.5, ms: 550 },
      { left: 0.6, right: 0.6, ms: 1200 },
      { left: 0.5, right: -0.5, ms: 550 },
    ],
  },
  {
    id: 'bounce',
    name: 'Bounce',
    icon: '↕',
    desc: 'Forward and back x3',
    steps: [
      { left: 0.6, right: 0.6, ms: 800 },
      { left: -0.6, right: -0.6, ms: 800 },
      { left: 0.6, right: 0.6, ms: 800 },
      { left: -0.6, right: -0.6, ms: 800 },
      { left: 0.6, right: 0.6, ms: 800 },
      { left: -0.6, right: -0.6, ms: 800 },
    ],
  },
]

// ─── Sequence step actions ────────────────────────────────────────────────────
const SEQ_ACTIONS = [
  { id: 'forward',   label: 'Forward',    left: 1,    right: 1    },
  { id: 'backward',  label: 'Backward',   left: -1,   right: -1   },
  { id: 'spin_left', label: 'Spin Left',  left: -1,   right: 1    },
  { id: 'spin_right',label: 'Spin Right', left: 1,    right: -1   },
  { id: 'curve_l',   label: 'Curve Left', left: 0.4,  right: 0.8  },
  { id: 'curve_r',   label: 'Curve Right',left: 0.8,  right: 0.4  },
  { id: 'stop',      label: 'Stop/Pause', left: 0,    right: 0    },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function MotorBar({ label, value }) {
  const pct = Math.abs(value) * 100
  const fwd  = value > 0
  const zero = value === 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-mono text-jet-dim tracking-widest">{label}</span>
        <span className={`text-[10px] font-mono font-bold tabular-nums
          ${zero ? 'text-jet-dim' : fwd ? 'text-green-400' : 'text-orange-400'}`}>
          {zero ? 'IDLE' : `${fwd ? 'FWD' : 'REV'} ${Math.round(pct)}%`}
        </span>
      </div>
      <div className="relative h-1.5 bg-jet-border/40 rounded-full overflow-hidden">
        <div
          className={`absolute top-0 h-full rounded-full transition-all duration-75
            ${fwd ? 'left-0 bg-green-500' : 'right-0 bg-orange-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ─── Joystick ─────────────────────────────────────────────────────────────────
function Joystick({ onMove, onRelease, disabled }) {
  const padRef  = useRef(null)
  const knobRef = useRef(null)
  const active  = useRef(false)
  const joyRef  = useRef({ x: 0, y: 0 })

  const getCenter = () => {
    const r = padRef.current.getBoundingClientRect()
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: r.width / 2 - 22 }
  }

  const move = useCallback((cx, cy) => {
    if (!active.current || disabled) return
    const { cx: ox, cy: oy, radius } = getCenter()
    let dx = cx - ox, dy = cy - oy
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > radius) { dx = dx / dist * radius; dy = dy / dist * radius }
    joyRef.current = { x: dx, y: dy }
    if (knobRef.current)
      knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
    const nx = dx / radius
    const ny = -dy / radius
    onMove({
      left:  clamp(ny + nx, -1, 1),
      right: clamp(ny - nx, -1, 1),
    })
  }, [disabled, onMove])

  const release = useCallback(() => {
    active.current = false
    joyRef.current = { x: 0, y: 0 }
    if (knobRef.current) knobRef.current.style.transform = 'translate(-50%,-50%)'
    onRelease()
  }, [onRelease])

  useEffect(() => {
    const mm = e => move(e.clientX, e.clientY)
    const tm = e => { e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY) }
    window.addEventListener('mousemove', mm)
    window.addEventListener('mouseup', release)
    window.addEventListener('touchmove', tm, { passive: false })
    window.addEventListener('touchend', release)
    return () => {
      window.removeEventListener('mousemove', mm)
      window.removeEventListener('mouseup', release)
      window.removeEventListener('touchmove', tm)
      window.removeEventListener('touchend', release)
    }
  }, [move, release])

  return (
    <div
      ref={padRef}
      onMouseDown={e => { if (!disabled) { e.preventDefault(); active.current = true } }}
      onTouchStart={e => { if (!disabled) { e.preventDefault(); active.current = true } }}
      className={`relative w-44 h-44 rounded-full select-none touch-none border-2
        ${disabled
          ? 'border-jet-border bg-jet-surface opacity-40 cursor-not-allowed'
          : 'border-green-500/30 bg-jet-surface cursor-grab active:cursor-grabbing'}`}
      style={{ boxShadow: disabled ? 'none' : '0 0 40px rgba(34,197,94,0.05) inset' }}
    >
      {/* Crosshairs */}
      <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-4 right-4 h-px bg-jet-border/30" />
        <div className="absolute left-1/2 top-4 bottom-4 w-px bg-jet-border/30" />
        <div className="absolute inset-3 rounded-full border border-jet-border/20" />
      </div>
      {!disabled && <>
        <span className="absolute top-1.5 left-1/2 -translate-x-1/2 text-jet-dim text-[10px] font-mono">↑</span>
        <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-jet-dim text-[10px] font-mono">↓</span>
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-jet-dim text-[10px] font-mono">←</span>
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-jet-dim text-[10px] font-mono">→</span>
      </>}
      <div
        ref={knobRef}
        className={`absolute top-1/2 left-1/2 w-12 h-12 rounded-full pointer-events-none
          ${disabled ? 'bg-jet-border' : 'bg-green-500/15 border-2 border-green-500/50'}`}
        style={{ transform: 'translate(-50%,-50%)', transition: 'transform 75ms' }}
      />
    </div>
  )
}

// ─── DPad ─────────────────────────────────────────────────────────────────────
function DPad({ activeKeys, onPress, onRelease, disabled }) {
  const btn = (key, icon) => (
    <button
      onMouseDown={() => !disabled && onPress(key)}
      onMouseUp={() => !disabled && onRelease(key)}
      onMouseLeave={() => !disabled && onRelease(key)}
      onTouchStart={e => { e.preventDefault(); !disabled && onPress(key) }}
      onTouchEnd={e => { e.preventDefault(); !disabled && onRelease(key) }}
      disabled={disabled}
      className={`w-11 h-11 rounded-lg text-base font-mono font-bold select-none
        transition-all duration-75 border
        ${disabled ? 'border-jet-border text-jet-dim bg-jet-surface opacity-40 cursor-not-allowed'
          : activeKeys.has(key)
            ? 'border-green-500 text-green-300 bg-green-500/20 scale-95 shadow-[0_0_10px_rgba(34,197,94,0.25)]'
            : 'border-jet-border text-jet-text bg-jet-surface hover:border-green-500/40 hover:text-green-400'}`}
    >{icon}</button>
  )
  return (
    <div className="flex flex-col items-center gap-1">
      <div>{btn('w', '↑')}</div>
      <div className="flex gap-1">{btn('a', '←')}{btn('s', '↓')}{btn('d', '→')}</div>
      <p className="text-[10px] text-jet-dim font-mono mt-1">WASD / Arrow keys</p>
    </div>
  )
}

// ─── Control Tab ──────────────────────────────────────────────────────────────
function ControlTab({ available, motorState, sendMotors, sendStop, speed, setSpeed }) {
  const [activeKeys, setActiveKeys] = useState(new Set())
  const sendRef  = useRef(null)
  const stopRef  = useRef(null)
  const modeRef  = useRef('dpad')
  const joyRef   = useRef({ left: 0, right: 0 })

  const dirFromKeys = useCallback(keys => {
    const w = keys.has('w') || keys.has('arrowup')
    const s = keys.has('s') || keys.has('arrowdown')
    const a = keys.has('a') || keys.has('arrowleft')
    const d = keys.has('d') || keys.has('arrowright')
    if (w && a) return { left: speed * 0.3, right: speed }
    if (w && d) return { left: speed, right: speed * 0.3 }
    if (s && a) return { left: -speed * 0.3, right: -speed }
    if (s && d) return { left: -speed, right: -speed * 0.3 }
    if (w) return { left: speed, right: speed }
    if (s) return { left: -speed, right: -speed }
    if (a) return { left: -speed, right: speed }
    if (d) return { left: speed, right: -speed }
    return null
  }, [speed])

  useEffect(() => {
    if (modeRef.current !== 'dpad') return
    clearInterval(sendRef.current)
    if (activeKeys.size === 0) return
    const m = dirFromKeys(activeKeys)
    if (!m) { sendStop(); return }
    const send = () => sendMotors(m.left, m.right)
    send()
    sendRef.current = setInterval(send, SEND_INTERVAL_MS)
    return () => clearInterval(sendRef.current)
  }, [activeKeys, dirFromKeys, sendMotors, sendStop])

  const pressKey = useCallback(key => {
    modeRef.current = 'dpad'
    setActiveKeys(p => new Set([...p, key.toLowerCase()]))
    clearTimeout(stopRef.current)
  }, [])

  const releaseKey = useCallback(key => {
    setActiveKeys(p => { const n = new Set(p); n.delete(key.toLowerCase()); return n })
    stopRef.current = setTimeout(() => {
      setActiveKeys(p => { if (p.size === 0) sendStop(); return p })
    }, STOP_DELAY_MS)
  }, [sendStop])

  useEffect(() => {
    const dn = e => {
      const k = e.key.toLowerCase()
      if ([' '].includes(k)) { e.preventDefault(); sendStop(); return }
      if (!['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) return
      e.preventDefault(); pressKey(k)
    }
    const up = e => {
      const k = e.key.toLowerCase()
      const map = { arrowup:'w', arrowdown:'s', arrowleft:'a', arrowright:'d' }
      releaseKey(map[k] || k)
    }
    window.addEventListener('keydown', dn)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
  }, [pressKey, releaseKey, sendStop])

  const handleJoyMove = useCallback(({ left, right }) => {
    modeRef.current = 'joystick'
    joyRef.current = { left, right }
    clearInterval(sendRef.current)
    sendRef.current = setInterval(() => {
      sendMotors(joyRef.current.left, joyRef.current.right)
    }, SEND_INTERVAL_MS)
  }, [sendMotors])

  const handleJoyRelease = useCallback(() => {
    clearInterval(sendRef.current)
    stopRef.current = setTimeout(sendStop, STOP_DELAY_MS)
  }, [sendStop])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Joystick */}
      <div className="rounded-xl border border-jet-border bg-jet-surface p-5 flex flex-col items-center gap-4">
        <span className="text-[10px] font-mono text-jet-dim uppercase tracking-widest self-start">Virtual Joystick</span>
        <Joystick onMove={handleJoyMove} onRelease={handleJoyRelease} disabled={!available} />
        <p className="text-[10px] text-jet-dim font-mono">Drag to steer — touch friendly</p>
      </div>

      {/* WASD + speed + stop */}
      <div className="rounded-xl border border-jet-border bg-jet-surface p-5 flex flex-col gap-5">
        <div className="flex flex-col items-center gap-2">
          <span className="text-[10px] font-mono text-jet-dim uppercase tracking-widest self-start">Keyboard / D-Pad</span>
          <DPad activeKeys={activeKeys} onPress={pressKey} onRelease={releaseKey} disabled={!available} />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-[10px] font-mono text-jet-dim uppercase tracking-widest">Speed</span>
            <span className="text-[10px] font-mono text-green-400 font-bold">{Math.round(speed * 100)}%</span>
          </div>
          <input type="range" min="10" max="100" value={Math.round(speed * 100)}
            onChange={e => setSpeed(parseInt(e.target.value) / 100)}
            disabled={!available} className="w-full accent-green-500 disabled:opacity-40" />
          <div className="flex justify-between text-[10px] text-jet-dim font-mono">
            <span>10%</span><span>55%</span><span>100%</span>
          </div>
        </div>

        <button onClick={sendStop} disabled={!available}
          className={`w-full py-2.5 rounded-xl font-mono font-bold text-xs tracking-widest border-2 transition-all
            ${!available ? 'border-jet-border text-jet-dim opacity-40 cursor-not-allowed'
              : 'border-red-500/50 text-red-400 hover:bg-red-500/10 hover:border-red-500 active:scale-95'}`}>
          ■ EMERGENCY STOP &nbsp;<span className="opacity-50 font-normal">[SPACE]</span>
        </button>
      </div>

      {/* Motor bars */}
      <div className="lg:col-span-2 rounded-xl border border-jet-border bg-jet-surface p-4 space-y-3">
        <span className="text-[10px] font-mono text-jet-dim uppercase tracking-widest">Live Motor Output</span>
        <div className="grid grid-cols-2 gap-6">
          <MotorBar label="LEFT WHEEL"  value={motorState.left}  />
          <MotorBar label="RIGHT WHEEL" value={motorState.right} />
        </div>
      </div>
    </div>
  )
}

// ─── Patterns Tab ─────────────────────────────────────────────────────────────
function PatternsTab({ available, sendMotors, sendStop, setMotorState }) {
  const [running,  setRunning]  = useState(null)   // pattern id
  const [progress, setProgress] = useState(0)       // 0-100
  const [stepIdx,  setStepIdx]  = useState(0)
  const abortRef = useRef(false)

  const runPattern = useCallback(async (pattern) => {
    if (!available) return
    abortRef.current = false
    setRunning(pattern.id)
    setProgress(0)
    setStepIdx(0)

    const totalMs = pattern.steps.reduce((a, s) => a + s.ms, 0)
    let elapsed = 0

    for (let i = 0; i < pattern.steps.length; i++) {
      if (abortRef.current) break
      const step = pattern.steps[i]
      setStepIdx(i)
      await sendMotors(step.left, step.right)

      const start = Date.now()
      await new Promise(resolve => {
        const tick = setInterval(() => {
          if (abortRef.current) { clearInterval(tick); resolve(); return }
          const spent = Date.now() - start
          setProgress(Math.min(100, Math.round((elapsed + spent) / totalMs * 100)))
          if (spent >= step.ms) { clearInterval(tick); resolve() }
        }, 50)
      })
      elapsed += step.ms
    }

    sendStop()
    setMotorState({ left: 0, right: 0 })
    setRunning(null)
    setProgress(0)
    setStepIdx(0)
  }, [available, sendMotors, sendStop, setMotorState])

  const stopPattern = () => {
    abortRef.current = true
    sendStop()
    setMotorState({ left: 0, right: 0 })
    setRunning(null)
    setProgress(0)
  }

  return (
    <div className="space-y-4">
      {/* Running status */}
      {running && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-mono text-green-400">
                Running: {PATTERNS.find(p => p.id === running)?.name}
                &nbsp;— step {stepIdx + 1}/{PATTERNS.find(p => p.id === running)?.steps.length}
              </span>
            </div>
            <button onClick={stopPattern}
              className="text-xs font-mono text-red-400 border border-red-500/40 px-3 py-1 rounded-lg hover:bg-red-500/10 transition-colors">
              ■ STOP
            </button>
          </div>
          <div className="h-1.5 bg-jet-border/40 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all duration-100"
              style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Pattern grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {PATTERNS.map(p => {
          const isThis = running === p.id
          const busy   = running && !isThis
          return (
            <button key={p.id}
              onClick={() => isThis ? stopPattern() : runPattern(p)}
              disabled={!available || busy}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all text-left
                ${!available || busy ? 'border-jet-border opacity-40 cursor-not-allowed bg-jet-surface'
                  : isThis ? 'border-green-500 bg-green-500/10 shadow-[0_0_20px_rgba(34,197,94,0.1)]'
                    : 'border-jet-border bg-jet-surface hover:border-green-500/40 hover:bg-green-500/5 cursor-pointer'}`}>
              <span className="text-2xl">{p.icon}</span>
              <span className={`text-xs font-mono font-bold ${isThis ? 'text-green-400' : 'text-jet-text'}`}>
                {p.name}
              </span>
              <span className="text-[10px] text-jet-dim font-mono text-center leading-tight">{p.desc}</span>
              {isThis && (
                <span className="text-[10px] font-mono text-red-400 border border-red-500/40 px-2 py-0.5 rounded">
                  ■ stop
                </span>
              )}
            </button>
          )
        })}
      </div>

      <p className="text-[10px] text-jet-dim font-mono">
        Patterns run automatically — click the card while running to stop early.
        Timing may vary based on surface and battery level.
      </p>
    </div>
  )
}

// ─── Sequence Tab ─────────────────────────────────────────────────────────────
function SequenceTab({ available, sendMotors, sendStop, setMotorState }) {
  const [steps,    setSteps]    = useState([
    { action: 'forward',   speed: 0.6, duration: 1.5 },
    { action: 'spin_left', speed: 0.5, duration: 0.8 },
    { action: 'forward',   speed: 0.6, duration: 1.5 },
  ])
  const [running,  setRunning]  = useState(false)
  const [curStep,  setCurStep]  = useState(-1)
  const [progress, setProgress] = useState(0)
  const abortRef = useRef(false)

  const addStep = () => setSteps(p => [...p, { action: 'forward', speed: 0.6, duration: 1.0 }])
  const removeStep = i => setSteps(p => p.filter((_, idx) => idx !== i))
  const updateStep = (i, key, val) => setSteps(p => p.map((s, idx) => idx === i ? { ...s, [key]: val } : s))
  const moveStep = (i, dir) => {
    setSteps(p => {
      const a = [...p]
      const j = i + dir
      if (j < 0 || j >= a.length) return a
      ;[a[i], a[j]] = [a[j], a[i]]
      return a
    })
  }

  const runSequence = useCallback(async () => {
    if (!available || steps.length === 0) return
    abortRef.current = false
    setRunning(true)
    setCurStep(0)
    setProgress(0)

    for (let i = 0; i < steps.length; i++) {
      if (abortRef.current) break
      const s = steps[i]
      const action = SEQ_ACTIONS.find(a => a.id === s.action)
      setCurStep(i)
      const l = action.left  * s.speed
      const r = action.right * s.speed
      await sendMotors(l, r)

      const ms = s.duration * 1000
      const start = Date.now()
      await new Promise(resolve => {
        const tick = setInterval(() => {
          if (abortRef.current) { clearInterval(tick); resolve(); return }
          const pct = Math.min(100, (Date.now() - start) / ms * 100)
          setProgress(pct)
          if (Date.now() - start >= ms) { clearInterval(tick); resolve() }
        }, 50)
      })
    }

    sendStop()
    setMotorState({ left: 0, right: 0 })
    setRunning(false)
    setCurStep(-1)
    setProgress(0)
  }, [available, steps, sendMotors, sendStop, setMotorState])

  const stopSeq = () => {
    abortRef.current = true
    sendStop()
    setMotorState({ left: 0, right: 0 })
    setRunning(false)
    setCurStep(-1)
    setProgress(0)
  }

  const totalDuration = steps.reduce((a, s) => a + s.duration, 0)

  return (
    <div className="space-y-4">
      {/* Steps list */}
      <div className="rounded-xl border border-jet-border bg-jet-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-jet-border">
          <span className="text-[10px] font-mono text-jet-dim uppercase tracking-widest">
            Sequence — {steps.length} steps · {totalDuration.toFixed(1)}s total
          </span>
          <button onClick={addStep} disabled={running}
            className="text-[10px] font-mono text-green-400 border border-green-500/40 px-2.5 py-1 rounded-lg
              hover:bg-green-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            + Add Step
          </button>
        </div>

        {steps.length === 0 ? (
          <div className="p-8 text-center text-jet-dim text-xs font-mono">
            No steps yet — click "+ Add Step" to begin
          </div>
        ) : (
          <div className="divide-y divide-jet-border/50">
            {steps.map((step, i) => {
              const isCurrent = curStep === i && running
              return (
                <div key={i} className={`flex items-center gap-3 px-4 py-3 transition-colors
                  ${isCurrent ? 'bg-green-500/8' : 'hover:bg-jet-border/10'}`}>

                  {/* Step number */}
                  <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-mono font-bold flex-shrink-0
                    ${isCurrent ? 'bg-green-500 text-black' : 'bg-jet-border/40 text-jet-dim'}`}>
                    {i + 1}
                  </div>

                  {/* Action select */}
                  <select value={step.action}
                    onChange={e => updateStep(i, 'action', e.target.value)}
                    disabled={running}
                    className="bg-jet-bg border border-jet-border rounded-lg text-xs font-mono text-jet-text
                      px-2 py-1 flex-1 min-w-0 disabled:opacity-50">
                    {SEQ_ACTIONS.map(a => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </select>

                  {/* Speed */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[10px] font-mono text-jet-dim">Spd</span>
                    <input type="number" min="0.1" max="1.0" step="0.1"
                      value={step.speed} onChange={e => updateStep(i, 'speed', parseFloat(e.target.value))}
                      disabled={running || step.action === 'stop'}
                      className="w-14 bg-jet-bg border border-jet-border rounded text-xs font-mono text-jet-text
                        px-1.5 py-1 text-center disabled:opacity-40" />
                  </div>

                  {/* Duration */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[10px] font-mono text-jet-dim">Sec</span>
                    <input type="number" min="0.1" max="30" step="0.1"
                      value={step.duration} onChange={e => updateStep(i, 'duration', parseFloat(e.target.value))}
                      disabled={running}
                      className="w-14 bg-jet-bg border border-jet-border rounded text-xs font-mono text-jet-text
                        px-1.5 py-1 text-center disabled:opacity-40" />
                  </div>

                  {/* Progress bar for current step */}
                  {isCurrent && (
                    <div className="w-16 h-1.5 bg-jet-border/40 rounded-full overflow-hidden flex-shrink-0">
                      <div className="h-full bg-green-500 rounded-full transition-all duration-100"
                        style={{ width: `${progress}%` }} />
                    </div>
                  )}

                  {/* Move / delete */}
                  {!running && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => moveStep(i, -1)} disabled={i === 0}
                        className="text-jet-dim hover:text-jet-text disabled:opacity-20 text-xs font-mono px-1">↑</button>
                      <button onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}
                        className="text-jet-dim hover:text-jet-text disabled:opacity-20 text-xs font-mono px-1">↓</button>
                      <button onClick={() => removeStep(i)}
                        className="text-jet-dim hover:text-red-400 text-xs font-mono px-1 ml-1">✕</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Run / Stop */}
      <div className="flex gap-3">
        {!running ? (
          <button onClick={runSequence} disabled={!available || steps.length === 0}
            className={`flex-1 py-3 rounded-xl font-mono font-bold text-sm tracking-widest border-2 transition-all
              ${!available || steps.length === 0
                ? 'border-jet-border text-jet-dim opacity-40 cursor-not-allowed'
                : 'border-green-500/50 text-green-400 hover:bg-green-500/10 hover:border-green-500 active:scale-95'}`}>
            ▶ RUN SEQUENCE
          </button>
        ) : (
          <button onClick={stopSeq}
            className="flex-1 py-3 rounded-xl font-mono font-bold text-sm tracking-widest border-2
              border-red-500/50 text-red-400 hover:bg-red-500/10 hover:border-red-500 transition-all active:scale-95">
            ■ STOP
          </button>
        )}
        <button onClick={() => setSteps([])} disabled={running}
          className="px-4 py-3 rounded-xl font-mono text-xs border border-jet-border text-jet-dim
            hover:text-jet-text hover:border-jet-border/80 transition-colors disabled:opacity-40">
          Clear
        </button>
      </div>
    </div>
  )
}

// ─── Precision Tab ────────────────────────────────────────────────────────────
function PrecisionTab({ available, motorState, sendMotors, sendStop }) {
  const [leftVal,  setLeftVal]  = useState(0)
  const [rightVal, setRightVal] = useState(0)
  const [linked,   setLinked]   = useState(false)

  const apply = useCallback((l, r) => {
    if (!available) return
    if (l === 0 && r === 0) sendStop()
    else sendMotors(l, r)
  }, [available, sendMotors, sendStop])

  const setLeft = v => {
    const val = clamp(Math.round(v * 10) / 10, -1, 1)
    setLeftVal(val)
    if (linked) { setRightVal(val); apply(val, val) }
    else apply(val, rightVal)
  }

  const setRight = v => {
    const val = clamp(Math.round(v * 10) / 10, -1, 1)
    setRightVal(val)
    if (linked) { setLeftVal(val); apply(val, val) }
    else apply(leftVal, val)
  }

  const reset = () => { setLeftVal(0); setRightVal(0); sendStop() }

  const MotorSlider = ({ label, value, onChange, color }) => (
    <div className="flex flex-col items-center gap-3">
      <span className="text-[10px] font-mono text-jet-dim uppercase tracking-widest">{label}</span>

      {/* Value display */}
      <div className={`text-2xl font-mono font-bold tabular-nums
        ${value > 0 ? 'text-green-400' : value < 0 ? 'text-orange-400' : 'text-jet-dim'}`}>
        {value > 0 ? '+' : ''}{value.toFixed(1)}
      </div>

      {/* Vertical slider */}
      <div className="relative h-48 flex items-center justify-center">
        <div className="absolute inset-y-0 w-0.5 bg-jet-border/40 left-1/2 -translate-x-1/2" />
        <div className="absolute top-1/2 h-0.5 w-6 bg-jet-dim/40 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        <input type="range" min="-100" max="100" value={Math.round(value * 100)}
          onChange={e => onChange(parseInt(e.target.value) / 100)}
          disabled={!available}
          className="h-48 cursor-pointer disabled:opacity-40"
          style={{
            writingMode: 'vertical-lr',
            direction: 'rtl',
            appearance: 'slider-vertical',
            WebkitAppearance: 'slider-vertical',
            accentColor: color,
          }} />
      </div>

      {/* Direction label */}
      <span className={`text-[10px] font-mono
        ${value > 0.05 ? 'text-green-400' : value < -0.05 ? 'text-orange-400' : 'text-jet-dim'}`}>
        {value > 0.05 ? 'FORWARD' : value < -0.05 ? 'REVERSE' : 'STOPPED'}
      </span>

      {/* Fine adjust buttons */}
      <div className="flex gap-1">
        {[-0.1, -0.1, 0.1, 0.1].map((d, i) => (
          <button key={i} onClick={() => onChange(clamp(value + (i < 2 ? -0.1 : 0.1), -1, 1))}
            disabled={!available}
            className="w-7 h-7 rounded border border-jet-border text-jet-dim text-xs font-mono
              hover:border-jet-text hover:text-jet-text transition-colors disabled:opacity-40">
            {i < 2 ? (i === 0 ? '−−' : '−') : (i === 2 ? '+' : '++')}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-jet-border bg-jet-surface p-6">
        <div className="flex items-center justify-between mb-6">
          <span className="text-[10px] font-mono text-jet-dim uppercase tracking-widest">Independent Motor Control</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-[10px] font-mono text-jet-dim">Link motors</span>
            <button onClick={() => setLinked(p => !p)}
              className={`w-8 h-4 rounded-full transition-colors relative
                ${linked ? 'bg-green-500' : 'bg-jet-border'}`}>
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform
                ${linked ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </label>
        </div>

        <div className="flex items-start justify-around gap-8">
          <MotorSlider label="Left Wheel"  value={leftVal}  onChange={setLeft}  color="#22c55e" />

          {/* Center indicator */}
          <div className="flex flex-col items-center gap-2 pt-12">
            <div className="text-jet-dim text-[10px] font-mono text-center space-y-1">
              <div>L: <span className="text-jet-text">{leftVal > 0 ? '+' : ''}{leftVal.toFixed(1)}</span></div>
              <div>R: <span className="text-jet-text">{rightVal > 0 ? '+' : ''}{rightVal.toFixed(1)}</span></div>
            </div>
            {linked && <span className="text-[10px] font-mono text-green-400">LINKED</span>}
          </div>

          <MotorSlider label="Right Wheel" value={rightVal} onChange={setRight} color="#22c55e" />
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={reset} disabled={!available}
            className="flex-1 py-2.5 rounded-xl font-mono font-bold text-xs tracking-widest border-2
              border-red-500/50 text-red-400 hover:bg-red-500/10 hover:border-red-500 transition-all
              disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
            ■ STOP ALL
          </button>
          <button onClick={() => { setLeftVal(0.5); setRightVal(0.5); apply(0.5, 0.5) }}
            disabled={!available}
            className="px-4 py-2.5 rounded-xl font-mono text-xs border border-jet-border text-jet-dim
              hover:text-jet-text hover:border-jet-border/80 transition-colors disabled:opacity-40">
            50% fwd
          </button>
        </div>
      </div>

      {/* Live bars */}
      <div className="rounded-xl border border-jet-border bg-jet-surface p-4 space-y-3">
        <span className="text-[10px] font-mono text-jet-dim uppercase tracking-widest">Live Output</span>
        <div className="grid grid-cols-2 gap-6">
          <MotorBar label="LEFT WHEEL"  value={motorState.left}  />
          <MotorBar label="RIGHT WHEEL" value={motorState.right} />
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MotorPage() {
  const [status,     setStatus]     = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [tab,        setTab]        = useState('Control')
  const [motorState, setMotorState] = useState({ left: 0, right: 0 })
  const [speed,      setSpeed]      = useState(0.65)

  // Fetch status
  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await apiFetch('/motor/status')
        setStatus(data)
      } catch {
        setStatus({ available: false, error: 'Backend unreachable' })
      } finally {
        setLoading(false)
      }
    }
    fetch()
    const iv = setInterval(fetch, 6000)
    return () => clearInterval(iv)
  }, [])

  // Stop motors on unmount
  useEffect(() => {
    return () => { apiFetch('/motor/stop', { method: 'POST' }).catch(() => {}) }
  }, [])

  const sendMotors = useCallback(async (left, right) => {
    if (!status?.available) return
    try {
      await apiFetch('/motor/set', {
        method: 'POST',
        body: JSON.stringify({ left, right }),
      })
      setMotorState({ left, right })
    } catch (e) {
      console.error('Motor error:', e)
    }
  }, [status])

  const sendStop = useCallback(async () => {
    try {
      await apiFetch('/motor/stop', { method: 'POST' })
      setMotorState({ left: 0, right: 0 })
    } catch (e) {
      console.error('Stop error:', e)
    }
  }, [])

  const available = status?.available ?? false

  const tabProps = { available, motorState, setMotorState, sendMotors, sendStop, speed, setSpeed }

  return (
    <div className="p-6 space-y-5 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-jet-text tracking-tight">Motor Control</h1>
          <p className="text-xs text-jet-dim mt-0.5 font-mono">WaveShare JetBot · PCA9685 + TB6612FNG · motor1=L · motor2=R</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${available ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          <span className={`text-[10px] font-mono ${available ? 'text-green-400' : 'text-red-400'}`}>
            {loading ? 'DETECTING…' : available ? `READY · ${status?.i2c_address}` : 'UNAVAILABLE'}
          </span>
        </div>
      </div>

      {/* Unavailable banner */}
      {!loading && !available && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm font-mono text-red-400">⚠ Motor HAT not detected</p>
          <p className="text-xs text-jet-dim mt-1">{status?.error || 'PCA9685 not found at I2C 0x60'}</p>
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
      {tab === 'Control'   && <ControlTab   {...tabProps} />}
      {tab === 'Patterns'  && <PatternsTab  {...tabProps} />}
      {tab === 'Sequence'  && <SequenceTab  {...tabProps} />}
      {tab === 'Precision' && <PrecisionTab {...tabProps} />}

      {/* Footer */}
      <div className="text-[10px] font-mono text-jet-dim border-t border-jet-border/40 pt-3 space-y-0.5">
        <p>Hardware: PCA9685 PWM @ 0x60 · TB6612FNG dual H-bridge · 2× DC motors · adafruit-motorkit</p>
        <p>Controls: Joystick drag · WASD/Arrows · Space = emergency stop</p>
      </div>
    </div>
  )
}
