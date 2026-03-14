import { create } from 'zustand'

const STORAGE_KEY = 'jetson-dashboard-theme'

const applyTheme = (theme) => {
  const root = document.documentElement
  if (theme === 'light') {
    root.setAttribute('data-theme', 'light')
  } else {
    root.removeAttribute('data-theme')
  }
}

const saved = localStorage.getItem(STORAGE_KEY) || 'dark'
applyTheme(saved)

export const useThemeStore = create((set) => ({
  theme: saved,
  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEY, theme)
    applyTheme(theme)
    set({ theme })
  },
  toggle: () => {
    const next = saved === 'dark' ? 'light' : 'dark'
    // re-read from store
    set((state) => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem(STORAGE_KEY, newTheme)
      applyTheme(newTheme)
      return { theme: newTheme }
    })
  },
}))
