import type { Plugin } from '@opencode-ai/plugin'
import { resolveConfig, type InterruptConfig } from './config.js'
import {
  getSessionState,
  updateSessionState,
  clearSessionState,
} from './store.js'
import { prepareInjection } from './injector.js'

export const InterruptPlugin = (userConfig: Partial<InterruptConfig> = {}): Plugin => {
  return async ({ client }) => {
    const config = resolveConfig(userConfig)

    if (config.debug) {
      console.log('[interrupt] Plugin loaded with config:', config)
    }

    return {
      event: async ({ event }) => {
        const sessionId = (event as any).session_id

        if (event.type === 'session.created' && sessionId) {
          getSessionState(sessionId)
          if (config.debug) {
            console.log(`[interrupt] Session created: ${sessionId}`)
          }
        }

        if (event.type === 'session.deleted' && sessionId) {
          clearSessionState(sessionId)
        }
      },

      'chat.params': async (input, output) => {
        const sessionId = input.sessionID
        if (!sessionId) return

        const sessionState = getSessionState(sessionId)
        const userMessage = extractUserMessage(input)

        if (!userMessage) return

        const currentSystem = output.system || ''
        const { systemPrompt, result } = prepareInjection(
          userMessage,
          currentSystem,
          sessionState,
          config
        )

        if (result.injected) {
          output.system = systemPrompt

          if (config.debug) {
            console.log(`[interrupt] Injected context (${result.reason}):`)
            console.log(result.context)
          }

          updateSessionState(sessionId, {
            wasInterrupted: false,
            partialContentAtInterrupt: '',
            awaitingCorrection: false,
          })
        }
      },

      'chat.message': async (input, output) => {
        const sessionId = (input as any).sessionID || (output as any).sessionID
        if (!sessionId) return

        if (output.role === 'assistant') {
          const content = extractAssistantContent(output)
          updateSessionState(sessionId, {
            lastAssistantContent: content,
            lastAssistantTimestamp: Date.now(),
            wasInterrupted: false,
            partialContentAtInterrupt: '',
          })

          if (config.debug) {
            console.log(`[interrupt] Tracked assistant response (${content.length} chars)`)
          }
        }

        if (output.role === 'user') {
          const state = getSessionState(sessionId)
          const content = extractUserContent(output)
          const timeSince = Date.now() - state.lastAssistantTimestamp

          if (
            config.voiceMode !== 'disabled' &&
            timeSince < 2000 &&
            state.lastAssistantContent.length > config.minResponseLength
          ) {
            updateSessionState(sessionId, {
              wasInterrupted: true,
              partialContentAtInterrupt: state.lastAssistantContent,
              awaitingCorrection: true,
            })

            if (config.debug) {
              console.log(`[interrupt] Voice interruption detected (${timeSince}ms gap)`)
            }
          }
        }
      },

      'tool.execute.before': async (input, output) => {
        const sessionId = (input as any).sessionID
        if (!sessionId) return

        const toolName = (input as any).tool?.name || ''
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
            console.log(`[interrupt] Ctrl+C detected — captured partial response`)
            console.log(`[interrupt] Partial content: "${partialContent.slice(0, 100)}..."`)
          }
        }
      },
    }
  }
}

function extractUserMessage(input: any): string {
  try {
    const messages = input.messages || []
    const lastUser = [...messages].reverse().find((m: any) => m.role === 'user')
    if (!lastUser) return ''
    const content = lastUser.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join(' ')
    }
    return ''
  } catch {
    return ''
  }
}

function extractAssistantContent(output: any): string {
  try {
    const content = output.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join(' ')
    }
    return ''
  } catch {
    return ''
  }
}

function extractUserContent(output: any): string {
  return extractAssistantContent(output)
}

export default InterruptPlugin()
export { InterruptPlugin as Interrupt }
