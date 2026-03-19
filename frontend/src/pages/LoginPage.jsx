/**
 * LoginPage — Two-step login: credentials → TOTP code (if 2FA enabled)
 */
import { useState, useEffect, useRef } from 'react'
import { useAuthStore } from '../store/authStore'
import { Lock, User, Eye, EyeOff, Cpu, ShieldCheck } from 'lucide-react'

export function LoginPage({ onLogin }) {
  const { login, loading, error, clearError, setToken } = useAuthStore()

  // Step 1 — credentials
  const [username, setUsername]   = useState('')
  const [password, setPassword]   = useState('')
  const [showPass, setShowPass]   = useState(false)

  // Step 2 — TOTP
  const [step, setStep]           = useState('credentials') // 'credentials' | 'totp'
  const [totp, setTotp]           = useState('')
  const [totpError, setTotpError] = useState('')
  const [totpLoading, setTotpLoading] = useState(false)

  // Saved creds for step 2
  const savedCreds = useRef({})

  useEffect(() => { clearError() }, [])

  // ── Step 1: username + password ───────────────────────────────────────────
  const handleCredentials = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) return

    const res = await login(username.trim(), password)

    if (res?.requires_totp) {
      // Save creds for step 2 — we'll need them to call /2fa/login
      savedCreds.current = { username: username.trim(), password }
      setStep('totp')
      setTotp('')
      setTotpError('')
    } else if (res?.token) {
      if (onLogin) onLogin()
    }
    // errors handled by authStore → error state
  }

  // ── Step 2: TOTP code ─────────────────────────────────────────────────────
  const handleTotp = async (e) => {
    e.preventDefault()
    if (totp.length !== 6) return
    setTotpLoading(true)
    setTotpError('')
    try {
      const res = await fetch('/api/auth/2fa/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username:  savedCreds.current.username,
          password:  savedCreds.current.password,
          totp_code: totp,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTotpError(data.detail || 'Invalid code')
        setTotp('')
        return
      }
      // Update authStore state so isAuthenticated() returns true
      setToken(data.token, data.username)
      if (onLogin) onLogin()
    } catch {
      setTotpError('Connection error')
    } finally {
      setTotpLoading(false)
    }
  }

  // Auto-submit when 6 digits entered
  const handleTotpChange = (val) => {
    const digits = val.replace(/\D/g, '').slice(0, 6)
    setTotp(digits)
    setTotpError('')
  }

  // ── Shared layout ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-jet-bg flex items-center justify-center p-4"
         style={{ backgroundImage: 'radial-gradient(ellipse at 50% 0%, rgba(88,166,255,0.04) 0%, transparent 70%)' }}>

      <div className="fixed inset-0 opacity-[0.03] pointer-events-none"
           style={{ backgroundImage: 'linear-gradient(#58a6ff 1px, transparent 1px), linear-gradient(90deg, #58a6ff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      <div className="w-full max-w-sm relative">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-jet-card border border-jet-cyan/30 mb-4"
               style={{ boxShadow: '0 0 30px rgba(88,166,255,0.15)' }}>
            {step === 'totp'
              ? <ShieldCheck size={32} className="text-jet-cyan" />
              : <Cpu size={32} className="text-jet-cyan" />
            }
          </div>
          <h1 className="font-display text-2xl font-bold tracking-widest text-jet-text">JETSON</h1>
          <p className="font-mono text-xs text-jet-dim mt-1 tracking-wider">
            {step === 'totp' ? 'TWO-FACTOR AUTHENTICATION' : 'DASHBOARD — SECURE ACCESS'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-jet-card border border-jet-border rounded-xl p-6 space-y-4"
             style={{ boxShadow: '0 0 40px rgba(0,0,0,0.4)' }}>

          {step === 'credentials' ? (
            <>
              <div className="font-mono text-[10px] text-jet-dim tracking-widest uppercase text-center border-b border-jet-border pb-3 mb-2">
                Authentication Required
              </div>

              <form onSubmit={handleCredentials} className="space-y-4">
                {/* Username */}
                <div>
                  <label className="font-mono text-[10px] text-jet-dim tracking-wider uppercase block mb-1.5">
                    Username
                  </label>
                  <div className="relative">
                    <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-jet-muted" />
                    <input
                      type="text"
                      value={username}
                      onChange={e => { setUsername(e.target.value); clearError() }}
                      placeholder="admin"
                      autoComplete="username"
                      autoFocus
                      className="w-full bg-jet-surface border border-jet-border rounded-lg pl-9 pr-4 py-2.5 font-mono text-sm text-jet-text placeholder-jet-muted focus:outline-none focus:border-jet-cyan/60 focus:ring-1 focus:ring-jet-cyan/20 transition-colors"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="font-mono text-[10px] text-jet-dim tracking-wider uppercase block mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-jet-muted" />
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={e => { setPassword(e.target.value); clearError() }}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="w-full bg-jet-surface border border-jet-border rounded-lg pl-9 pr-10 py-2.5 font-mono text-sm text-jet-text placeholder-jet-muted focus:outline-none focus:border-jet-cyan/60 focus:ring-1 focus:ring-jet-cyan/20 transition-colors"
                    />
                    <button type="button" onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-jet-muted hover:text-jet-dim transition-colors">
                      {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="bg-jet-red/10 border border-jet-red/30 rounded-lg px-3 py-2 font-mono text-xs text-jet-red">
                    ⚠ {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !username.trim() || !password}
                  className="w-full bg-jet-cyan/10 border border-jet-cyan/40 text-jet-cyan font-mono text-sm font-bold py-2.5 rounded-lg hover:bg-jet-cyan/20 hover:border-jet-cyan/60 disabled:opacity-40 disabled:cursor-not-allowed transition-all tracking-widest"
                  style={{ boxShadow: loading ? 'none' : '0 0 20px rgba(88,166,255,0.1)' }}
                >
                  {loading ? '[ AUTHENTICATING... ]' : '[ LOGIN ]'}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="font-mono text-[10px] text-jet-dim tracking-widest uppercase text-center border-b border-jet-border pb-3 mb-2">
                Authenticator Code Required
              </div>

              <p className="font-mono text-xs text-jet-dim text-center leading-relaxed">
                Open <span className="text-jet-text">Google Authenticator</span> and enter the 6-digit code for Jetson Dashboard.
              </p>

              <form onSubmit={handleTotp} className="space-y-4">
                <div>
                  <label className="font-mono text-[10px] text-jet-dim tracking-wider uppercase block mb-1.5">
                    6-digit code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={totp}
                    onChange={e => handleTotpChange(e.target.value)}
                    placeholder="000000"
                    autoFocus
                    maxLength={6}
                    className="w-full bg-jet-surface border border-jet-border rounded-lg px-4 py-3 font-mono text-2xl text-center tracking-[0.5em] text-jet-text placeholder-jet-muted focus:outline-none focus:border-jet-cyan/60 focus:ring-1 focus:ring-jet-cyan/20 transition-colors"
                  />
                </div>

                {totpError && (
                  <div className="bg-jet-red/10 border border-jet-red/30 rounded-lg px-3 py-2 font-mono text-xs text-jet-red">
                    ⚠ {totpError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={totpLoading || totp.length !== 6}
                  className="w-full bg-jet-cyan/10 border border-jet-cyan/40 text-jet-cyan font-mono text-sm font-bold py-2.5 rounded-lg hover:bg-jet-cyan/20 hover:border-jet-cyan/60 disabled:opacity-40 disabled:cursor-not-allowed transition-all tracking-widest"
                >
                  {totpLoading ? '[ VERIFYING... ]' : '[ VERIFY ]'}
                </button>

                <button
                  type="button"
                  onClick={() => { setStep('credentials'); setTotp(''); setTotpError(''); clearError() }}
                  className="w-full font-mono text-xs text-jet-muted hover:text-jet-dim transition-colors py-1"
                >
                  ← Back to login
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center font-mono text-[10px] text-jet-muted mt-4">
          Code with ❤️ by: <span className="text-jet-dim">y2k</span>
        </p>
      </div>
    </div>
  )
}
