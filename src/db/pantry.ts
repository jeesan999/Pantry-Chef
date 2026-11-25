import { IntegrityError, newId, nowIso, type Repo } from './repo'
import type { InventoryLot, InventoryTransaction, InventoryTxnType, QtyUnit, WasteRecord } from './types'

const EPS = 1e-9

export interface NewLot {
  productId: string
  quantity: number
  unit: QtyUnit
  totalCostCents: number
  purchaseDate: string
  expiryDate?: string
  expiryKind?: 'use_by' | 'best_before'
  location: InventoryLot['location']
  purchaseId?: string
}

/**
 * The pantry ledger. Lots hold the current remaining quantity; every change also writes an
 * append-only transaction row, so history can be audited and undone, never erased.
 */
export class Pantry {
  private readonly repo: Repo
  constructor(repo: Repo) {
    this.repo = repo
  }

  private async writeTxn(
    lot: InventoryLot,
    type: InventoryTxnType,
    qtyDelta: number,
    extra: Partial<InventoryTransaction> = {},
  ): Promise<InventoryTransaction> {
    const remaining = lot.remaining + qtyDelta
    if (remaining < -EPS) throw new IntegrityError(`only ${lot.remaining} ${lot.unit} left in this lot`)
    if (remaining > lot.quantity + EPS) throw new IntegrityError('remaining would exceed the purchased quantity')
    await this.repo.update('inventory_lots', lot.id, { remaining: Math.max(0, remaining) })
    const txn: InventoryTransaction = { id: newId(), lotId: lot.id, type, qtyDelta, at: nowIso(), ...extra }
    await this.repo.insert('inventory_transactions', txn)
    return txn
  }

  private async lot(lotId: string): Promise<InventoryLot> {
    const lot = await this.repo.get('inventory_lots', lotId)
    if (!lot) throw new IntegrityError(`lot ${lotId} not found`)
    return lot
  }

  /** Manual pantry entry or a confirmed purchase: one lot plus its purchase transaction. */
  addLot(input: NewLot): Promise<InventoryLot> {
    if (!(input.quantity > 0)) throw new IntegrityError('quantity must be more than zero')
    if (!(input.totalCostCents >= 0)) throw new IntegrityError('cost cannot be negative')
    return this.repo.tx(async () => {
      const lot: InventoryLot = {
        id: newId(),
        productId: input.productId,
        purchaseId: input.purchaseId,
        quantity: input.quantity,
        remaining: 0,
        unit: input.unit,
        unitCostCents: input.totalCostCents / input.quantity,
        purchaseDate: input.purchaseDate,
        expiryDate: input.expiryDate,
        expiryKind: input.expiryKind,
        location: input.location,
        createdAt: nowIso(),
      }
      await this.repo.insert('inventory_lots', lot)
      await this.writeTxn(lot, 'purchase', input.quantity)
      return { ...lot, remaining: input.quantity }
    })
  }

  consume(lotId: string, qty: number, consumptionId?: string): Promise<InventoryTransaction> {
    if (!(qty > 0)) throw new IntegrityError('quantity must be more than zero')
    return this.repo.tx(async () => this.writeTxn(await this.lot(lotId), 'consume', -qty, { consumptionId }))
  }

  /** Throw away food: a discard transaction plus a waste record costed at the lot's unit cost. */
  discard(lotId: string, qty: number, reason: WasteRecord['reason'], consumptionId?: string): Promise<WasteRecord> {
    if (!(qty > 0)) throw new IntegrityError('quantity must be more than zero')
    return this.repo.tx(async () => {
      const lot = await this.lot(lotId)
      const txn = await this.writeTxn(lot, 'discard', -qty, { consumptionId })
      const waste: WasteRecord = {
        id: newId(),
        transactionId: txn.id,
        reason,
        costCents: Math.round(qty * lot.unitCostCents),
        at: txn.at,
      }
      await this.repo.insert('waste_records', waste)
      return waste
    })
  }

  /** Correct a stock count: records the difference as an adjust transaction. */
  adjust(lotId: string, newRemaining: number, note?: string): Promise<InventoryTransaction | null> {
    return this.repo.tx(async () => {
      const lot = await this.lot(lotId)
      const delta = newRemaining - lot.remaining
      if (Math.abs(delta) < EPS) return null
      return this.writeTxn(lot, 'adjust', delta, { note })
    })
  }

  /** Undo a transaction by writing its reverse. Each transaction can be undone once. */
  undo(txnId: string): Promise<InventoryTransaction> {
    return this.repo.tx(async () => {
      const db = this.repo.db
      const original = await db.inventory_transactions.get(txnId)
      if (!original) throw new IntegrityError(`transaction ${txnId} not found`)
      if (original.type === 'undo') throw new IntegrityError('an undo cannot itself be undone')
      const already = await db.inventory_transactions.where('reversesId').equals(txnId).count()
      if (already > 0) throw new IntegrityError('this transaction has already been undone')
      const lot = await this.lot(original.lotId)
      return this.writeTxn(lot, 'undo', -original.qtyDelta, { reversesId: original.id })
    })
  }

  /** Weighted average purchase cost per g/ml/unit across lots still in stock; null if none. */
  async weightedAverageCost(productId: string): Promise<number | null> {
    const lots = await this.repo.db.inventory_lots.where('productId').equals(productId).toArray()
    let qty = 0
    let cents = 0
    for (const l of lots) {
      if (l.remaining <= EPS) continue
      qty += l.remaining
      cents += l.remaining * l.unitCostCents
    }
    return qty > EPS ? cents / qty : null
  }

  /** Lots in stock, earliest expiry first (no expiry date goes last). */
  async stock(): Promise<InventoryLot[]> {
    const lots = await this.repo.db.inventory_lots.filter((l) => l.remaining > EPS).toArray()
    return lots.sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'))
  }

  /** Consume a product across its lots, earliest expiry first, in one transaction. */
  consumeProduct(productId: string, qty: number, consumptionId?: string): Promise<InventoryTransaction[]> {
    return this.repo.tx(async () => {
      const lots = (await this.stock()).filter((l) => l.productId === productId)
      const available = lots.reduce((s, l) => s + l.remaining, 0)
      if (available + EPS < qty) throw new IntegrityError(`need ${qty}, only ${available} in stock`)
      const out: InventoryTransaction[] = []
      let left = qty
      for (const l of lots) {
        if (left <= EPS) break
        const take = Math.min(left, l.remaining)
        out.push(await this.writeTxn(l, 'consume', -take, { consumptionId }))
        left -= take
      }
      return out
    })
  }
}
