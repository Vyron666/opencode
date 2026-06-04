export function TodoBlock({ block }) {
  const todos = Array.isArray(block.todos) ? block.todos : []
  const showPlaceholder = todos.length === 0

  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="grid min-w-0 w-full max-w-[600px] gap-2.5 rounded-[20px] border border-[var(--line)] bg-white px-4 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.07)]">
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-brand">Todo</div>
          <span className="rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-2 py-1 text-[10px] uppercase text-[var(--text-muted)]">
            {block.status}
          </span>
        </div>

        {showPlaceholder ? (
          <div className="text-[13px] text-[var(--text-dim)]">Updating todos...</div>
        ) : (
          <div className="grid gap-2">
            {todos.map((todo, index) => (
              <div key={`${todo.content}-${index}`} className="flex items-start gap-2.5 text-[13px] text-[var(--text-dim)]">
                <span
                  className={`w-5 shrink-0 font-bold ${
                    todo.status === 'in_progress'
                      ? 'text-brand'
                      : todo.status === 'completed'
                        ? 'text-success'
                        : 'text-[var(--text-muted)]'
                  }`}
                >
                  {todo.status === 'completed' ? '[✓]' : todo.status === 'in_progress' ? '[•]' : '[ ]'}
                </span>
                <span className="break-words leading-relaxed">{todo.content}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
