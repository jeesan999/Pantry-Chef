/**
 * Receipt photo clean-up before OCR. Pure functions on RGBA pixel arrays (testable without a
 * browser), plus a browser wrapper that loads, rotates (EXIF), scales and cleans a photo.
 */

export interface Pixels {
  data: Uint8ClampedArray // RGBA
  width: number
  height: number
}

/** Luminance (Rec. 601) into all three channels. */
export function toGrey(p: Pixels): Pixels {
  const d = new Uint8ClampedArray(p.data)
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    d[i] = d[i + 1] = d[i + 2] = y
  }
  return { ...p, data: d }
}

/** Stretch contrast so the 2nd percentile becomes black and the 98th white: fixes grey, faded paper. */
export function stretchContrast(p: Pixels, lowPct = 2, highPct = 98): Pixels {
  const hist = new Array(256).fill(0)
  const n = p.width * p.height
  for (let i = 0; i < p.data.length; i += 4) hist[p.data[i]]++
  const find = (pct: number) => {
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]
      if (acc >= (n * pct) / 100) return v
    }
    return 255
  }
  const lo = find(lowPct)
  const hi = Math.max(lo + 1, find(highPct))
  const d = new Uint8ClampedArray(p.data)
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - lo) * 255) / (hi - lo)
    d[i] = d[i + 1] = d[i + 2] = v
  }
  return { ...p, data: d }
}

/** Separable running maximum over a (2r+1) window: removes dark text, leaving the paper. */
function maxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, src[y * w + k])
      tmp[y * w + x] = m
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x])
      out[y * w + x] = m
    }
  }
  return out
}

/** Box blur via an integral image. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const I = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += src[y * w + x]
      I[(y + 1) * (w + 1) + (x + 1)] = I[y * (w + 1) + (x + 1)] + row
    }
  }
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1)
      const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0))
    }
  }
  return out
}

/**
 * Even out the lighting (shadows, a lamp on one side): estimate the paper brightness everywhere
 * (max filter to drop the text, then blur) and divide it out. Works on a grey image.
 */
export function flattenLighting(p: Pixels): Pixels {
  const { width: w, height: h } = p
  // work at quarter size for speed: the background changes slowly
  const s = 4
  const sw = Math.max(1, Math.floor(w / s)), sh = Math.max(1, Math.floor(h / s))
  const small = new Float32Array(sw * sh)
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) small[y * sw + x] = p.data[((y * s) * w + x * s) * 4]
  const r = Math.max(3, Math.round(Math.min(sw, sh) / 40))
  const bg = boxBlur(maxFilter(small, sw, sh, r), sw, sh, r * 2)
  const d = new Uint8ClampedArray(p.data)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.floor(y / s))
    for (let x = 0; x < w; x++) {
      const b = Math.max(1, bg[sy * sw + Math.min(sw - 1, Math.floor(x / s))])
      const i = (y * w + x) * 4
      const v = (d[i] / b) * 245
      d[i] = d[i + 1] = d[i + 2] = v
    }
  }
  return { ...p, data: d }
}

/** Light unsharp mask (3x3) to crispen thermal-printer text. */
export function sharpen(p: Pixels, amount = 0.6): Pixels {
  const { width: w, height: h } = p
  const src = p.data
  const d = new Uint8ClampedArray(src)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += src[((y + dy) * w + (x + dx)) * 4]
      const blur = sum / 9
      const v = src[i] + amount * (src[i] - blur)
      d[i] = d[i + 1] = d[i + 2] = v
    }
  }
  return { ...p, data: d }
}

/** Otsu's threshold on a grey image (used to judge whether a photo has enough contrast). */
export function otsu(p: Pixels): number {
  const hist = new Array(256).fill(0)
  for (let i = 0; i < p.data.length; i += 4) hist[p.data[i]]++
  const total = p.width * p.height
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

export function cleanPixels(p: Pixels): Pixels {
  return sharpen(stretchContrast(flattenLighting(toGrey(p))))
}

/** SHA-256 of the file's bytes: the same photo picked twice gives the same hash. */
export async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Browser only: load a photo (EXIF rotation applied), scale its long side to at most maxPx
 * (S23 Ultra photos are up to 200 MP), clean it, and return a canvas for OCR plus a small
 * JPEG to keep with the receipt.
 */
export async function prepareReceiptImage(file: Blob, maxPx = 2000): Promise<{ canvas: HTMLCanvasElement; keep: Blob }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const img = ctx.getImageData(0, 0, w, h)
  const cleaned = cleanPixels({ data: img.data, width: w, height: h })
  ctx.putImageData(new ImageData(cleaned.data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
  const keep = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('could not encode image'))), 'image/jpeg', 0.7))
  return { canvas, keep }
}
