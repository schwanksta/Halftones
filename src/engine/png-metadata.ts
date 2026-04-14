/**
 * Insert or replace the pHYs chunk in a PNG blob to set DPI metadata.
 * pHYs chunk specifies pixels per unit (meter).
 */
export async function setPngDpi(blob: Blob, dpi: number): Promise<Blob> {
  const buffer = await blob.arrayBuffer()
  const data = new Uint8Array(buffer)

  // PNG signature: 8 bytes
  // Then chunks: [4-byte length][4-byte type][data][4-byte CRC]

  // Find the position just before the first IDAT chunk to insert pHYs
  let insertPos = 8 // after PNG signature
  let foundPhys = false

  while (insertPos < data.length) {
    const length = readUint32(data, insertPos)
    const type = String.fromCharCode(data[insertPos + 4], data[insertPos + 5], data[insertPos + 6], data[insertPos + 7])

    if (type === 'pHYs') {
      foundPhys = true
      // Overwrite existing pHYs data
      const ppm = Math.round(dpi * 39.3701)
      writeUint32(data, insertPos + 8, ppm)      // X pixels per unit
      writeUint32(data, insertPos + 12, ppm)     // Y pixels per unit
      data[insertPos + 16] = 1                    // Unit = meter
      // Recompute CRC
      const crc = crc32(data, insertPos + 4, 4 + 9)
      writeUint32(data, insertPos + 17, crc)
      return new Blob([data], { type: 'image/png' })
    }

    if (type === 'IDAT') {
      break
    }

    insertPos += 12 + length // 4 len + 4 type + data + 4 crc
  }

  if (!foundPhys) {
    // Create a pHYs chunk and insert before IDAT
    const ppm = Math.round(dpi * 39.3701)
    // pHYs chunk: length=9, type='pHYs', 4 bytes X ppu, 4 bytes Y ppu, 1 byte unit, 4 bytes CRC
    // Total = 4 + 4 + 9 + 4 = 21 bytes
    const chunk = new Uint8Array(21)
    writeUint32(chunk, 0, 9)  // data length
    chunk[4] = 0x70; chunk[5] = 0x48; chunk[6] = 0x59; chunk[7] = 0x73 // 'pHYs'
    writeUint32(chunk, 8, ppm)   // X pixels per unit
    writeUint32(chunk, 12, ppm)  // Y pixels per unit
    chunk[16] = 1                 // unit = meter
    const crc = crc32(chunk, 4, 13) // type + data = 4 + 9 = 13 bytes
    writeUint32(chunk, 17, crc)

    const before = data.slice(0, insertPos)
    const after = data.slice(insertPos)
    return new Blob([before, chunk, after], { type: 'image/png' })
  }

  return new Blob([data], { type: 'image/png' })
}

function readUint32(data: Uint8Array, offset: number): number {
  return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
}

function writeUint32(data: Uint8Array, offset: number, value: number) {
  data[offset] = (value >>> 24) & 0xff
  data[offset + 1] = (value >>> 16) & 0xff
  data[offset + 2] = (value >>> 8) & 0xff
  data[offset + 3] = value & 0xff
}

// CRC32 lookup table
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1)
    } else {
      c = c >>> 1
    }
  }
  crcTable[n] = c
}

function crc32(data: Uint8Array, offset: number, length: number): number {
  let crc = 0xffffffff
  for (let i = offset; i < offset + length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
