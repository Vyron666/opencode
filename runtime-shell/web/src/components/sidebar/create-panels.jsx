import { useState } from 'react'
import { useStore } from '../../store'
import { Field, inputClassName } from './sidebar-support'

export function CreateSessionPanel() {
  const store = useStore()
  const [title, setTitle] = useState('Runtime Shell 会话')
  const [projectId, setProjectId] = useState('default')
  // 中文/English: Docker 默认工作区根目录就是 `/workspace/workspaces`。
  const [workspacePath, setWorkspacePath] = useState('/workspace/workspaces')

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void store.createSession(title, projectId, workspacePath)
      }}
      className="grid gap-2.5 pb-3 border-b border-[var(--line)]"
    >
      <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Create</span>
      <Field label="会话标题">
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClassName} />
      </Field>
      <Field label="项目 ID">
        <input value={projectId} onChange={(event) => setProjectId(event.target.value)} className={inputClassName} />
      </Field>
      <Field label="工作区路径">
        <input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} className={inputClassName} />
      </Field>
      <button type="submit" className="rounded-[10px] py-2.5 px-4 font-semibold text-sm bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all shadow-glow">
        创建并进入
      </button>
    </form>
  )
}

export function ForkSessionPanel() {
  const store = useStore()
  const [title, setTitle] = useState('Forked Session')

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void store.forkSession(title)
      }}
      className="grid gap-2.5"
    >
      <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Fork</span>
      <Field label="分支标题">
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClassName} />
      </Field>
      <button type="submit" className="rounded-[10px] py-2 px-4 text-xs font-semibold bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors">
        从当前会话创建分支
      </button>
    </form>
  )
}
