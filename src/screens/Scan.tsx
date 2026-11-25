import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ItemSearchSheet, type ItemChoice } from '../components/ItemSearchSheet'
import { Badge, Button, Card, Field, Input, Notice, Page, Select, cx, fmt } from '../components/ui'
import { db, pantry, repo, today } from '../db/instance'
import { newId } from '../db/repo'
import type { InventoryLot, QtyUnit } from '../db/types'
import { displayName, guessCategory, guessStorage } from '../lib/itemSearch'
import { hashBlob, prepareReceiptImage } from '../receipts/image'
import { recognise } from '../receipts/ocr'
import { parseReceipt } from '../receipts/parse'
import { tickFromReceipt } from '../lib/shopping'
import { findDuplicate, saveReceipt, toCheckedLines, type CheckedLine, type CheckedReceipt, type Duplicate, type SaveResult } from '../receipts/save'

type Stage =
  | { kind: 'start' }
  | { kind: 'reading'; step: string; fraction: number }
  | { kind: 'check'; receipt: CheckedReceipt; warnings: string[]; ocrConfidence: number }
  | { kind: 'saved'; result: SaveResult; receipt: CheckedReceipt; ticked: number }

const STEP_LABEL: Record<string, string> = {
  'loading tesseract core': 'Starting the reader',
  'initializing tesseract': 'Starting the reader',
  'loading language traineddata': 'Loading English',
  'initializing api': 'Starting the reader',
  'recognizing text': 'Reading the receipt',
}
const LOCS: InventoryLot['location'][] = ['fridge', 'freezer', 'pantry']

