/**
 * Auth Store - Zustand store para autenticación
 * Persiste el token en localStorage
 */
import { create } from 'zustand'

const TOKEN_KEY = 'jetson_dashboard_token'
const USER_KEY  = 'jetson_dashboard_user'

export const useAuthStore = create((set, get) => ({
  token: localStorage.getItem(TOKEN_KEY) || null,
  username: localStorage.getItem(USER_KEY) || null,
  authEnabled: null,   // null = no comprobado aún
  loading: false,
  error: null,

  // Comprobar si auth está habilitada en el servidor
  checkAuthStatus: async () => {
    try {
      const res = await fetch('/api/auth/status')
      const data = await res.json()
      set({ authEnabled: data.auth_enabled })
      return data.auth_enabled
    } catch {
      set({ authEnabled: false })
      return false
    }
  },

  // Login
  login: async (username, password) => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        set({ loading: false, error: data.detail || 'Invalid credentials' })
        return false
      }
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.setItem(USER_KEY, data.username)
      set({ token: data.token, username: data.username, loading: false, error: null })
      return true
    } catch (e) {
      set({ loading: false, error: 'Connection error' })
      return false
    }
  },

  // Logout
  logout: () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    set({ token: null, username: null, error: null })
  },

  // Comprobar si la sesión actual es válida
  isAuthenticated: () => {
    const { token, authEnabled } = get()
    if (!authEnabled) return true   // auth desactivada = siempre autenticado
    return !!token
  },

  clearError: () => set({ error: null }),
}))
