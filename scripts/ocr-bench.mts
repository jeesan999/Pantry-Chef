/**
 * OCR accuracy check (Node): reads the rendered test receipts with the same engine, model and
 * settings as the app, parses them, and compares with the hand-checked expected items.
 *   node scripts/ocr-bench.mts <dir with name.jpg> <langPath>
 */
import { createWorker, OEM, PSM } from 'tesseract.js'
import { readFileSync } from 'node:fs'
import { parseReceipt } from '../src/receipts/parse.ts'
import { cleanPixels } from '../src/receipts/image.ts'
import jpeg from 'jpeg-js'

/** Same clean-up as the app, so the benchmark measures what the phone does. */
function cleaned(file: Buffer): Buffer {
  const img = jpeg.decode(file, { useTArray: true })
  const c = cleanPixels({ data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length), width: img.width, height: img.height })
  return Buffer.from(jpeg.encode({ data: c.data, width: img.width, height: img.height }, 92).data)
}
const RAW = process.env.RAW === '1'

const [dir, langPath] = process.argv.slice(2)
const names = ['woolworths', 'coles', 'aldi', 'spudshed']
const worker = await createWorker('eng', OEM.LSTM_ONLY, { langPath, cacheMethod: 'none' })
await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' })
let okItems = 0, totalItems = 0
for (const n of names) {
  const expected = parseReceipt(readFileSync(`src/receipts/fixtures/${n}.txt`, 'utf8').split('\n').map((text) => ({ text })))
  const file = readFileSync(`${dir}/${n}.jpg`)
  const { data } = await worker.recognize(RAW ? file : cleaned(file), {}, { text: true, blocks: true })
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l) => ({ text: l.text.replace(/\n$/, ''), confidence: l.confidence }))))
  if (process.env.DEBUG === n) for (const l of lines) console.log('   ', l.confidence.toFixed(0).padStart(3), '|', l.text)
  const got = parseReceipt(lines)
  let ok = 0
  for (const e of expected.items) {
    const key = (s: string) => s.toLowerCase().replace(/\W/g, '')
    const g = got.items.find((x) => key(x.name) === key(e.name)) ?? got.items.find((x) => x.priceCents === e.priceCents)
    const nameOk = g && key(g.name) === key(e.name) && g.priceCents === e.priceCents && g.discountCents === e.discountCents
    if (g && nameOk) ok++
    else console.log(`  ${n}: expected ${e.name} ${e.priceCents} → got ${g ? `${g.name} ${g.priceCents}` : 'nothing'}`)
  }
  okItems += ok; totalItems += expected.items.length
  console.log(`${n}: OCR ${data.confidence.toFixed(0)}% · items ${ok}/${expected.items.length} exact · store ${got.storeKey === expected.storeKey} · date ${got.date === expected.date} · total ${got.totalCents === expected.totalCents} · warnings ${got.warnings.length}`)
}
console.log(`ALL: ${okItems}/${totalItems} items exact (${Math.round((100 * okItems) / totalItems)}%)`)
await worker.terminate()
