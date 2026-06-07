import type { InterruptConfig } from './config.js'
import type { SessionState } from './store.js'
import { detectInterruption, buildInterruptionContext } from './detector.js'

export interface InjectionResult {
  injected: boolean
  reason?: string
  context?: string
}

export function prepareInjection(
  userMessage: string,
  currentSystemPrompt: string,
  sessionState: SessionState,
  config: InterruptConfig
): { systemPrompt: string; result: InjectionResult } {
  const signal = detectInterruption(userMessage, sessionState, config)

  if (!signal.isInterruption) {
    return {
      systemPrompt: currentSystemPrompt,
      result: { injected: false, reason: signal.reason },
    }
  }

  if (signal.confidence === 'low' && !sessionState.wasInterrupted) {
    return {
      systemPrompt: currentSystemPrompt,
      result: { injected: false, reason: 'confidence too low' },
    }
  }

  const context = buildInterruptionContext(sessionState, userMessage, signal)
  const enhancedPrompt = currentSystemPrompt
    ? `${currentSystemPrompt}\n\n${context}`
    : context

  return {
    systemPrompt: enhancedPrompt,
    result: { injected: true, context, reason: signal.reason },
  }
}
