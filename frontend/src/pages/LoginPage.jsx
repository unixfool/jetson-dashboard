/**
 * Login Page - Pantalla de autenticación
 * Estética industrial consistente con el resto del dashboard
 */
import { useState, useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { Lock, User, Eye, EyeOff, Cpu } from 'lucide-react'

export function LoginPage({ onLogin }) {
  const { login, loading, error, clearError } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)

  useEffect(() => { clearError() }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    const ok = await login(username.trim(), password)
    if (ok && onLogin) onLogin()
  }

  return (
    <div className="min-h-screen bg-jet-bg flex items-center justify-center p-4"
         style={{ backgroundImage: 'radial-gradient(ellipse at 50% 0%, rgba(88,166,255,0.04) 0%, transparent 70%)' }}>

      {/* Grid background */}
      <div className="fixed inset-0 opacity-[0.03] pointer-events-none"
           style={{ backgroundImage: 'linear-gradient(#58a6ff 1px, transparent 1px), linear-gradient(90deg, #58a6ff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      <div className="w-full max-w-sm relative">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-jet-card border border-jet-cyan/30 mb-4"
               style={{ boxShadow: '0 0 30px rgba(88,166,255,0.15)' }}>
            <Cpu size={32} className="text-jet-cyan" />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-widest text-jet-text">
            JETSON
          </h1>
          <p className="font-mono text-xs text-jet-dim mt-1 tracking-wider">
            DASHBOARD — SECURE ACCESS
          </p>
        </div>

        {/* Card */}
        <div className="bg-jet-card border border-jet-border rounded-xl p-6 space-y-4"
             style={{ boxShadow: '0 0 40px rgba(0,0,0,0.4)' }}>

          <div className="font-mono text-[10px] text-jet-dim tracking-widest uppercase text-center border-b border-jet-border pb-3 mb-2">
            Authentication Required
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
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

            {/* Error */}
            {error && (
              <div className="bg-jet-red/10 border border-jet-red/30 rounded-lg px-3 py-2 font-mono text-xs text-jet-red">
                ⚠ {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="w-full bg-jet-cyan/10 border border-jet-cyan/40 text-jet-cyan font-mono text-sm font-bold py-2.5 rounded-lg hover:bg-jet-cyan/20 hover:border-jet-cyan/60 disabled:opacity-40 disabled:cursor-not-allowed transition-all tracking-widest"
              style={{ boxShadow: loading ? 'none' : '0 0 20px rgba(88,166,255,0.1)' }}
            >
              {loading ? '[ AUTHENTICATING... ]' : '[ LOGIN ]'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center font-mono text-[10px] text-jet-muted mt-4">
          Code with ❤️ by: <span className="text-jet-dim">y2k</span>
        </p>
      </div>
    </div>
  )
}
