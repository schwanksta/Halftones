import { useCallback, useRef } from 'react'
import { SourceImage } from '../types'

interface Props {
  onImageLoad: (image: SourceImage) => void
}

export function ImageLoader({ onImageLoad }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return

    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)

      onImageLoad({
        imageData,
        width: canvas.width,
        height: canvas.height,
        fileName: file.name,
      })
    }

    img.src = url
  }, [onImageLoad])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadFile(file)
  }

  return (
    <>
      <button onClick={() => inputRef.current?.click()}>
        Open Image
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </>
  )
}
