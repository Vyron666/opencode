export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#eef4ff', strong: '#e3edfc', raised: '#d6e4fb' },
        surface: { DEFAULT: '#ffffff', solid: '#f8fbff' },
        line: { DEFAULT: '#d9e5f7', strong: '#c5d7f3', focus: 'rgba(37,99,235,0.18)' },
        text: { DEFAULT: '#0f172a', dim: '#334155', muted: '#64748b' },
        brand: { DEFAULT: '#2563eb', strong: '#1d4ed8', text: '#1e40af', soft: 'rgba(37,99,235,0.10)', glow: 'rgba(37,99,235,0.18)' },
        accent: { DEFAULT: '#0ea5e9', soft: 'rgba(14,165,233,0.12)' },
        danger: { DEFAULT: '#dc2626', soft: 'rgba(220,38,38,0.12)' },
        success: { DEFAULT: '#059669', soft: 'rgba(5,150,105,0.12)' },
      },
      fontFamily: {
        ui: ['"PingFang SC"', '"Microsoft YaHei"', '"Hiragino Sans GB"', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Code"', '"Fira Code"', '"JetBrains Mono"', '"Consolas"', 'monospace'],
      },
      borderRadius: {
        sm: '10px',
        md: '14px',
        lg: '20px',
        xl: '26px',
        full: '999px',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(37,99,235,0.10), 0 12px 32px rgba(37,99,235,0.16)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s cubic-bezier(0.16,1,0.3,1)',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16,1,0.3,1)',
        'slide-down': 'slideDown 0.3s cubic-bezier(0.16,1,0.3,1)',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        slideDown: { '0%': { opacity: '0', transform: 'translateY(-8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
