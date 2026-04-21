import { PlatformAPI } from './types'

export function createPlatform(): PlatformAPI {
  const stub = () => {
    throw new Error('Tauri platform not yet implemented — comes in Step 4')
  }

  return {
    openProjectDialog: stub,
    saveProject: stub,
    saveProjectAsDialog: stub,
    openImageDialog: stub,
    loadImageFromPath: stub,
    exportWithDialog: stub,
    exportChannelsWithDialog: stub,
    listRecent: stub,
    addRecent: stub,
    clearRecent: stub,
    setWindowTitle: stub,
    onBeforeQuit: stub,
    onMenuEvent: stub,
    onFileDropped: stub,
    getLastProjectPath: stub,
    setLastProjectPath: stub,
  }
}
