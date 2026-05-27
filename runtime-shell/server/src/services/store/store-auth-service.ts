import * as AuthRepo from "../../repos/auth-repo"
import type { User } from "../../types"

export class StoreAuthService {
  async listAuthSessions() {
    return AuthRepo.listSessions()
  }

  async createAuthSession(input: {
    user: User
    tokenHash: string
    expiresAt: string
  }) {
    return AuthRepo.createSession(input)
  }

  async findAuthSession(tokenHash: string) {
    return AuthRepo.findSession(tokenHash)
  }

  async deleteAuthSession(tokenHash: string) {
    return AuthRepo.removeSession(tokenHash)
  }

  async expireAuthSession(tokenHash: string) {
    return AuthRepo.expireSession(tokenHash)
  }
}
