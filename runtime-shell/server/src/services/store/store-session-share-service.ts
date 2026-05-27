import type { BusinessSession } from "../../types"
import * as SessionShareRepo from "../../repos/session-share-repo"

export class StoreSessionShareService {
  async listSharesForTargetUser(userId: string) {
    return SessionShareRepo.listSharesForTargetUser(userId)
  }

  async findShareForSessionTarget(input: {
    businessSessionId: string
    targetUserId: string
  }) {
    return SessionShareRepo.findShareForSessionTarget(input)
  }

  async createShareBinding(input: {
    session: BusinessSession
    ownerUserId: string
    targetUserId: string
  }) {
    return SessionShareRepo.createShareBinding(input)
  }

  async revokeShareBinding(input: {
    businessSessionId: string
    targetUserId: string
    updatedBy: string
  }) {
    return SessionShareRepo.revokeShareBinding(input)
  }
}
