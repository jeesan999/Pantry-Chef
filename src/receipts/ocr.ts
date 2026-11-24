/**
 * On-device OCR with Tesseract.js. Everything (worker, engine, English model) is served by
 * the app itself from /tesseract/, so it works offline and nothing leaves the phone.
 * Loaded only when a receipt is scanned.
 */

export interface OcrLine {
  text: string
  confidence: number // 0..100
}

export interface OcrResult {
  text: string
  lines: OcrLine[]
  confidence: number
}

export type OcrProgress = (stage: string, fraction: number) => void

export async function recognise(image: HTMLCanvasElement | Blob, onProgress?: OcrProgress): Promise<OcrResult> {
  const { createWorker, OEM, PSM } = await import('tesseract.js')
  const base = `${import.meta.env.BASE_URL}tesseract/`
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base,
    workerBlobURL: false, // load the worker from our own origin (CSP)
    cacheMethod: 'none', // the service worker already keeps the model offline
    logger: (m: { status: string; progress: number }) => onProgress?.(m.status, m.progress),
  })
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK, // a receipt is one column of lines
      preserve_interword_spaces: '1', // keeps the gap between name and price
    })
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
    const lines: OcrLine[] = []
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) lines.push({ text: l.text.replace(/\n$/, ''), confidence: l.confidence })
    if (lines.length === 0) for (const t of data.text.split('\n')) if (t.trim()) lines.push({ text: t, confidence: data.confidence })
    return { text: data.text, lines, confidence: data.confidence }
  } finally {
    await worker.terminate()
  }
}
