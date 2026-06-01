export function ErrorBlock({ block }) {
  return (
    <div className="flex justify-center px-4">
      <div className="rounded-[14px] px-4 py-2.5 border border-danger/20 bg-danger/5 text-center max-w-[540px] w-full">
        <div className="text-[11px] text-danger">{block.message}</div>
      </div>
    </div>
  )
}
