import * as UserRepo from "../../repos/user-repo"
import type { ReadState } from "./store-domain-support"

export class StoreUserService {
  constructor(private readonly readState: ReadState) {}

  listUsers() {
    return UserRepo.listAllUsers(this.readState())
  }

  findUser(username: string, password?: string) {
    return UserRepo.findUserByCredentials(this.readState(), username, password)
  }

  getUser(userId: string) {
    return UserRepo.findUserById(this.readState(), userId)
  }
}
