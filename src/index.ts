import type { Plugin } from '@opencode-ai/plugin'
import { resolveConfig, SENSITIVITY_PRESETS, type InterruptConfig } from './config.js'
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

    function handleSlashCommand(
      text: string,
      cfg: InterruptConfig,
      respond: (msg: string) => void
    ): boolean {
      const trimmed = text.trim()
      if (!trimmed.startsWith('/interrupt')) return false

      const args = trimmed.slice('/interrupt'.length).trim()
      const cmd = args.split(/\s+/)[0]?.toLowerCase() || ''
      const val = args.slice(cmd.length).trim()

      switch (cmd) {
        case '': {
          respond(
            `Sensitivity: ${cfg.sensitivity} | Timing: ${cfg.timingWindowMs}ms | ` +
            `Max correction: ${cfg.maxCorrectionLength} chars | ` +
            `Min response: ${cfg.minResponseLength} chars | ` +
            `Voice mode: ${cfg.voiceMode} | Debug: ${cfg.debug} | ` +
            `Triggers: ${cfg.correctionTriggers.join(', ') || '(defaults)'}`
          )
          return true
        }
        case 'sensitivity': {
          const valid = ['low', 'medium', 'high']
          if (val && valid.includes(val)) {
            cfg.sensitivity = val as 'low' | 'medium' | 'high'
            const p = SENSITIVITY_PRESETS[cfg.sensitivity]
            cfg.timingWindowMs = p.timingWindowMs
            cfg.maxCorrectionLength = p.maxCorrectionLength
            cfg.minResponseLength = p.minResponseLength
            respond(`Sensitivity set to ${val}. Timing: ${p.timingWindowMs}ms, max correction: ${p.maxCorrectionLength} chars.`)
          } else {
            respond(`Sensitivity: ${cfg.sensitivity}. Valid values: ${valid.join(', ')}`)
          }
          return true
        }
        case 'debug': {
          cfg.debug = val === 'on' || val === 'true'
          respond(`Debug ${cfg.debug ? 'enabled' : 'disabled'}`)
          return true
        }
        case 'triggers': {
          if (val) {
            cfg.correctionTriggers = val.split(',').map(t => t.trim()).filter(Boolean)
            respond(`Trigger words set: ${cfg.correctionTriggers.join(', ')}`)
          } else {
            respond(`Current triggers: ${cfg.correctionTriggers.join(', ') || '(defaults: wait, actually, no, hold on, scratch, nevermind, instead)'}`)
          }
          return true
        }
        case 'timing': {
          const ms = parseInt(val)
          if (!isNaN(ms) && ms >= 1000 && ms <= 10000) {
            cfg.timingWindowMs = ms
            respond(`Timing window set to ${ms}ms`)
          } else {
            respond(`Timing window must be 1000–10000ms (current: ${cfg.timingWindowMs}ms)`)
          }
          return true
        }
        case 'voice': {
          const valid = ['auto', 'enabled', 'disabled']
          if (val && valid.includes(val)) {
            cfg.voiceMode = val as 'auto' | 'enabled' | 'disabled'
            respond(`Voice mode set to ${val}`)
          } else {
            respond(`Voice mode: ${cfg.voiceMode}. Valid values: ${valid.join(', ')}`)
          }
          return true
        }
        default:
          respond(`Unknown: /interrupt ${cmd}. Commands: sensitivity, debug, triggers, timing, voice`)
          return true
      }
    }

    // Holds the pending correction context between chat.message and
    // experimental.chat.system.transform for the same turn
    let pendingCorrection: { sessionId: string; context: string } | null = null

    function injectResponse(text: string) {
      pendingCorrection = { sessionId: '', context: text }
      if (config.debug) console.log(`[interrupt] /interrupt: ${text}`)
    }

    let activeSessionId: string | null = null

    // SIGINT: first press = abort, second press within 2s = exit
    let lastSIGINT = 0
    let sigintRegistered = false
    if (!sigintRegistered) {
      sigintRegistered = true
      process.on('SIGINT', () => {
        const now = Date.now()
        if (lastSIGINT && now - lastSIGINT < 2000) {
          if (config.debug) console.log('[interrupt] SIGINT — double tap, exiting')
          process.exit(0)
        }
        lastSIGINT = now
        if (activeSessionId) {
          const state = getSessionState(activeSessionId)
          updateSessionState(activeSessionId, {
            wasInterrupted: true,
            partialContentAtInterrupt: state.lastAssistantContent,
            interruptTimestamp: now,
            awaitingCorrection: true,
          })
          if (config.debug) {
            console.log('[interrupt] SIGINT — abort (press again within 2s to exit)')
          }
        }
      })
    }

    return {
      // ─── HOOK 1: session lifecycle ────────────────────────────────────
      event: async ({ event }) => {
        const evt = event as any
        const sessionId = evt.properties?.info?.id

        if (evt.type === 'session.created' && sessionId) {
          activeSessionId = sessionId
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

          // Check for /interrupt slash command first
          if (handleSlashCommand(userText, config, injectResponse)) {
            pendingCorrection!.sessionId = sessionId
            return
          }

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
