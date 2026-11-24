#!/usr/bin/env node
/**
 * Copies the on-device OCR files into public/tesseract so the app serves them itself
 * (the Content Security Policy blocks any CDN). Runs before dev and build.
 *   worker.min.js                      Tesseract.js web worker
 *   tesseract-core-relaxedsimd-lstm.wasm.js   OCR engine, LSTM only, relaxed SIMD (current Chrome)
 *   tesseract-core-simd-lstm.wasm.js          same with plain SIMD (older Chrome / other browsers)
 *   eng.traineddata.gz                 English model, "best_int" (2.9 MB)
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'tesseract')
mkdirSync(out, { recursive: true })
const nm = (p) => join(root, 'node_modules', p)
const files = [
  [nm('tesseract.js/dist/worker.min.js'), 'worker.min.js'],
  [nm('tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  [nm('tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
]
for (const [src, name] of files) copyFileSync(src, join(out, name))
console.log(`OCR assets copied to public/tesseract (${files.length} files)`)
