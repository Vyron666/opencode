export function StatusBlock({ block }) {
  return (
    <div className="flex justify-center px-4">
      <div className="w-full rounded-[14px] border border-[#dce6f8] bg-[#f7f9fe] px-4 py-2.5 text-center">
        <div className="text-[12px] text-[#61718d]">{block.message}</div>
      </div>
    </div>
  )
}
