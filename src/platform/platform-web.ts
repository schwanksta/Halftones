import { PlatformAPI, MenuEvent } from './types'
import { ShopProfile } from '../types'

export function createPlatform(): PlatformAPI {
  return {
    async openProjectDialog() {
      throw new Error('Not available in browser preview — run with `npm run tauri:dev` for file I/O')
    },

    async saveProject(_project, _path) {
      throw new Error('Not available in browser preview — run with `npm run tauri:dev` for file I/O')
    },

    async saveProjectAsDialog(_project) {
      throw new Error('Not available in browser preview — run with `npm run tauri:dev` for file I/O')
    },

    async openImageDialog() {
      throw new Error('Not available in browser preview — run with `npm run tauri:dev` for file I/O')
    },

    async loadImageFromPath(_path) {
      throw new Error('Not available in browser preview — run with `npm run tauri:dev` for file I/O')
    },

    async loadProjectFromPath(_path) {
      throw new Error('Not available in browser preview — run with `npm run tauri:dev` for file I/O')
    },

    async exportWithDialog(blob, suggestedName, _filters) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = suggestedName
      a.click()
      URL.revokeObjectURL(url)
      return suggestedName
    },

    async exportChannelsWithDialog(files, suggestedFolder) {
      for (const file of files) {
        const url = URL.createObjectURL(file.blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
        URL.revokeObjectURL(url)
      }
      return suggestedFolder
    },

    async listRecent() {
      return []
    },

    async addRecent(_path, _name) {},

    async clearRecent() {},

    setWindowTitle(title, dirty) {
      document.title = dirty ? `${title} — Edited` : title
    },

    onBeforeQuit(_handler) {},

    onMenuEvent(_event: MenuEvent, _handler: (payload?: string) => void) {
      return () => {}
    },

    onFileDropped(_handler) {
      return () => {}
    },

    async refreshRecentMenu(_entries) {},

    async getLastProjectPath() {
      return null
    },

    async setLastProjectPath(_path) {},

    async getStartupFiles() {
      return []
    },

    async getShopProfile() {
      try {
        const raw = localStorage.getItem('halftones_shop_profile')
        return raw ? (JSON.parse(raw) as ShopProfile) : null
      } catch {
        return null
      }
    },

    async setShopProfile(profile: ShopProfile) {
      try {
        localStorage.setItem('halftones_shop_profile', JSON.stringify(profile))
      } catch (e) {
        console.warn('[halftones] Failed to persist shop profile:', e)
      }
    },
  }
}
