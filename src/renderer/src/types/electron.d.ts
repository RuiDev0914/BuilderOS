import type { DevLaunchPadApi } from '../../../preload'

declare global {
  interface Window {
    devLaunchPad?: DevLaunchPadApi
  }
}

export {}
