/** Shrink a photo to at most maxPx on its long side and re-encode as JPEG (S23 Ultra photos are ~12–50 MP). */
export async function downscaleImage(file: Blob, maxPx = 1200, quality = 0.82): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode image'))), 'image/jpeg', quality))
}
