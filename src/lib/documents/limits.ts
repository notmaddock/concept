const MiB = 1024 * 1024

/** Mutable application defaults; callers may pass a smaller operation-specific budget. */
export const packageLimits = {
  packageBytes: 100 * MiB,
  expandedBytes: 256 * MiB,
  assetBytes: 50 * MiB,
  documentBytes: 32 * MiB,
  manifestBytes: MiB,
  entries: 2048,
  expansionRatio: 100,
  nameCharacters: 4096,
  featureCharacters: 128,
  features: 128,
}

export type PackageLimits = typeof packageLimits

export const assetRetryPolicy = {
  initialMs: 15_000,
  maximumMs: 5 * 60_000,
  jitter: 0.2,
}
