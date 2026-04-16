import { useState, useCallback, useRef, useEffect } from 'react'

export interface Viewport {
  /** Screen pixels per output pixel. zoom=1 → 1:1 with output DPI. */
  zoom: number
  /** Top-left corner of the visible region, in output-pixel coordinates. */
  panX: number
  panY: number
}

export function useCanvasTransform(
  containerRef: React.RefObject<HTMLElement | null>,
  outputWidth: number,
  outputHeight: number,
) {
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 })
  const isPanning = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  /** Fit the full output image in the container, centered. */
  const fitToView = useCallback(() => {
    const container = containerRef.current
    if (!container || outputWidth <= 0 || outputHeight <= 0) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    const zoom = Math.min(cw / outputWidth, ch / outputHeight)
    const panX = -(cw / zoom - outputWidth) / 2
    const panY = -(ch / zoom - outputHeight) / 2
    setViewport({ zoom, panX, panY })
  }, [containerRef, outputWidth, outputHeight])

  /** Snap to a specific zoom level, keeping the current canvas center fixed. */
  const zoomTo = useCallback((targetZoom: number) => {
    const container = containerRef.current
    if (!container) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    setViewport((prev) => {
      const centerOutX = prev.panX + cw / prev.zoom / 2
      const centerOutY = prev.panY + ch / prev.zoom / 2
      return {
        zoom: targetZoom,
        panX: centerOutX - cw / targetZoom / 2,
        panY: centerOutY - ch / targetZoom / 2,
      }
    })
  }, [containerRef])

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const mouseScreenX = e.clientX - rect.left
    const mouseScreenY = e.clientY - rect.top

    setViewport((prev) => {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const newZoom = Math.max(0.02, Math.min(16, prev.zoom * factor))

      // Keep the output-space point under the mouse fixed
      const mouseOutX = prev.panX + mouseScreenX / prev.zoom
      const mouseOutY = prev.panY + mouseScreenY / prev.zoom

      return {
        zoom: newZoom,
        panX: mouseOutX - mouseScreenX / newZoom,
        panY: mouseOutY - mouseScreenY / newZoom,
      }
    })
  }, [containerRef])

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return
    // Don't start pan if the click landed on a crop handle
    if ((e.target as Element).closest?.('[data-crop-handle]')) return
    isPanning.current = true
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isPanning.current) return
    const dx = e.clientX - lastMouse.current.x
    const dy = e.clientY - lastMouse.current.y
    lastMouse.current = { x: e.clientX, y: e.clientY }

    setViewport((prev) => ({
      ...prev,
      panX: prev.panX - dx / prev.zoom,
      panY: prev.panY - dy / prev.zoom,
    }))
  }, [])

  const handleMouseUp = useCallback(() => { isPanning.current = false }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.addEventListener('wheel', handleWheel, { passive: false })
    container.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [containerRef, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp])

  return { viewport, setViewport, fitToView, zoomTo }
}