export default function ScanScreen() {
  const [stage, setStage] = useState<Stage>({ kind: 'start' })
  const [error, setError] = useState<string>()
  const camera = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  const start = async (file?: File) => {
    if (!file) return
    setError(undefined)
    try {
      setStage({ kind: 'reading', step: 'Cleaning up the photo', fraction: 0 })
      const imageHash = await hashBlob(file)
      const already = await repo.db.receipts.where('imageHash').equals(imageHash).first()
      if (already) {
        setStage({ kind: 'start' })
        return setError(`This photo was already added: ${already.store}, ${fmt.date(already.purchasedAt)}, ${fmt.money(already.totalCents)}.`)
      }
      const { canvas, keep } = await prepareReceiptImage(file)
      const ocr = await recognise(canvas, (status, fraction) => setStage({ kind: 'reading', step: STEP_LABEL[status] ?? 'Reading the receipt', fraction: status === 'recognizing text' ? fraction : 0 }))
      const parsed = parseReceipt(ocr.lines)
      const lines = await toCheckedLines(repo, parsed, await db.foods.toArray())
      setStage({
        kind: 'check',
        ocrConfidence: ocr.confidence,
        warnings: parsed.warnings,
        receipt: { store: parsed.store ?? '', date: parsed.date ?? today(), totalCents: parsed.totalCents ?? lines.reduce((s, l) => s + l.priceCents - l.discountCents, 0), imageHash, image: keep, lines },
      })
    } catch (e) {
      setStage({ kind: 'start' })
      setError(`The receipt could not be read: ${(e as Error).message}. Try again in good light, or type the items in.`)
    }
  }

  return (
    <Page title="Scan Receipt" subtitle="Read on your phone; nothing is uploaded.">
      {error && <Notice tone="red">{error}</Notice>}
      {stage.kind === 'start' && (
        <>
          <Card>
            <div className="grid gap-2">
              <Button onClick={() => camera.current?.click()} className="min-h-14 text-base">Take a photo of a receipt</Button>
              <Button variant="secondary" onClick={() => picker.current?.click()}>Choose a photo</Button>
              <Link to="/pantry?add=1" className="block"><Button variant="ghost" className="w-full">Type the items in instead</Button></Link>
            </div>
            <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo" onChange={(e) => start(e.target.files?.[0])} />
            <input ref={picker} type="file" accept="image/*" className="sr-only" aria-label="Choose a receipt photo" onChange={(e) => start(e.target.files?.[0])} />
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-stone-600">
              <li>Lay the receipt flat, in good light, filling the frame.</li>
              <li>Long receipt? Fold it so it fits, or scan the top and add the rest with “Add a line the scan missed”.</li>
              <li>You check every line before anything is saved.</li>
            </ul>
          </Card>
          <SavedReceipts />
        </>
      )}
      {stage.kind === 'reading' && (
        <Card>
          <p className="font-medium text-stone-800">{stage.step}…</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-valuenow={Math.round(stage.fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-2 rounded-full bg-leaf-600 transition-all" style={{ width: `${Math.max(4, stage.fraction * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-stone-500">Usually 5–20 seconds. Stays on your phone.</p>
        </Card>
      )}
      {stage.kind === 'check' && (
        <CheckReceipt
          initial={stage.receipt}
          warnings={stage.warnings}
          ocrConfidence={stage.ocrConfidence}
          onCancel={() => setStage({ kind: 'start' })}
          onSaved={async (result, receipt) => setStage({ kind: 'saved', result, receipt, ticked: await tickFromReceipt(repo, result.receiptId).catch(() => 0) })}
        />
      )}
      {stage.kind === 'saved' && (
        <Card title="Saved">
          <p className="text-stone-700">
            {stage.result.pantryLines} item{stage.result.pantryLines === 1 ? '' : 's'} added to your pantry from {stage.receipt.store}, {fmt.date(stage.receipt.date)}.
          </p>
          <p className="tabular mt-1 text-sm text-stone-600">
            Groceries {fmt.money(stage.result.groceriesCents)}{stage.result.householdCents ? ` · household ${fmt.money(stage.result.householdCents)}` : ''}
            {stage.result.newProducts ? ` · ${stage.result.newProducts} new item${stage.result.newProducts === 1 ? '' : 's'} remembered for next time` : ''}
          </p>
          {stage.ticked > 0 && (
            <p className="mt-1 text-sm text-leaf-700">
              Ticked {stage.ticked} item{stage.ticked === 1 ? '' : 's'} on your <Link to="/shopping" className="font-medium underline">shopping list</Link>.
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link to="/pantry"><Button className="w-full">Cook from your pantry</Button></Link>
            <Button variant="secondary" onClick={() => setStage({ kind: 'start' })}>Scan another</Button>
          </div>
        </Card>
      )}
    </Page>
  )
}

function CheckReceipt({ initial, warnings, ocrConfidence, onCancel, onSaved }: {
  initial: CheckedReceipt; warnings: string[]; ocrConfidence: number; onCancel: () => void; onSaved: (r: SaveResult, rc: CheckedReceipt) => void
}) {
  const [r, setR] = useState(initial)
  const [error, setError] = useState<string>()
  const [dup, setDup] = useState<Duplicate | null>(null)
  const [searching, setSearching] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const products = useLiveQuery(() => db.products.toArray())
  const foods = useLiveQuery(() => db.foods.toArray())
  const pname = useMemo(() => new Map((products ?? []).map((p) => [p.id, p.name])), [products])
  const fname = useMemo(() => new Map((foods ?? []).map((f) => [f.id, f.name])), [foods])

  const setLine = (key: string, patch: Partial<CheckedLine>) => setR((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }))
  const sum = r.lines.reduce((s, l) => s + l.priceCents - l.discountCents, 0)
  const matches = Math.abs(sum - r.totalCents) <= 1
  const food = r.lines.filter((l) => l.include)

  const save = async (allowSameTotal = false) => {
    setError(undefined)
    setBusy(true)
    try {
      if (!allowSameTotal) {
        const d = await findDuplicate(repo, r)
        if (d) {
          setDup(d)
          if (d.kind === 'same-shop') return
        }
      }
      const result = await saveReceipt(repo, pantry, { ...r, allowSameTotal })
      onSaved(result, r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pick = (key: string, c: ItemChoice) => {
    const l = r.lines.find((x) => x.key === key)!
    if (c.kind === 'product') setLine(key, { productId: c.product.id, foodId: c.product.foodId, name: c.product.name, matchedBy: 'picked', category: c.product.category, storage: c.product.storage, include: true })
    else if (c.kind === 'food') {
      const cat = guessCategory(c.food.name)
      setLine(key, { productId: undefined, foodId: c.food.id, name: l.matchedBy === 'none' ? c.label : l.name, matchedBy: 'picked', category: cat, storage: guessStorage(cat, c.food.name), include: true })
    } else setLine(key, { productId: undefined, foodId: undefined, matchedBy: 'none' })
    setSearching(null)
  }

  return (
    <>
      <Card title="Check the receipt" action={<Badge tone={ocrConfidence >= 80 ? 'leaf' : 'ember'}>read {Math.round(ocrConfidence)}%</Badge>}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Store"><Input value={r.store} onChange={(e) => setR({ ...r, store: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={r.date} max={today()} onChange={(e) => setR({ ...r, date: e.target.value })} /></Field>
          <Field label="Receipt total ($)">
            <Input inputMode="decimal" defaultValue={(r.totalCents / 100).toFixed(2)} onBlur={(e) => setR({ ...r, totalCents: Math.round(Number(e.target.value || 0) * 100) })} />
          </Field>
          <div className={cx('flex flex-col justify-end rounded-xl px-3 py-2 text-sm', matches ? 'bg-leaf-50 text-leaf-900' : 'bg-orange-50 text-orange-900')}>
            <span className="text-xs">Lines add up to</span>
            <span className="tabular font-semibold">{fmt.money(sum)} {matches ? '✓' : `(${sum > r.totalCents ? '+' : '−'}${fmt.money(Math.abs(sum - r.totalCents))})`}</span>
          </div>
        </div>
        {warnings.length > 0 && <ul className="mt-3 space-y-1.5">{warnings.map((w) => <li key={w}><Notice>{w}</Notice></li>)}</ul>}
        <p className="mt-3 text-xs text-stone-500">{food.length} food line{food.length === 1 ? '' : 's'} will go to your pantry. Lines marked orange need a look.</p>
      </Card>

      {r.lines.map((l) => {
        const review = l.confidence < 0.7 || l.notes.length > 0
        return (
          <section key={l.key} className={cx('rounded-2xl border bg-white p-3 shadow-sm', review ? 'border-orange-300 bg-orange-50/50' : 'border-stone-200', !l.include && 'opacity-75')}>
            <div className="flex items-center gap-2">
              <input type="checkbox" className="h-6 w-6 shrink-0 accent-leaf-700" checked={l.include} aria-label="Food: add to my pantry" onChange={(e) => setLine(l.key, { include: e.target.checked })} />
              <Input aria-label="Name" value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} className="min-h-10 font-medium" />
            </div>
            <p className="mt-1 truncate pl-8 text-xs text-stone-400">Receipt: {l.rawText}</p>
            {l.notes.length > 0 && <p className="pl-8 text-xs text-orange-800">{l.notes.join('; ')}</p>}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-stone-500">Price $
                <Input aria-label="Price ($)" inputMode="decimal" defaultValue={(l.priceCents / 100).toFixed(2)} onBlur={(e) => setLine(l.key, { priceCents: Math.round(Number(e.target.value || 0) * 100) })} className="min-h-10" />
              </label>
              {l.include ? (
                <>
                  <label className="text-xs text-stone-500">Kept in
                    <Select aria-label="Kept in" value={l.storage} onChange={(e) => setLine(l.key, { storage: e.target.value as InventoryLot['location'] })} className="min-h-10">{LOCS.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}</Select>
                  </label>
                  <label className="text-xs text-stone-500">Amount
                    <Input aria-label="Amount" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: Number(e.target.value) })} className="min-h-10" />
                  </label>
                  <label className="text-xs text-stone-500">Unit
                    <Select aria-label="Unit" value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value as QtyUnit })} className="min-h-10"><option value="g">grams</option><option value="ml">ml</option><option value="unit">each</option></Select>
                  </label>
                </>
              ) : (
                <p className="self-end pb-2 text-xs text-stone-500">Not food: counted as household spending</p>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              {l.include && l.matchedBy === 'remembered' && <Badge tone="leaf">remembered</Badge>}
              {l.include && l.productId && l.matchedBy === 'picked' && <Badge tone="leaf">{pname.get(l.productId)}</Badge>}
              {l.include && !l.productId && l.foodId && fname.has(l.foodId) && <Badge tone="blue">{displayName(fname.get(l.foodId)!)}</Badge>}
              {l.include && !l.productId && !l.foodId && <Badge tone="ember">no food link</Badge>}
              {l.discountCents > 0 && <Badge>−{fmt.money(l.discountCents)} off</Badge>}
              {l.include && <button className="min-h-10 px-1 font-medium text-leaf-700" onClick={() => setSearching(l.key)}>{l.productId || l.foodId ? 'Change' : 'Find it'}</button>}
              <details className="w-full">
                <summary className="min-h-10 cursor-pointer py-2 text-stone-500">More: discount, expiry, remove</summary>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Discount ($)"><Input inputMode="decimal" defaultValue={(l.discountCents / 100).toFixed(2)} onBlur={(e) => setLine(l.key, { discountCents: Math.round(Number(e.target.value || 0) * 100) })} /></Field>
                  <Field label="Expiry"><Input type="date" aria-label="Expiry" value={l.expiryDate ?? ''} min={r.date} onChange={(e) => setLine(l.key, { expiryDate: e.target.value || undefined })} /></Field>
                  <Field label="Date type"><Select value={l.expiryKind ?? 'use_by'} onChange={(e) => setLine(l.key, { expiryKind: e.target.value as 'use_by' | 'best_before' })}><option value="use_by">Use by</option><option value="best_before">Best before</option></Select></Field>
                  <Button variant="danger" className="self-end" aria-label={`Remove ${l.name}`} onClick={() => setR({ ...r, lines: r.lines.filter((x) => x.key !== l.key) })}>Remove line</Button>
                </div>
              </details>
            </div>
          </section>
        )
      })}

      <Button variant="secondary" className="w-full" onClick={() => {
        const key = newId()
        setR({ ...r, lines: [...r.lines, { key, include: true, rawText: '', name: '', priceCents: 0, discountCents: 0, quantity: 1, unit: 'unit', confidence: 1, notes: [], matchedBy: 'none', category: 'Other', storage: 'pantry' }] })
        setSearching(key)
      }}>Add a line the scan missed</Button>

      {error && <Notice tone="red">{error}</Notice>}
      {dup?.kind === 'same-shop' && (
        <Notice>
          A {dup.store} receipt for {fmt.money(dup.totalCents)} on {fmt.date(dup.date)} is already saved. If this is a different shop, save it anyway.
          <div className="mt-2"><Button variant="secondary" onClick={() => save(true)} disabled={busy}>It's a different shop: save</Button></div>
        </Notice>
      )}
      <div className="grid grid-cols-[2fr_1fr] gap-2">
        <Button onClick={() => save()} disabled={busy} className="min-h-12">Save to pantry and expenses</Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>

      {searching && (
        <ItemSearchSheet
          open
          initial={r.lines.find((l) => l.key === searching)?.name.replace(/\d+(\.\d+)?\s*(kg|g|ml|l|pk)\b/gi, '').trim() ?? ''}
          onClose={() => setSearching(null)}
          onPick={(c) => {
            const l = r.lines.find((x) => x.key === searching)!
            if (!l.rawText && c.kind !== 'none') setLine(searching, { rawText: c.kind === 'product' ? c.product.name : c.label })
            pick(searching, c)
          }}
        />
      )}
    </>
  )
}

function SavedReceipts() {
  const list = useLiveQuery(() => db.receipts.orderBy('purchasedAt').reverse().limit(10).toArray())
  const counts = useLiveQuery(async () => {
    const items = await db.receipt_items.toArray()
    const m = new Map<string, number>()
    for (const i of items) m.set(i.receiptId, (m.get(i.receiptId) ?? 0) + 1)
    return m
  })
  if (!list?.length) return null
  return (
    <Card title="Recent receipts">
      <ul className="tabular divide-y divide-stone-100 text-sm">
        {list.map((r) => (
          <li key={r.id} className="flex justify-between py-2">
            <span>{r.store} · {fmt.date(r.purchasedAt)}</span>
            <span className="text-stone-600">{counts?.get(r.id) ?? 0} lines · {fmt.money(r.totalCents)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
