export interface InterruptConfig {
  sensitivity: 'low' | 'medium' | 'high'
  timingWindowMs: number
  maxCorrectionLength: number
  minResponseLength: number
  correctionTriggers: string[]
  debug: boolean
  voiceMode: 'auto' | 'enabled' | 'disabled'
}

export const DEFAULT_CONFIG: InterruptConfig = {
  sensitivity: 'medium',
  timingWindowMs: 5000,
  maxCorrectionLength: 120,
  minResponseLength: 200,
  correctionTriggers: [],
  debug: false,
  voiceMode: 'auto',
}

export const SENSITIVITY_PRESETS = {
  low: { timingWindowMs: 3000, maxCorrectionLength: 80, minResponseLength: 400 },
  medium: { timingWindowMs: 5000, maxCorrectionLength: 120, minResponseLength: 200 },
  high: { timingWindowMs: 8000, maxCorrectionLength: 200, minResponseLength: 100 },
}

export function resolveConfig(userConfig: Partial<InterruptConfig> = {}): InterruptConfig {
  const base = { ...DEFAULT_CONFIG, ...userConfig }
  if (!userConfig.timingWindowMs || !userConfig.maxCorrectionLength) {
    const preset = SENSITIVITY_PRESETS[base.sensitivity]
    if (!userConfig.timingWindowMs) base.timingWindowMs = preset.timingWindowMs
    if (!userConfig.maxCorrectionLength) base.maxCorrectionLength = preset.maxCorrectionLength
    if (!userConfig.minResponseLength) base.minResponseLength = preset.minResponseLength
  }
  return base
}
