/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono:    ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
        display: ['"Orbitron"', 'monospace'],
        body:    ['"IBM Plex Sans"', 'sans-serif'],
      },
      colors: {
        jet: {
          // Colores fijos hex para que Tailwind pueda calcular opacidades (bg-jet-cyan/10 etc.)
          // El tema light se aplica via CSS variables en index.css sobre los elementos
          bg:      '#080c10',
          surface: '#0d1117',
          card:    '#161b22',
          border:  '#21262d',
          muted:   '#30363d',
          text:    '#e6edf3',
          dim:     '#7d8590',
          green:   '#3fb950',
          cyan:    '#58a6ff',
          yellow:  '#d29922',
          red:     '#f85149',
          purple:  '#bc8cff',
          orange:  '#d18616',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan':       'scan 3s linear infinite',
        'blink':      'blink 1s step-end infinite',
      },
      keyframes: {
        scan: {
          '0%':   { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        blink: {
          '0%, 100%': { opacity: 1 },
          '50%':      { opacity: 0 },
        },
      },
    },
  },
  plugins: [],
}
