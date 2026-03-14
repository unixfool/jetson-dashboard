/**
 * Utility functions for formatting and helpers
 */

export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

export function formatBytesPerSec(bps) {
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`
}

export function formatFreq(mhz) {
  if (!mhz) return 'N/A'
  if (mhz >= 1000) return `${(mhz / 1000).toFixed(2)} GHz`
  return `${mhz} MHz`
}

export function formatUptime(seconds) {
  if (!seconds) return '--'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function formatTemp(celsius) {
  if (celsius === null || celsius === undefined) return '--'
  return `${celsius.toFixed(1)}°C`
}

export function getUsageColor(percent) {
  if (percent >= 90) return '#f85149' // red
  if (percent >= 70) return '#d29922' // yellow
  if (percent >= 50) return '#d18616' // orange
  return '#3fb950' // green
}

export function getUsageColorClass(percent) {
  if (percent >= 90) return 'text-jet-red'
  if (percent >= 70) return 'text-jet-yellow'
  if (percent >= 50) return 'text-jet-orange'
  return 'text-jet-green'
}

export function formatTimestamp(ts) {
  return new Date(ts).toLocaleTimeString()
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

export const API_BASE = '/api'

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('jetson_dashboard_token')
  const headers = {
    'Content-Type': 'application/json',
    ...(token && token !== 'auth-disabled' ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (res.status === 401) {
    // Token expirado o inválido — limpiar sesión y recargar
    localStorage.removeItem('jetson_dashboard_token')
    localStorage.removeItem('jetson_dashboard_user')
    window.location.reload()
    return
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}
