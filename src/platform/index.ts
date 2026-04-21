import { PlatformAPI } from './types'
import { createPlatform as createWebPlatform } from './platform-web'
import { createPlatform as createTauriPlatform } from './platform-tauri'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const platform: PlatformAPI = isTauri
  ? createTauriPlatform()
  : createWebPlatform()
