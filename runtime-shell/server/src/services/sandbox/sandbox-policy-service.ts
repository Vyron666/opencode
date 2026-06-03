import type { SandboxDiffPolicyResult, SandboxDiffSummary } from "../../types"

export function evaluateSandboxDiffPolicy(summary: SandboxDiffSummary): SandboxDiffPolicyResult {
  const reasons: string[] = []
  const touched = [...summary.addedFiles, ...summary.modifiedFiles, ...summary.deletedFiles]
  if (summary.deletedFiles.length >= 20) reasons.push("too_many_deletions")
  if (touched.some((file) => isSensitiveSandboxPath(file))) reasons.push("sensitive_path")
  return {
    requiresReview: reasons.length > 0,
    reasons,
  }
}

export function isSensitiveSandboxPath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/")
  return normalized === ".env"
    || normalized.startsWith(".env.")
    || normalized.endsWith(".pem")
    || normalized.endsWith(".key")
    || normalized.startsWith(".opencode/")
    || normalized.startsWith(".git/")
}
