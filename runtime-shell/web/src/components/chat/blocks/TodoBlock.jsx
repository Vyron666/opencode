export function TodoBlock({ block }) {
  const todos = Array.isArray(block.todos) ? block.todos : []
  const showPlaceholder = todos.length === 0

  return (
    <div className="flex min-w-0 gap-3 items-start">
      <div className="min-w-0 rounded-[18px] px-4 py-3 border border-[rgba(181,148,116,0.12)] bg-black/30 grid gap-2.5 max-w-[600px] w-full shadow-[0_10px_28px_rgba(0,0,0,0.1)]">
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-bold text-brand tracking-widest uppercase">Todo</div>
          <span className="text-[10px] text-[var(--text-muted)] uppercase rounded-full border border-[rgba(181,148,116,0.16)] px-2 py-1">{block.status}</span>
        </div>
        {showPlaceholder ? (
          <div className="text-[13px] text-[var(--text-dim)]">Updating todos...</div>
        ) : (
          <div className="grid gap-2">
            {todos.map((todo, index) => (
              <div key={`${todo.content}-${index}`} className="flex items-start gap-2.5 text-[13px] text-[var(--text-dim)]">
                <span className={`w-5 shrink-0 font-bold ${todo.status === 'in_progress' ? 'text-brand' : todo.status === 'completed' ? 'text-success' : 'text-[var(--text-muted)]'}`}>
                  {todo.status === 'completed' ? '[✓]' : todo.status === 'in_progress' ? '[•]' : '[ ]'}
                </span>
                <span className="leading-relaxed break-words">{todo.content}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
