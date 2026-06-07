import type { Plugin } from '@opencode-ai/plugin'
import { resolveConfig, type InterruptConfig } from './config.js'
import {
  getSessionState,
  updateSessionState,
  clearSessionState,
} from './store.js'
import { detectInterruption, buildInterruptionContext } from './detector.js'

export const InterruptPlugin = (userConfig: Partial<InterruptConfig> = {}): Plugin => {
  return async ({ client }) => {
    const config = resolveConfig(userConfig)

    if (config.debug) {
      console.log('[interrupt] Plugin loaded with config:', config)
    }

    // Holds the pending correction context between chat.message and
    // experimental.chat.system.transform for the same turn
    let pendingCorrection: { sessionId: string; context: string } | null = null

    return {
      // ─── HOOK 1: session lifecycle ────────────────────────────────────
      event: async ({ event }) => {
        const evt = event as any
        const sessionId = evt.properties?.info?.id

        if (evt.type === 'session.created' && sessionId) {
          getSessionState(sessionId)
          if (config.debug) {
            console.log(`[interrupt] Session created: ${sessionId}`)
          }
        }

        if (evt.type === 'session.deleted' && sessionId) {
          clearSessionState(sessionId)
        }
      },

      // ─── HOOK 2: message tracking ─────────────────────────────────────
      // Fires after each user or assistant message is added
      'chat.message': async (input, output) => {
        const sessionId = input.sessionID
        if (!sessionId) return

        const msg = output.message as any
        const role = msg.role
        const parts = output.parts

        // Track assistant responses
        if (role === 'assistant') {
          const content = extractText(parts)
          updateSessionState(sessionId, {
            lastAssistantContent: content,
            lastAssistantTimestamp: Date.now(),
            wasInterrupted: false,
            partialContentAtInterrupt: '',
          })

          if (config.debug) {
            console.log(`[interrupt] Tracked assistant response (${content.length} chars)`)
          }
          return
        }

        // Track user messages — detect interruptions
        if (role === 'user') {
          const state = getSessionState(sessionId)
          const userText = extractText(parts)
          const timeSinceResponse = Date.now() - state.lastAssistantTimestamp

          // Voice mode heuristic: spoken input arriving very shortly after
          // a long response is almost certainly an interruption — even
          // without a trigger word. This handles voice-mode timing gaps
          // where speech-opencode delivers the transcript quickly.
          if (
            config.voiceMode !== 'disabled' &&
            timeSinceResponse < 2000 &&
            state.lastAssistantContent.length >= config.minResponseLength
          ) {
            updateSessionState(sessionId, {
              wasInterrupted: true,
              partialContentAtInterrupt: state.lastAssistantContent,
              interruptTimestamp: Date.now(),
              awaitingCorrection: true,
            })

            if (config.debug) {
              console.log(`[interrupt] Voice interruption (${timeSinceResponse}ms gap) — flagged as interrupted`)
            }
          }

          const signal = detectInterruption(userText, state, config)

          if (signal.isInterruption) {
            const context = buildInterruptionContext(state, userText, signal)
            pendingCorrection = { sessionId, context }

            updateSessionState(sessionId, {
              wasInterrupted: false,
              partialContentAtInterrupt: '',
              awaitingCorrection: false,
            })

            if (config.debug) {
              console.log(`[interrupt] Correction detected (${signal.reason}) — will inject context`)
            }
          } else {
            pendingCorrection = null
          }
        }
      },

      // ─── HOOK 3: system prompt injection ──────────────────────────────
      // Fires before the model processes the turn — inject context here
      'experimental.chat.system.transform': async (input, output) => {
        if (!pendingCorrection) return

        const context = pendingCorrection.context
        if (!output.system.includes(context)) {
          output.system.push(context)
        }

        if (config.debug) {
          console.log('[interrupt] Injected context into system prompt:')
          console.log(context)
        }

        pendingCorrection = null
      },

      // ─── HOOK 4: tool abort detection ─────────────────────────────────
      // Detect Ctrl+C interruptions
      'tool.execute.before': async (input, output) => {
        const sessionId = input.sessionID
        if (!sessionId) return

        const toolName = input.tool
        const isAbort = toolName === 'abort' ||
          toolName === 'cancel' ||
          (input as any).aborted === true

        if (isAbort) {
          const state = getSessionState(sessionId)
          const partialContent = state.lastAssistantContent

          updateSessionState(sessionId, {
            wasInterrupted: true,
            partialContentAtInterrupt: partialContent,
            interruptTimestamp: Date.now(),
            awaitingCorrection: true,
          })

          if (config.debug) {
            console.log('[interrupt] Ctrl+C detected — captured partial response')
            console.log(`[interrupt] Partial content: "${partialContent.slice(0, 100)}..."`)
          }
        }
      },
    }
  }
}

function extractText(parts: any[]): string {
  try {
    if (!Array.isArray(parts)) return ''
    return parts
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text || '')
      .join(' ')
  } catch {
    return ''
  }
}

export default InterruptPlugin()
export { InterruptPlugin as Interrupt }
