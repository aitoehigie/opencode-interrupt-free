export const CORE_CORRECTION_TRIGGERS = [
  'no,', 'no.', 'nope', 'nah',
  'wait', 'actually', 'hold on', 'stop',
  'wrong', 'incorrect', 'not quite', 'not right',
  "don't", 'instead', 'rather', 'not like that',
  "that's not", "that's wrong", 'you misunderstood',
  'i meant', 'what i meant', 'what i said',
  'forget that', 'ignore that', 'start over',
  'let me rephrase', 'let me clarify',
]

export interface SessionState {
  lastAssistantContent: string
  lastAssistantTimestamp: number
  wasInterrupted: boolean
  partialContentAtInterrupt: string
  interruptTimestamp: number
  awaitingCorrection: boolean
}

export function createSessionState(): SessionState {
  return {
    lastAssistantContent: '',
    lastAssistantTimestamp: 0,
    wasInterrupted: false,
    partialContentAtInterrupt: '',
    interruptTimestamp: 0,
    awaitingCorrection: false,
  }
}

export const sessionStore = new Map<string, SessionState>()

export function getSessionState(sessionId: string): SessionState {
  if (!sessionStore.has(sessionId)) {
    sessionStore.set(sessionId, createSessionState())
  }
  return sessionStore.get(sessionId)!
}

export function updateSessionState(sessionId: string, updates: Partial<SessionState>): void {
  const current = getSessionState(sessionId)
  sessionStore.set(sessionId, { ...current, ...updates })
}

export function clearSessionState(sessionId: string): void {
  sessionStore.delete(sessionId)
}
