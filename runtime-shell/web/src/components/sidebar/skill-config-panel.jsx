import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useStore } from '../../store'
import { readErrorMessage } from '../../store/actions/interaction-action-support'
import { Field, inputClassName, secondaryButtonClassName, useViewerContext } from './sidebar-support'

export function SkillConfigPanel() {
  const setFlash = useStore((state) => state.setFlash)
  const { canManageProviderSettings, canManagePlatformSettings } = useViewerContext()
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const [expanded] = useState(true)
  const [paths, setPaths] = useState('')
  const [urls, setUrls] = useState('')
  const [packages, setPackages] = useState([])
  const [configItems, setConfigItems] = useState([])
  const [renameDrafts, setRenameDrafts] = useState({})
  const [uploadFile, setUploadFile] = useState(null)
  const [impactPreview, setImpactPreview] = useState(null)

  useEffect(() => {
    if (!expanded) return
    Promise.all([api.skillConfig.get(), api.skillPackage.list()]).then(([data, packageData]) => {
      setPaths(Array.isArray(data.paths) ? data.paths.join('\n') : '')
      setUrls(Array.isArray(data.urls) ? data.urls.join('\n') : '')
      setConfigItems(Array.isArray(data.items) ? data.items : [])
      setPackages(Array.isArray(packageData.items) ? packageData.items : [])
      setRenameDrafts(Object.fromEntries((Array.isArray(packageData.items) ? packageData.items : []).map((item) => [item.id, item.displayName || item.skillName])))
      setImpactPreview(null)
    })
  }, [expanded])

  if (!canManageProviderSettings) return null

  return (
    <div className="grid gap-2.5">
      <div className="text-xs font-semibold text-[var(--text-dim)]">
        {canManagePlatformSettings ? '平台 Skill 配置' : '我的 Skill 配置'}
      </div>

      {expanded ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            useStore.setState({ pendingSettingsAction: 'skill' })
            const previewResult = await api.configImpact.preview({
              namespace: 'skill',
            }).then(
              (value) => ({ ok: true, value }),
              (error) => ({ ok: false, error }),
            )
            if (previewResult.ok) setImpactPreview(previewResult.value)

            const saveResult = await api.skillConfig.save({
              paths: paths.split('\n').map((item) => item.trim()).filter(Boolean),
              urls: urls.split('\n').map((item) => item.trim()).filter(Boolean),
            }).then(
              (value) => ({ ok: true, value }),
              (error) => ({ ok: false, error }),
            )
            useStore.setState({ pendingSettingsAction: '' })
            if (!saveResult.ok) {
              setFlash(`Skill 配置保存失败: ${readErrorMessage(saveResult.error)}`)
              throw saveResult.error
            }
            const data = await api.skillConfig.get()
            setConfigItems(Array.isArray(data.items) ? data.items : [])
            setFlash('Skill 配置已保存')
          }}
          className="grid gap-2.5 animate-fade-in"
        >
          <div className="grid gap-2 rounded-[12px] border border-[var(--line)] p-3 bg-black/10">
            <div className="text-xs font-semibold text-[var(--text-dim)]">包管理</div>

            <Field label="Skill ZIP">
              <div className="grid gap-2">
                <input type="file" accept=".zip,application/zip" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} className={inputClassName} />
                <button
                  type="button"
                  disabled={!uploadFile || Boolean(pendingSettingsAction)}
                  onClick={async () => {
                    if (!uploadFile) {
                      setFlash('请先选择一个 .zip Skill 压缩包')
                      return
                    }
                    useStore.setState({ pendingSettingsAction: 'skill' })
                    const uploadResult = await api.skillPackage.upload(uploadFile).then(
                      (value) => ({ ok: true, value }),
                      (error) => ({ ok: false, error }),
                    )
                    useStore.setState({ pendingSettingsAction: '' })
                    if (!uploadResult.ok) {
                      setFlash(`Skill 压缩包上传失败: ${readErrorMessage(uploadResult.error)}`)
                      throw uploadResult.error
                    }
                    const [data, packageData] = await Promise.all([api.skillConfig.get(), api.skillPackage.list()])
                    setPaths(Array.isArray(data.paths) ? data.paths.join('\n') : '')
                    setUrls(Array.isArray(data.urls) ? data.urls.join('\n') : '')
                    setConfigItems(Array.isArray(data.items) ? data.items : [])
                    setPackages(Array.isArray(packageData.items) ? packageData.items : [])
                    setRenameDrafts(Object.fromEntries((Array.isArray(packageData.items) ? packageData.items : []).map((item) => [item.id, item.displayName || item.skillName])))
                    setUploadFile(null)
                    setFlash('Skill 压缩包已上传，并已自动写入 Skill URLs；同 scope + 同 skillName 会自动覆盖')
                  }}
                  className={secondaryButtonClassName}
                >
                  {pendingSettingsAction === 'skill' ? '上传中...' : '上传并安装 Skill'}
                </button>
              </div>
            </Field>

            <div className="grid gap-2">
              <span className="text-xs font-medium text-[var(--text-dim)]">{canManagePlatformSettings ? '当前平台 Skill 包' : '我的 Skill 包'}</span>
              {packages.length === 0 ? <div className="text-[11px] text-[var(--text-muted)]">当前还没有已上传的 Skill 包</div> : null}
              {packages.map((item) => (
                <div key={item.id} className="grid gap-1.5 rounded-[12px] border border-[var(--line)] p-2.5 bg-black/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text-primary)]">{item.displayName || item.skillName}</span>
                    <span className="text-[11px] text-[var(--text-muted)]">{item.sourceLabel}</span>
                  </div>
                  <input
                    value={renameDrafts[item.id] ?? item.displayName ?? item.skillName}
                    onChange={(event) => setRenameDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="Skill 展示名"
                    className={inputClassName}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={Boolean(pendingSettingsAction)}
                      onClick={async () => {
                        useStore.setState({ pendingSettingsAction: 'skill' })
                        const renameResult = await api.skillPackage.rename(item.id, (renameDrafts[item.id] || item.skillName).trim()).then(
                          (value) => ({ ok: true, value }),
                          (error) => ({ ok: false, error }),
                        )
                        useStore.setState({ pendingSettingsAction: '' })
                        if (!renameResult.ok) {
                          setFlash(`Skill 包重命名失败: ${readErrorMessage(renameResult.error)}`)
                          throw renameResult.error
                        }
                        const packageData = await api.skillPackage.list()
                        setPackages(Array.isArray(packageData.items) ? packageData.items : [])
                        setRenameDrafts(Object.fromEntries((Array.isArray(packageData.items) ? packageData.items : []).map((currentItem) => [currentItem.id, currentItem.displayName || currentItem.skillName])))
                        setFlash('Skill 包展示名已更新')
                      }}
                      className={secondaryButtonClassName}
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(pendingSettingsAction)}
                      onClick={async () => {
                        useStore.setState({ pendingSettingsAction: 'skill' })
                        const deleteResult = await api.skillPackage.remove(item.id).then(
                          (value) => ({ ok: true, value }),
                          (error) => ({ ok: false, error }),
                        )
                        useStore.setState({ pendingSettingsAction: '' })
                        if (!deleteResult.ok) {
                          setFlash(`删除 Skill 包失败: ${readErrorMessage(deleteResult.error)}`)
                          throw deleteResult.error
                        }
                        const [data, packageData] = await Promise.all([api.skillConfig.get(), api.skillPackage.list()])
                        setPaths(Array.isArray(data.paths) ? data.paths.join('\n') : '')
                        setUrls(Array.isArray(data.urls) ? data.urls.join('\n') : '')
                        setConfigItems(Array.isArray(data.items) ? data.items : [])
                        setPackages(Array.isArray(packageData.items) ? packageData.items : [])
                        setRenameDrafts(Object.fromEntries((Array.isArray(packageData.items) ? packageData.items : []).map((currentItem) => [currentItem.id, currentItem.displayName || currentItem.skillName])))
                        setFlash('Skill 包已删除，并已从当前作用域配置中移除')
                      }}
                      className={secondaryButtonClassName}
                    >
                      删除
                    </button>
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] break-all">{item.description || '无描述'}</div>
                  <div className="text-[11px] text-[var(--text-muted)] break-all">{item.url}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2 rounded-[12px] border border-[var(--line)] p-3 bg-black/10">
            <div className="text-xs font-semibold text-[var(--text-dim)]">配置管理</div>

            <div className="grid gap-2">
              <span className="text-xs font-medium text-[var(--text-dim)]">当前已配置的 Skill 条目</span>
              {configItems.length === 0 ? <div className="text-[11px] text-[var(--text-muted)]">当前没有已配置的 Skill 路径或 URL</div> : null}
              {configItems.map((item) => (
                <div key={`${item.type}:${item.value}:${item.source}`} className="grid gap-1.5 rounded-[12px] border border-[var(--line)] p-2.5 bg-black/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text-primary)]">{item.type === 'path' ? 'Path' : 'URL'}</span>
                    <span className="text-[11px] text-[var(--text-muted)]">{item.source === 'platform_shared' ? '平台共享' : '用户私有'}</span>
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] break-all">{item.value}</div>
                  {canManagePlatformSettings || item.source === 'user_private' ? (
                    <button
                      type="button"
                      disabled={Boolean(pendingSettingsAction)}
                      onClick={async () => {
                        useStore.setState({ pendingSettingsAction: 'skill' })
                        const removeResult = await api.skillConfig.removeItem(item.type, item.value).then(
                          (value) => ({ ok: true, value }),
                          (error) => ({ ok: false, error }),
                        )
                        useStore.setState({ pendingSettingsAction: '' })
                        if (!removeResult.ok) {
                          setFlash(`删除 Skill 配置项失败: ${readErrorMessage(removeResult.error)}`)
                          throw removeResult.error
                        }
                        const data = await api.skillConfig.get()
                        setPaths(Array.isArray(data.paths) ? data.paths.join('\n') : '')
                        setUrls(Array.isArray(data.urls) ? data.urls.join('\n') : '')
                        setConfigItems(Array.isArray(data.items) ? data.items : [])
                        setFlash('Skill 配置项已删除')
                      }}
                      className={secondaryButtonClassName}
                    >
                      删除该配置项
                    </button>
                  ) : (
                    <div className="text-[11px] text-[var(--text-muted)]">继承自平台共享，当前账号不可删除</div>
                  )}
                </div>
              ))}
            </div>

            <Field label="Skill Paths">
              <textarea value={paths} onChange={(event) => setPaths(event.target.value)} placeholder={'每行一个本地路径\n例如\nC:\\Users\\xxx\\.codex\\skills'} className={`${inputClassName} min-h-[96px]`} />
            </Field>
            <Field label="Skill URLs">
              <textarea value={urls} onChange={(event) => setUrls(event.target.value)} placeholder={'每行一个远程 URL\n例如\nhttps://example.com/skills/index.json'} className={`${inputClassName} min-h-[96px]`} />
            </Field>
          </div>

          {impactPreview ? (
            <div className="rounded-[10px] border border-[var(--line)] bg-black/20 px-3 py-2 text-[11px] text-[var(--text-dim)]">
              {impactPreview.summary}；预计影响 {impactPreview.affectedSessionCount} 个活跃会话
            </div>
          ) : null}

          <button type="submit" disabled={Boolean(pendingSettingsAction)} className="rounded-[10px] py-2.5 px-4 font-semibold text-sm bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all shadow-glow disabled:opacity-40 disabled:cursor-not-allowed">
            {pendingSettingsAction === 'skill' ? '保存中...' : '保存 Skill 配置'}
          </button>
        </form>
      ) : null}
    </div>
  )
}
