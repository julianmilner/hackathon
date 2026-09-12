import type { Viewpoint } from './viewpoints'

// What a renderer exposes to the HUD. Both renderers implement it.
export interface SceneApi {
  flyTo(viewpoint: Viewpoint, durationMs?: number): void
  jumpTo(viewpoint: Viewpoint): void
}

export type SceneApiRef = { current: SceneApi | null }

declare global {
  interface Window {
    // Debug hook used by screenshot scripts and handy in the console.
    __city?: {
      ready: boolean
      flyTo(id: string, durationMs?: number): void
      jumpTo(id: string): void
    }
    // Renderer memory and draw statistics for profiling in the console.
    __cityStats?: () => Record<string, unknown>
  }
}
