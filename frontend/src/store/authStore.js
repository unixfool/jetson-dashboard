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

  // Login — returns response object so caller can handle requires_totp
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
        return null
      }
      // If 2FA is required, return the response without storing token
      if (data.requires_totp) {
        set({ loading: false, error: null })
        return data
      }
      // Normal login — store token
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.setItem(USER_KEY, data.username)
      set({ token: data.token, username: data.username, loading: false, error: null })
      return data
    } catch (e) {
      set({ loading: false, error: 'Connection error' })
      return null
    }
  },

  // Set token directly — used after 2FA login completes in LoginPage
  setToken: (token, username) => {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, username)
    set({ token, username, error: null })
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
