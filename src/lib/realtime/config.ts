export interface RealtimeConfig {
  enabled: boolean
  updatePeriodMs: number
  presencePeriodMs: number
}

export function realtimeConfig(
  input: Partial<RealtimeConfig> = {},
): RealtimeConfig {
  const config = {
    enabled: true,
    updatePeriodMs: 100,
    presencePeriodMs: 100,
    ...input,
  }
  for (const value of [config.updatePeriodMs, config.presencePeriodMs]) {
    if (!Number.isInteger(value) || value < 16 || value > 5000)
      throw new RangeError(
        'Realtime periods must be integers between 16 and 5000 ms.',
      )
  }
  if (typeof config.enabled !== 'boolean')
    throw new TypeError('Invalid realtime enabled flag.')
  return config
}

export const realtime = realtimeConfig({
  enabled: import.meta.env.VITE_REALTIME_ENABLED !== 'false',
  updatePeriodMs: Number(import.meta.env.VITE_REALTIME_UPDATE_PERIOD_MS ?? 100),
  presencePeriodMs: Number(
    import.meta.env.VITE_REALTIME_PRESENCE_PERIOD_MS ?? 100,
  ),
})
