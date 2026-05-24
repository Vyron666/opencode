export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#14100d', strong: '#1c1713', raised: '#231e19' },
        surface: { DEFAULT: 'rgba(28,23,19,0.82)', solid: '#231e19' },
        line: { DEFAULT: 'rgba(181,148,116,0.09)', strong: 'rgba(181,148,116,0.16)', focus: 'rgba(212,160,90,0.28)' },
        text: { DEFAULT: '#e4d9cc', dim: '#a69888', muted: '#7a6e60' },
        brand: { DEFAULT: '#d4a05a', strong: '#c1873e', text: '#f0d6a4', soft: 'rgba(212,160,90,0.10)', glow: 'rgba(212,160,90,0.18)' },
        accent: { DEFAULT: '#d4785c', soft: 'rgba(212,120,92,0.12)' },
        danger: { DEFAULT: '#c44a3a', soft: 'rgba(196,74,58,0.12)' },
        success: { DEFAULT: '#5a9e7c', soft: 'rgba(90,158,124,0.12)' },
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
        glow: '0 0 0 1px rgba(212,160,90,0.14), 0 4px 20px rgba(212,160,90,0.08)',
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
