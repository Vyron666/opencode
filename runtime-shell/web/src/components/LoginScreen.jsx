import { useState } from 'react'
import { useStore } from '../store'
import { readErrorMessage } from '../store/actions/interaction-action-support'

export default function LoginScreen() {
  const login = useStore((state) => state.login)
  const setFlash = useStore((state) => state.setFlash)
  const loadSessions = useStore((state) => state.loadSessions)
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('change-me')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    const loginResult = await login(username, password).then(
      (value) => ({ ok: true, value }),
      (cause) => ({ ok: false, cause }),
    )
    if (!loginResult.ok) {
      setError(readErrorMessage(loginResult.cause) || '登录失败')
      setLoading(false)
      return
    }

    const sessionResult = await loadSessions().then(
      (value) => ({ ok: true, value }),
      (cause) => ({ ok: false, cause }),
    )
    if (!sessionResult.ok) {
      setError(`加载会话失败: ${readErrorMessage(sessionResult.cause)}`)
      setLoading(false)
      return
    }

    setFlash(`欢迎回来，${loginResult.value.user.displayName}`)
    setLoading(false)
  }

  return (
    <div className="min-h-dvh px-6 py-8 flex items-center justify-center">
      <div className="relative w-full max-w-[1180px] overflow-hidden rounded-[34px] border border-white/60 bg-[rgba(255,255,255,0.74)] shadow-[0_30px_80px_rgba(15,23,42,0.10)] backdrop-blur-xl">
        <div className="absolute left-0 top-0 h-full w-[46%] bg-[linear-gradient(180deg,rgba(248,250,255,0.98),rgba(232,240,255,0.94))] max-[980px]:hidden" />
        <div className="absolute left-[36px] top-[36px] h-36 w-36 rounded-full bg-brand/10 blur-3xl max-[980px]:hidden" />
        <div className="absolute right-[120px] top-[120px] h-48 w-48 rounded-full bg-accent/10 blur-3xl max-[980px]:hidden" />

        <div className="relative grid min-h-[720px] grid-cols-[1.15fr_420px] max-[980px]:grid-cols-1">
          <section className="flex flex-col justify-between gap-10 px-14 py-14 max-[980px]:px-8 max-[980px]:pb-6 max-[980px]:pt-10">
            <div className="grid gap-6">
              <div
                className="grid h-16 w-16 place-items-center rounded-[18px] text-2xl font-extrabold text-white"
                style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', boxShadow: '0 16px 30px rgba(37,99,235,0.22)' }}
              >
                RS
              </div>

              <div className="grid gap-3">
                <span className="text-[11px] font-semibold tracking-[0.22em] uppercase text-brand">ACP Runtime Platform</span>
                <h1 className="max-w-[560px] text-[54px] font-bold leading-[1.02] tracking-[-0.04em] text-[var(--text)] max-[980px]:text-[42px]">
                  Runtime Shell
                </h1>
                <p className="max-w-[520px] text-[16px] leading-8 text-[var(--text-dim)]">
                  登录后即可进入 ACP 运行工作台，在同一界面里完成会话协作、运行态控制、模型切换与平台治理。
                </p>
              </div>

              <div className="flex flex-wrap gap-3 text-[11px] text-[var(--text-muted)]">
                <span className="rounded-full border border-[var(--line)] bg-white/80 px-3 py-1.5">多会话并行</span>
                <span className="rounded-full border border-[var(--line)] bg-white/80 px-3 py-1.5">运行态可视化</span>
                <span className="rounded-full border border-[var(--line)] bg-white/80 px-3 py-1.5">工作区协作</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 max-[720px]:grid-cols-1">
              {[
                { title: 'Chat First', text: '主界面以对话为中心，运行控制与平台设置集中在边栏处理。' },
                { title: 'ACP Ready', text: '保留会话状态、工具调用、权限审批和事件流这些 ACP 运行能力。' },
              ].map((panel) => (
                <div key={panel.title} className="rounded-[24px] border border-white/70 bg-white/82 p-5 shadow-[0_14px_32px_rgba(15,23,42,0.06)]">
                  <div className="text-sm font-bold text-[var(--text)]">{panel.title}</div>
                  <div className="mt-2 text-xs leading-6 text-[var(--text-muted)]">{panel.text}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="border-l border-[var(--line)] bg-[rgba(255,255,255,0.94)] px-10 py-12 max-[980px]:border-l-0 max-[980px]:border-t max-[980px]:px-8">
            <div className="mx-auto flex h-full max-w-[340px] flex-col justify-center gap-6">
              <div className="grid gap-2">
                <span className="text-[11px] font-semibold tracking-[0.18em] uppercase text-brand">Sign In</span>
                <h2 className="text-[28px] font-bold tracking-[-0.03em] text-[var(--text)]">登录 Runtime Shell</h2>
                <p className="text-sm leading-6 text-[var(--text-muted)]">输入账号与密码，进入最近一次会话或继续创建新的工作流。</p>
              </div>

              <form onSubmit={handleSubmit} className="grid gap-4">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold text-[var(--text-dim)]">用户名</span>
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="请输入用户名"
                    className="w-full rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)] placeholder:text-[var(--text-muted)]"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-xs font-semibold text-[var(--text-dim)]">密码</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请输入密码"
                    className="w-full rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)] placeholder:text-[var(--text-muted)]"
                  />
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-[14px] bg-brand px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-[var(--brand-strong)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? '登录中...' : '进入工作台'}
                </button>
              </form>

              <div className="rounded-[18px] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-xs text-[var(--text-dim)]">
                默认密码：
                <code className="ml-2 rounded-full bg-white px-2.5 py-1 font-mono text-[11px] text-[var(--brand-text)]">change-me</code>
              </div>

              {error ? (
                <div className="rounded-[18px] border border-danger/20 bg-danger/10 px-4 py-3 text-xs text-danger">{error}</div>
              ) : (
                <div className="rounded-[18px] border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] px-4 py-3 text-center text-xs text-[var(--text-muted)]">
                  当前尚未登录。
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
