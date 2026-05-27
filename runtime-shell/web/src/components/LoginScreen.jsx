import { useState } from 'react'
import { useStore } from '../store'
import { readErrorMessage } from '../store/actions/interaction-action-support'

export default function LoginScreen() {
  const login = useStore((s) => s.login)
  const setFlash = useStore((s) => s.setFlash)
  const loadSessions = useStore((s) => s.loadSessions)
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('change-me')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const loginResult = await login(username, password).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    )
    if (!loginResult.ok) {
      setError(readErrorMessage(loginResult.error) || '登录失败')
      setLoading(false)
      return
    }
    const data = loginResult.value
    const sessionResult = await loadSessions().then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    )
    if (!sessionResult.ok) {
      setError(`加载会话失败: ${readErrorMessage(sessionResult.error)}`)
      setLoading(false)
      return
    }
    setFlash(`欢迎回来，${data.user.displayName}`)
    setLoading(false)
  }

  return (
    <div className="flex items-center justify-center min-h-dvh">
      <div className="grid grid-cols-[1.1fr_400px] gap-6 max-w-[1000px] w-full px-8">
        {/* Hero */}
        <div className="rounded-[26px] border border-[var(--line)] bg-[var(--surface)] shadow-lg backdrop-blur-2xl flex flex-col justify-between gap-7 p-9">
          <div>
            <div className="w-16 h-16 rounded-[22px] grid place-items-center text-2xl font-extrabold text-[#14100d]"
              style={{ background: 'linear-gradient(135deg, #d4a05a, #9c6e38)', boxShadow: '0 8px 32px rgba(212,160,90,0.2)' }}>
              RS
            </div>
            <div className="mt-6">
              <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">ACP Runtime Platform</span>
              <h1 className="mt-2 mb-3 text-[44px] font-bold leading-[1.06] tracking-[-0.02em]"
                style={{ background: 'linear-gradient(135deg, #e4d9cc, #f0d6a4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Runtime Shell
              </h1>
              <p className="max-w-[480px] text-base leading-relaxed text-[var(--text-dim)]">
                独立登录后进入聊天工作区，面向 opencode 的多用户 ACP 运行壳。
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { title: 'Chat First', text: '主界面以对话为核心，设置与审批放在侧边。' },
              { title: 'ACP Ready', text: '保留会话管理、模式切换、权限审批与事件流能力。' },
            ].map((p) => (
              <div key={p.title} className="rounded-[20px] p-4 border border-[var(--line)] bg-black/20 hover:border-[var(--line-strong)] transition-colors">
                <div className="font-bold text-sm text-brand-text">{p.title}</div>
                <div className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{p.text}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Login Panel */}
        <div className="rounded-[26px] border border-[var(--line)] bg-[var(--surface)] shadow-lg backdrop-blur-2xl flex flex-col justify-center gap-4 p-8">
          <div>
            <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Sign In</span>
            <h2 className="mt-1 text-xl font-bold">登录 Runtime Shell</h2>
          </div>

          <form onSubmit={handleSubmit} className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-[var(--text-dim)]">用户名</span>
              <select
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-[10px] border border-[var(--line-strong)] px-3.5 py-2.5 bg-black/55 text-[var(--text)] outline-none focus:border-[rgba(212,160,90,0.28)] focus:shadow-[0_0_0_3px_rgba(212,160,90,0.1)] appearance-none"
                style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23a69888' d='M6 7.8L2.4 4.2h7.2z'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: '32px' }}
              >
                <option value="admin">admin</option>
                <option value="developer">developer</option>
                <option value="developer-secondary">developer-secondary</option>
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-[var(--text-dim)]">密码</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full rounded-[10px] border border-[var(--line-strong)] px-3.5 py-2.5 bg-black/55 text-[var(--text)] outline-none focus:border-[rgba(212,160,90,0.28)] focus:shadow-[0_0_0_3px_rgba(212,160,90,0.1)] placeholder:text-[var(--text-muted)]"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="rounded-[10px] py-2.5 px-4 font-semibold text-sm bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all disabled:opacity-50 shadow-glow"
            >
              {loading ? '登录中...' : '进入聊天工作区'}
            </button>
          </form>

          <div className="flex items-center gap-2 rounded-[14px] px-3.5 py-2.5 bg-brand/10 border border-[var(--line)] text-xs text-[var(--text-dim)]">
            <span>默认密码：</span>
            <code className="font-mono text-xs px-2 py-0.5 rounded-full bg-black/40 text-brand-text">change-me</code>
          </div>

          {error ? (
            <div className="rounded-[14px] px-3.5 py-2.5 bg-danger/10 border border-danger/20 text-danger text-xs">
              {error}
            </div>
          ) : (
            <div className="rounded-[14px] px-3.5 py-2.5 border border-dashed border-[var(--line-strong)] bg-black/30 text-[var(--text-muted)] text-xs text-center">
              当前尚未登录。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
