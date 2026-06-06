export function TodoBlock({ block }) {
  const todos = Array.isArray(block.todos) ? block.todos : []
  const showPlaceholder = todos.length === 0

  return (
    <div className="flex min-w-0">
      <div className="grid w-full max-w-[760px] gap-2.5 rounded-[18px] border border-[#dce6f8] bg-[#f7f9fe] px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2">
          <div className="text-[11px] font-bold tracking-[0.12em] text-[#3566df]">待办列表</div>
          <span className="rounded-full border border-[#dbe5f6] bg-white px-2 py-1 text-[10px] text-[#8a96ab]">{block.status}</span>
        </div>

        {showPlaceholder ? (
          <div className="text-[13px] text-[#61718d]">正在更新待办...</div>
        ) : (
          <div className="grid gap-2">
            {todos.map((todo, index) => (
              <div key={`${todo.content}-${index}`} className="flex items-start gap-2.5 text-[13px] text-[#46546d]">
                <span
                  className={`mt-[2px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    todo.status === 'completed'
                      ? 'bg-[#eaf7f1] text-[#0f9f6e]'
                      : todo.status === 'in_progress'
                        ? 'bg-[#eef3ff] text-[#3566df]'
                        : 'bg-white text-[#8a96ab]'
                  }`}
                >
                  {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '•' : ''}
                </span>
                <span className="break-words leading-7">{todo.content}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
