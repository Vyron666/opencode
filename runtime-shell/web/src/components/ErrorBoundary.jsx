import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[Runtime Shell] render error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-dvh bg-[#14100d] text-[#e4d9cc]">
          <div className="grid gap-4 text-center max-w-md">
            <div className="w-16 h-16 mx-auto rounded-[22px] grid place-items-center text-2xl font-extrabold text-[#14100d]"
              style={{ background: 'linear-gradient(135deg, #d4a05a, #9c6e38)' }}>
              RS
            </div>
            <h1 className="text-xl font-bold">界面出错</h1>
            <p className="text-sm text-[var(--text-muted)]">
              渲染组件时发生了意外错误。请尝试刷新页面。
            </p>
            <pre className="text-xs text-left p-3 rounded-[14px] bg-black/40 border border-danger/20 text-danger font-mono whitespace-pre-wrap break-words max-h-[200px] overflow-auto">
              {this.state.error?.message || '未知错误'}
            </pre>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
              className="rounded-[10px] py-2.5 px-4 font-semibold text-sm bg-brand text-[#14100d] shadow-glow hover:brightness-110 transition-all"
            >
              刷新页面
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
