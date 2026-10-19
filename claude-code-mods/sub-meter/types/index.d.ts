/** One rate-limit window of the subscription, as the last API response reported it. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** One reading of both windows at `t`: the 5-hour (`f`, its reset `fr`) and the weekly (`w`, `wr`). */
export type Sample = { t: number; f?: number; fr?: string; w?: number; wr?: string }

declare module 'claude-code' {
  interface PluginState {
    'sub-meter': { limits: Limit[]; view: number; isHovered: boolean; history: Sample[] }
  }
}
