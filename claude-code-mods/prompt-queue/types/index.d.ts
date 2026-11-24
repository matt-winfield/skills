export type SendMode = 'queue' | 'steer' | 'interrupt'

export type QueueItem = { id: string; text: string; isEnabled: boolean }

declare module 'claude-code' {
  interface PluginState {
    'prompt-queue': {
      items: Shaped<QueueItem[]>
      mode: SendMode | null
      editingId: string | null
      isPaused: boolean
      isPaneOpen: boolean
      stashedDraft: string | null
      interruptText: string | null
      nextId: number
    }
  }
}
