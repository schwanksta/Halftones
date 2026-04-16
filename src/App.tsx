import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import './App.css'
import { TopBar } from './components/TopBar'
import { ControlPanel } from './components/ControlPanel'
import { PreviewCanvas } from './components/PreviewCanvas'
import { ExportBar } from './components/ExportBar'
import { useProjectPersistence } from './hooks/useProjectPersistence'
import { applyTransforms } from './engine/transform'
import {
  SourceImage,
  HalftoneSettings,
  CMYKSettings,
  OutputSettings,
  ImageTransformSettings,
  SpotSettings,
  ChannelView,
  DEFAULT_HALFTONE_SETTINGS,
  DEFAULT_CMYK_SETTINGS,
  DEFAULT_SPOT_SETTINGS,
  DEFAULT_OUTPUT_SETTINGS,
  DEFAULT_TRANSFORM_SETTINGS,
} from './types'

const AUTO_SAVE_DELAY = 1000 // ms

function App() {
  const [projectName, setProjectName] = useState('untitled')
  const [source, setSource] = useState<SourceImage | null>(null)
  const [halftoneSettings, setHalftoneSettings] = useState<HalftoneSettings>(DEFAULT_HALFTONE_SETTINGS)
  const [cmykSettings, setCmykSettings] = useState<CMYKSettings>(DEFAULT_CMYK_SETTINGS)
  const [spotSettings, setSpotSettings] = useState<SpotSettings>(DEFAULT_SPOT_SETTINGS)
  const [outputSettings, setOutputSettings] = useState<OutputSettings>(DEFAULT_OUTPUT_SETTINGS)
  const [transformSettings, setTransformSettings] = useState<ImageTransformSettings>(DEFAULT_TRANSFORM_SETTINGS)
  const [channelView, setChannelView] = useState<ChannelView>('composite')

  const { save, load, remove, projectNames, lastProjectName } = useProjectPersistence()
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // On mount, restore the last used project
  useEffect(() => {
    const last = lastProjectName()
    if (last) {
      const snapshot = load(last)
      if (snapshot) {
        setProjectName(last)
        setHalftoneSettings(snapshot.halftoneSettings)
        setCmykSettings(snapshot.cmykSettings)
        setSpotSettings(snapshot.spotSettings ?? DEFAULT_SPOT_SETTINGS)
        setOutputSettings(snapshot.outputSettings)
        setTransformSettings(snapshot.transformSettings)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-save whenever settings change
  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      save(projectName, { halftoneSettings, cmykSettings, spotSettings, outputSettings, transformSettings })
    }, AUTO_SAVE_DELAY)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [projectName, halftoneSettings, cmykSettings, spotSettings, outputSettings, transformSettings, save])

  const handleLoadProject = useCallback((name: string) => {
    const snapshot = load(name)
    if (!snapshot) return
    setProjectName(name)
    setHalftoneSettings(snapshot.halftoneSettings)
    setCmykSettings(snapshot.cmykSettings)
    setSpotSettings(snapshot.spotSettings ?? DEFAULT_SPOT_SETTINGS)
    setOutputSettings(snapshot.outputSettings)
    setTransformSettings(snapshot.transformSettings)
  }, [load])

  const handleDeleteProject = useCallback((name: string) => {
    remove(name)
    if (name === projectName) setProjectName('untitled')
  }, [remove, projectName])

  const handleImageLoad = useCallback((image: SourceImage) => {
    setSource(image)
    setTransformSettings(DEFAULT_TRANSFORM_SETTINGS)
    setOutputSettings((prev) => ({
      ...prev,
      // Derive native print dimensions from pixel count ÷ current DPI.
      // This ensures width/height always match the image orientation
      // (e.g., a 2625×3501 px file at 300 DPI → 8.75 × 11.67 in).
      widthInches:  Math.round(image.width  / prev.dpi * 100) / 100,
      heightInches: Math.round(image.height / prev.dpi * 100) / 100,
    }))
  }, [])

  const sourceAspect = source ? source.width / source.height : null

  // Transformed image for palette extraction — respects crop, rotation, levels
  const transformedImageData = useMemo(() => {
    if (!source) return null
    return applyTransforms(source.imageData, transformSettings)
  }, [source, transformSettings])

  return (
    <div className="app">
      <TopBar
        onImageLoad={handleImageLoad}
        fileName={source?.fileName}
        projectName={projectName}
        projectNames={projectNames}
        onProjectNameChange={setProjectName}
        onLoadProject={handleLoadProject}
        onDeleteProject={handleDeleteProject}
      >
        <ExportBar
          source={source}
          transformSettings={transformSettings}
          halftoneSettings={halftoneSettings}
          cmykSettings={cmykSettings}
          spotSettings={spotSettings}
          outputSettings={outputSettings}
          projectName={projectName}
        />
      </TopBar>
      <div className="main-area">
        <ControlPanel
          halftoneSettings={halftoneSettings}
          cmykSettings={cmykSettings}
          spotSettings={spotSettings}
          outputSettings={outputSettings}
          transformSettings={transformSettings}
          channelView={channelView}
          hasImage={source !== null}
          sourceAspect={sourceAspect}
          sourceImageData={transformedImageData}
          onHalftoneChange={setHalftoneSettings}
          onCMYKChange={setCmykSettings}
          onSpotChange={setSpotSettings}
          onOutputChange={setOutputSettings}
          onTransformChange={setTransformSettings}
          onChannelViewChange={setChannelView}
        />
        <PreviewCanvas
          source={source}
          transformSettings={transformSettings}
          halftoneSettings={halftoneSettings}
          cmykSettings={cmykSettings}
          spotSettings={spotSettings}
          channelView={channelView}
          outputSettings={outputSettings}
          onImageLoad={handleImageLoad}
          onTransformChange={setTransformSettings}
        />
      </div>
    </div>
  )
}

export default App
