import { useLiveQuery } from 'dexie-react-hooks'
import Fuse from 'fuse.js'
import { useMemo, useState } from 'react'
import { db, repo } from '../db/instance'
import { newId, nowIso } from '../db/repo'
import type { Food, Nutrients } from '../db/types'
import { Badge, Button, Field, Input, Notice, Select, Sheet } from './ui'

const SOURCE_TONE = { afcd: 'leaf', label: 'blue', manual: 'stone', interim: 'ember' } as const

/** Search the food list (AFCD, label and interim foods), or add a branded food from its label. */
export function FoodPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (f: Food) => void }) {
  const foods = useLiveQuery(() => db.foods.toArray())
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const fuse = useMemo(() => new Fuse(foods ?? [], { keys: ['name'], threshold: 0.4, ignoreLocation: true }), [foods])
  const results = q ? fuse.search(q, { limit: 40 }).map((r) => r.item) : (foods ?? []).slice(0, 40)
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={adding ? 'New food from label' : 'Choose a food'}>
      {adding ? (
        <LabelFoodForm initialName={q} onCancel={() => setAdding(false)} onSaved={(f) => { setAdding(false); onPick(f) }} />
      ) : (
        <>
          <Input autoFocus placeholder="Search foods, e.g. chicken breast" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search foods" />
          <ul className="mt-2 max-h-[55dvh] divide-y divide-stone-100 overflow-y-auto">
            {results.map((f) => (
              <li key={f.id}>
                <button className="flex w-full items-center justify-between gap-2 py-2.5 text-left text-sm" onClick={() => onPick(f)}>
                  <span className="text-stone-800">{f.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular text-xs text-stone-500">{Math.round(f.per100g.proteinG)} g P / 100 g</span>
                    <Badge tone={SOURCE_TONE[f.source]}>{f.source}</Badge>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="mt-3 w-full" onClick={() => setAdding(true)}>Not listed? Add a branded food from its label</Button>
        </>
      )}
    </Sheet>
  )
}

const LABEL_FIELDS: Array<[keyof Nutrients, string, string]> = [
  ['energyKj', 'Energy', 'kJ'],
  ['proteinG', 'Protein', 'g'],
  ['fatG', 'Fat, total', 'g'],
  ['satFatG', 'Saturated fat', 'g'],
  ['carbsG', 'Carbohydrate', 'g'],
  ['sugarsG', 'Sugars', 'g'],
  ['fibreG', 'Dietary fibre', 'g'],
  ['sodiumMg', 'Sodium', 'mg'],
]

/** Australian labels give a "per 100 g" column; values are typed once and reused. */
export function LabelFoodForm({ initialName = '', onSaved, onCancel }: { initialName?: string; onSaved: (f: Food) => void; onCancel: () => void }) {
  const [name, setName] = useState(initialName)
  const [state, setState] = useState<Food['state']>('na')
  const [gpu, setGpu] = useState('')
  const [vals, setVals] = useState<Record<string, string>>({})
  const [error, setError] = useState<string>()
  const save = async () => {
    const n = (k: string) => Number(vals[k] || 0)
    if (!name.trim()) return setError('Give the food a name.')
    if (!vals.energyKj) return setError('Enter energy per 100 g (kJ) from the label.')
    const per100g: Nutrients = {
      energyKj: n('energyKj'),
      energyKcal: Math.round((n('energyKj') / 4.184) * 10) / 10,
      proteinG: n('proteinG'),
      fatG: n('fatG'),
      satFatG: n('satFatG'),
      carbsG: n('carbsG'),
      sugarsG: n('sugarsG'),
      addedSugarG: 0, // not shown on Australian labels
      fibreG: n('fibreG'),
      sodiumMg: n('sodiumMg'),
    }
    const food: Food = { id: newId(), name: name.trim(), source: 'label', state, ediblePortion: 1, per100g, gramsPerUnit: gpu ? Number(gpu) : undefined, updatedAt: nowIso() }
    try {
      await repo.insert('foods', food)
      onSaved(food)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <div className="space-y-3">
      {error && <Notice tone="red">{error}</Notice>}
      <Field label="Name (include the brand)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="State">
          <Select value={state} onChange={(e) => setState(e.target.value as Food['state'])}>
            <option value="na">Ready to eat / as sold</option><option value="raw">Raw</option><option value="cooked">Cooked</option>
          </Select>
        </Field>
        <Field label="Grams per item" hint="optional, e.g. one bar"><Input inputMode="decimal" value={gpu} onChange={(e) => setGpu(e.target.value)} /></Field>
      </div>
      <p className="text-sm font-medium text-stone-700">Per 100 g column of the label</p>
      <div className="grid grid-cols-2 gap-2">
        {LABEL_FIELDS.map(([k, label, unit]) => (
          <Field key={k} label={`${label} (${unit})`}>
            <Input inputMode="decimal" value={vals[k] ?? ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
        ))}
      </div>
      <div className="flex gap-2">
        <Button onClick={save} className="flex-1">Save food</Button>
        <Button variant="secondary" onClick={onCancel}>Back</Button>
      </div>
    </div>
  )
}
