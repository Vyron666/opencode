import { useState } from 'react'
import { useStore } from '../store'
import { readErrorMessage } from '../store/actions/interaction-action-support'

export default function LoginScreen() {
  const login = useStore((state) => state.login)
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

    setLoading(false)
  }

  return (
    <div className="grid min-h-dvh place-items-center overflow-hidden bg-[#f3f4f6] px-6 py-8">
      <div className="relative w-full max-w-[1400px] overflow-hidden rounded-[32px] bg-[#f6f8ff] shadow-[0_34px_90px_rgba(15,23,42,0.10)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(59,130,246,0.18),transparent_24%),radial-gradient(circle_at_86%_18%,rgba(56,189,248,0.16),transparent_22%),linear-gradient(180deg,#f7f9ff_0%,#eef3ff_100%)]" />

        <div className="relative grid min-h-[720px] grid-cols-[1.15fr_420px] max-[980px]:grid-cols-1">
          <section className="flex flex-col justify-center px-16 py-16 max-[980px]:px-8 max-[980px]:pb-8 max-[980px]:pt-12">
            <div className="grid gap-8">
              <div className="grid h-16 w-16 place-items-center rounded-[18px] bg-brand text-2xl font-extrabold text-white shadow-[0_16px_34px_rgba(37,99,235,0.24)]">
                RS
              </div>

              <div className="grid gap-4">
                <h1 className="text-[56px] font-bold tracking-[-0.05em] text-[#18233b] max-[980px]:text-[42px]">
                  Runtime Shell
                </h1>
                <p className="max-w-[440px] text-[15px] leading-8 text-[#6b7a95]">
                  企业级 AI Agent 运行平台
                </p>
                <p className="max-w-[520px] text-[15px] leading-8 text-[#6b7a95]">
                  多模型、多会话、工作区隔离、沙箱安全、MCP 扩展与 Skill 协作，都在同一块工作台里完成。
                </p>
              </div>
            </div>
          </section>

          <section className="flex items-center justify-center px-10 py-14 max-[980px]:border-t max-[980px]:border-[#e1e9fb] max-[980px]:px-8">
            <div className="w-full rounded-[26px] bg-white px-8 py-9 shadow-[0_18px_42px_rgba(15,23,42,0.08)]">
              <div className="grid gap-7">
                <div className="grid gap-2">
                  <h2 className="text-[20px] font-bold text-[#18233b]">登录</h2>
                </div>

                <form onSubmit={handleSubmit} className="grid gap-5">
                  <label className="grid gap-2">
                    <span className="text-[13px] font-semibold text-[#6b7a95]">用户名</span>
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="请输入用户名"
                      className="h-11 rounded-[12px] border border-[#d8e3fb] bg-[#f8faff] px-4 text-sm text-[#18233b] outline-none transition-colors focus:border-[#3b82f6] focus:bg-white"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-[13px] font-semibold text-[#6b7a95]">密码</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="请输入密码"
                      className="h-11 rounded-[12px] border border-[#d8e3fb] bg-[#f8faff] px-4 text-sm text-[#18233b] outline-none transition-colors focus:border-[#3b82f6] focus:bg-white"
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={loading}
                    className="h-11 rounded-[12px] bg-brand text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? '登录中...' : '登录'}
                  </button>
                </form>

                <div className="text-center text-xs text-[#98a5bd]">
                  默认密码: <span className="font-semibold text-[#7b8cad]">change-me</span>
                </div>

                {error ? (
                  <div className="rounded-[14px] border border-danger/20 bg-danger/10 px-4 py-3 text-xs text-danger">
                    {error}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
