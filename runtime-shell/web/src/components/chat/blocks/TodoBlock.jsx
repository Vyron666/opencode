export function TodoBlock({ block }) {
  const todos = Array.isArray(block.todos) ? block.todos : []
  const showPlaceholder = todos.length === 0

  return (
    <div className="flex min-w-0 gap-3 items-start">
      <div className="min-w-0 rounded-[14px] px-3.5 py-2.5 border border-[var(--line)] bg-black/30 grid gap-2 max-w-[560px] w-full">
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-bold text-brand tracking-widest uppercase">Todo</div>
          <span className="text-[10px] text-[var(--text-muted)] uppercase">{block.status}</span>
        </div>
        {showPlaceholder ? (
          <div className="text-xs text-[var(--text-dim)]">Updating todos...</div>
        ) : (
          <div className="grid gap-1.5">
            {todos.map((todo, index) => (
              <div key={`${todo.content}-${index}`} className="flex items-start gap-2 text-xs text-[var(--text-dim)]">
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
