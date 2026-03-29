import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useMetricsStore } from './store/metricsStore'
import { useAuthStore } from './store/authStore'
import Layout from './components/layout/Layout'
import { LoginPage } from './pages/LoginPage'
import Dashboard from './pages/Dashboard'
import CPUPage from './pages/CPUPage'
import GPUPage from './pages/GPUPage'
import MemoryPage from './pages/MemoryPage'
import { StoragePage, NetworkPage, ThermalPage, LogsPage, SettingsPage } from './pages/OtherPages'
import ProcessesPage from './pages/ProcessesPage'
import DockerPage from './pages/DockerPage'
import AlertsPage from './pages/AlertsPage'
import HistoryPage  from './pages/HistoryPage'
import SystemdPage   from './pages/SystemdPage'
import CameraPage    from './pages/CameraPage'
import Ros2Page      from './pages/Ros2Page'
import BackupPage    from './pages/BackupPage'
import SchedulerPage from './pages/SchedulerPage'
import BatteryPage   from './pages/BatteryPage'

export default function App() {
  const { initWebSocket, fetchHardwareInfo } = useMetricsStore()
  const { checkAuthStatus, isAuthenticated, authEnabled } = useAuthStore()
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    checkAuthStatus().then(() => setAuthChecked(true))
  }, [])

  useEffect(() => {
    if (authChecked && isAuthenticated()) {
      fetchHardwareInfo()
      initWebSocket()
    }
  }, [authChecked, authEnabled])

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-jet-bg flex items-center justify-center">
        <div className="font-mono text-xs text-jet-dim animate-pulse tracking-widest">INITIALIZING...</div>
      </div>
    )
  }

  if (!isAuthenticated()) {
    return <LoginPage onLogin={() => { fetchHardwareInfo(); initWebSocket() }} />
  }

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"  element={<Dashboard />} />
        <Route path="cpu"        element={<CPUPage />} />
        <Route path="gpu"        element={<GPUPage />} />
        <Route path="memory"     element={<MemoryPage />} />
        <Route path="storage"    element={<StoragePage />} />
        <Route path="network"    element={<NetworkPage />} />
        <Route path="thermals"   element={<ThermalPage />} />
        <Route path="processes"  element={<ProcessesPage />} />
        <Route path="docker"     element={<DockerPage />} />
        <Route path="logs"       element={<LogsPage />} />
        <Route path="alerts"     element={<AlertsPage />} />
        <Route path="history"    element={<HistoryPage />} />
        <Route path="systemd"   element={<SystemdPage />} />
        <Route path="camera"    element={<CameraPage />} />
        <Route path="ros2"      element={<Ros2Page />} />
        <Route path="backup"    element={<BackupPage />} />
        <Route path="scheduler" element={<SchedulerPage />} />
        <Route path="battery"   element={<BatteryPage />} />
        <Route path="settings"   element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
