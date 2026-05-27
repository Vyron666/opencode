import type { Logger } from "../../log"
import type { PersistedState } from "../../types"
import { loadStateFromDisk, saveStateToDisk } from "../../store/persistence-support"
import { defaultState } from "../../store/state-support"

export class StoreStateService {
  private state = defaultState()
  private writeTask = Promise.resolve()
  private dirtyWriteVersion = 0
  private flushedWriteVersion = 0

  constructor(private readonly log: Logger) {}

  readState() {
    return this.state
  }

  async load() {
    this.state = await loadStateFromDisk(this.log)
  }

  async save() {
    const targetVersion = ++this.dirtyWriteVersion
    this.writeTask = this.writeTask.then(() => this.flushWrites(targetVersion))
    await this.writeTask
  }

  private async flushWrites(targetVersion: number) {
    while (this.flushedWriteVersion < targetVersion) {
      const nextVersion = this.dirtyWriteVersion
      // 中文/English: coalesce burst writes into the newest snapshot so streaming
      // chunks do not force one full state-file rewrite per event.
      await saveStateToDisk(this.state)
      this.flushedWriteVersion = nextVersion
    }
  }
}
