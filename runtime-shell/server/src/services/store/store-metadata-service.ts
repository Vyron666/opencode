import type { ReadState } from "./store-domain-support"

export class StoreMetadataService {
  constructor(private readonly readState: ReadState) {}

  listTenants() {
    return this.readState().tenants
  }

  listOrganizations() {
    return this.readState().organizations
  }
}
