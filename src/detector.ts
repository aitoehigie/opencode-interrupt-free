import type { InterruptConfig } from './config.js'
import type { SessionState } from './store.js'
import { CORE_CORRECTION_TRIGGERS } from './store.js'

export interface InterruptionSignal {
  isInterruption: boolean
  confidence: 'high' | 'medium' | 'low'
  reason: string
  triggerWord?: string
}

export function detectInterruption(
  userMessage: string,
  sessionState: SessionState,
  config: InterruptConfig
): InterruptionSignal {
  const now = Date.now()
  const text = userMessage.trim()
  const textLower = text.toLowerCase()

  if (!sessionState.lastAssistantTimestamp) {
    return { isInterruption: false, confidence: 'low', reason: 'no prior response' }
  }

  if (text.length > config.maxCorrectionLength) {
    return { isInterruption: false, confidence: 'low', reason: 'message too long to be correction' }
  }

  if (sessionState.lastAssistantContent.length < config.minResponseLength) {
    return { isInterruption: false, confidence: 'low', reason: 'prior response too short' }
  }

  const allTriggers = [
    ...CORE_CORRECTION_TRIGGERS,
    ...config.correctionTriggers.map(t => t.toLowerCase()),
  ]

  const timeSinceResponse = now - sessionState.lastAssistantTimestamp
  const isWithinWindow = timeSinceResponse <= config.timingWindowMs

  if (sessionState.wasInterrupted) {
    const triggerFound = allTriggers.find(t => textLower.startsWith(t) || textLower.includes(t))
    return {
      isInterruption: true,
      confidence: 'high',
      reason: 'explicit ctrl+c interruption followed by short message',
      triggerWord: triggerFound,
    }
  }

  const triggerFound = allTriggers.find(
    t => textLower.startsWith(t) || textLower === t.replace(',', '').trim()
  )

  if (triggerFound && isWithinWindow) {
    return {
      isInterruption: true,
      confidence: 'high',
      reason: `correction trigger "${triggerFound}" within timing window`,
      triggerWord: triggerFound,
    }
  }

  if (triggerFound && !isWithinWindow) {
    return {
      isInterruption: true,
      confidence: 'medium',
      reason: `correction trigger "${triggerFound}" outside timing window`,
      triggerWord: triggerFound,
    }
  }

  if (isWithinWindow && text.length < 40) {
    return {
      isInterruption: true,
      confidence: 'medium',
      reason: 'very short message within timing window',
    }
  }

  return {
    isInterruption: false,
    confidence: 'low',
    reason: 'no interruption signals detected',
  }
}

export function buildInterruptionContext(
  sessionState: SessionState,
  userCorrection: string,
  signal: InterruptionSignal
): string {
  const wasExplicit = sessionState.wasInterrupted
  const partialResponse = sessionState.partialContentAtInterrupt
    || sessionState.lastAssistantContent.slice(0, 300)

  const truncated = partialResponse.length > 300
    ? partialResponse.slice(0, 300) + '...[response cut off]'
    : partialResponse

  const confidenceNote = signal.confidence === 'medium'
    ? ' (detected with medium confidence — treat as probable correction)'
    : ''

  return `
---INTERRUPTION CONTEXT${confidenceNote}---
The user ${wasExplicit ? 'explicitly stopped (Ctrl+C)' : 'quickly corrected'} your previous response.

You were in the middle of saying:
"${truncated}"

The user's correction is:
"${userCorrection}"

Instructions:
1. Acknowledge the correction briefly and directly — do not re-explain what you were saying
2. Pivot immediately to what the user actually wants
3. Do NOT re-output the interrupted content unless specifically asked
4. Treat the correction as the highest-priority signal in this turn
---END INTERRUPTION CONTEXT---
`.trim()
}
