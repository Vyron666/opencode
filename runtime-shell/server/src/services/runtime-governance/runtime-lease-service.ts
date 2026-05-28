import { Config } from "../../config"
import * as RuntimeLeaseRepo from "../../repos/runtime-lease-repo"
import { now } from "../../store/state-support"
import { sessionService } from "../store/store-singleton"

export async function refreshRuntimeLease(input: {
  businessSessionId: string
  workerId: string
  leaseOwner: string
}) {
  return RuntimeLeaseRepo.upsertLease({
    businessSessionId: input.businessSessionId,
    workerId: input.workerId,
    leaseOwner: input.leaseOwner,
    leaseExpiresAt: new Date(Date.now() + Config.runtimeLeaseDurationMs).toISOString(),
  })
}

export async function releaseRuntimeLease(sessionId: string) {
  await RuntimeLeaseRepo.deleteLeaseBySessionId(sessionId)
}

export async function getRuntimeLease(sessionId: string) {
  return RuntimeLeaseRepo.findLeaseBySessionId(sessionId)
}

export async function listExpiredRuntimeLeases() {
  return RuntimeLeaseRepo.listExpiredLeases(now())
}

export async function renewRuntimeLeaseForSession(sessionId: string) {
  const session = await sessionService.getSession(sessionId)
  if (!session?.binding?.runtimeKey || !session.workerId) return
  return refreshRuntimeLease({
    businessSessionId: session.id,
    workerId: session.workerId,
    leaseOwner: session.binding.runtimeKey,
  })
}
