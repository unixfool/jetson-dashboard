import { create } from 'zustand'
import { apiFetch } from '../utils/format'

const BASE_WS = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:${import.meta.env.VITE_API_PORT || window.location.port || 8080}/ws/metrics`

function getToken() {
  return localStorage.getItem('jetson_dashboard_token')
}

function getWsUrl() {
  const token = getToken()
  return token && token !== 'auth-disabled' ? `${BASE_WS}?token=${token}` : BASE_WS
}

const HISTORY_SIZE = 60

function appendHistory(history, value) {
  const next = [...history, value]
  return next.length > HISTORY_SIZE ? next.slice(-HISTORY_SIZE) : next
}

// Sensores que no varían con la carga — excluir del historial de temperatura
const STATIC_SENSORS = ['PMIC', 'pmic', 'iwlwifi', 'iwlwifi_1', 'thermal-fan-est']

// Extraer temperatura de CPU para el historial (varía con la carga)
function extractCpuTempForHistory(sys, gpu) {
  const sensors = sys?.thermals?.sensors || {}

  // Preferir CPU directamente
  if (sensors.CPU?.temp_c != null) return sensors.CPU.temp_c
  if (sensors.cpu?.temp_c != null) return sensors.cpu.temp_c

  // Fallback: tegrastats CPU
  const tgTemps = gpu?.tegrastats_raw?.temperatures || {}
  if (typeof tgTemps.CPU === 'number') return tgTemps.CPU

  // Fallback: cualquier sensor que no sea estático
  for (const [k, v] of Object.entries(sensors)) {
    if (!STATIC_SENSORS.includes(k)) {
      const t = typeof v === 'number' ? v : v?.temp_c
      if (typeof t === 'number' && !isNaN(t)) return t
    }
  }
  return null
}

// Mantener extractMaxTemp para mostrar en cards (sin excluir nada)
function extractMaxTemp(sys, gpu) {
  const temps = []
  const thermalSensors = sys?.thermals?.sensors || {}
  Object.values(thermalSensors).forEach(s => {
    const v = typeof s === 'number' ? s : s?.temp_c ?? s?.temperature
    if (typeof v === 'number' && !isNaN(v)) temps.push(v)
  })
  return temps.length > 0 ? Math.max(...temps) : null
}

// Extraer temperatura CPU específicamente
function extractCpuTemp(sys, gpu) {
  // Desde tegrastats
  const tgTemps = gpu?.tegrastats_raw?.temperatures || {}
  if (typeof tgTemps.CPU === 'number') return tgTemps.CPU
  // Desde sys.thermals
  const thermalSensors = sys?.thermals?.sensors || {}
  for (const [k, v] of Object.entries(thermalSensors)) {
    if (k.toLowerCase().includes('cpu')) return v?.temp_c ?? v
  }
  return null
}

// Extraer potencia total en watts
function extractTotalPower(gpu) {
  const power = gpu?.power || {}
  if (Object.keys(power).length === 0) return null

  // Sumar todos los sensores de potencia
  let totalW = 0
  let found = false
  Object.values(power).forEach(p => {
    if (typeof p?.watts === 'number') {
      totalW += p.watts
      found = true
    }
  })
  return found ? round2(totalW) : null
}

function round2(v) {
  return Math.round(v * 100) / 100
}

export const useMetricsStore = create((set, get) => ({
  connected: false,
  wsError: null,
  lastUpdate: null,
  metrics: null,
  hardware: null,
  newAlerts: [],          // Alertas nuevas para toasts
  activeAlertCount: 0,    // Badge en header

  history: {
    cpu: [],
    gpu: [],
    memory: [],
    temperature: [],
    network_rx: [],
    network_tx: [],
    power: [],
  },

  ws: null,

  initWebSocket() {
    const { ws } = get()
    if (ws && ws.readyState === WebSocket.OPEN) return

    try {
      const socket = new WebSocket(getWsUrl())

      socket.onopen = () => {
        set({ connected: true, wsError: null })
        const pingInterval = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }))
          } else {
            clearInterval(pingInterval)
          }
        }, 30000)
      }

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'pong') return

          const t = Date.now()
          const sys = data.system || {}
          const gpu = data.gpu || {}

          set((state) => {
            const cpu = sys.cpu || {}
            const mem = sys.memory || {}

            // Red: buscar en múltiples paths posibles
            const netIfaces = sys.network?.interfaces || sys.network || {}
            const totalRx = Object.values(netIfaces).reduce((s, i) => s + (i?.rx_bytes_sec || i?.rx_rate || 0), 0)
            const totalTx = Object.values(netIfaces).reduce((s, i) => s + (i?.tx_bytes_sec || i?.tx_rate || 0), 0)

            // Temperatura máxima — todas las fuentes
            const maxTemp = extractMaxTemp(sys, gpu)

            // Potencia total
            const totalPower = extractTotalPower(gpu)

            return {
              metrics: data,
              lastUpdate: t,
              history: {
                cpu: appendHistory(state.history.cpu, {
                  t, v: cpu.usage_percent ?? cpu.percent ?? 0
                }),
                gpu: appendHistory(state.history.gpu, {
                  t, v: gpu.utilization_percent ?? gpu?.tegrastats_raw?.gr3d_percent ?? 0
                }),
                memory: appendHistory(state.history.memory, {
                  t, v: mem.percent ?? mem.usage_percent ?? 0
                }),
                temperature: appendHistory(state.history.temperature, {
                  t, v: extractCpuTempForHistory(sys, gpu) ?? maxTemp ?? 0
                }),
                network_rx: appendHistory(state.history.network_rx, { t, v: totalRx }),
                network_tx: appendHistory(state.history.network_tx, { t, v: totalTx }),
                power: appendHistory(state.history.power, {
                  t, v: totalPower ?? 0
                }),
              },
            }
          })
        } catch (e) {
          console.error('WS parse error:', e)
        }
      }

      socket.onerror = () => {
        set({ wsError: 'Connection error', connected: false })
      }

      socket.onclose = () => {
        set({ connected: false })
        setTimeout(() => get().initWebSocket(), 3000)
      }

      set({ ws: socket })
    } catch (err) {
      set({ wsError: err.message, connected: false })
      setTimeout(() => get().initWebSocket(), 5000)
    }
  },

  fetchHardwareInfo: async () => {
    try {
      const hw = await apiFetch('/hardware')
      if (hw) set({ hardware: hw })
    } catch (e) {
      console.error('Failed to fetch hardware info:', e)
    }
  },
}))
