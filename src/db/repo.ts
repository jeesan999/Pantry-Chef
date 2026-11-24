import { APPEND_ONLY, FOREIGN_KEYS, type ChefDB, type RecordMap, type TableName } from './schema'
import { SCHEMAS } from './validation'

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrityError'
  }
}

export const newId = (): string => crypto.randomUUID()
export const nowIso = (): string => new Date().toISOString()

type Rec = Record<string, unknown> & { id: string }

/**
 * The repository layer: the only code that writes to the database. It validates records,
 * enforces foreign keys and append-only tables, and runs multi-step changes in one
 * transaction so a failure leaves nothing half-written.
 */
export class Repo {
  readonly db: ChefDB
  constructor(db: ChefDB) {
    this.db = db
  }

  /** Run fn in a single read-write transaction over every table. */
  tx<R>(fn: () => Promise<R>): Promise<R> {
    return this.db.transaction('rw', this.db.tables, fn)
  }

  private validate(table: TableName, rec: unknown): void {
    const schema = SCHEMAS[table]
    if (!schema) return
    const r = schema.safeParse(rec)
    if (!r.success) {
      const msg = r.error.issues.map((i) => `${i.path.join('.') || table}: ${i.message}`).join('; ')
      throw new IntegrityError(`${table}: ${msg}`)
    }
  }

  private async checkRefs(table: TableName, rec: Rec): Promise<void> {
    for (const fk of FOREIGN_KEYS) {
      if (fk.table !== table) continue
      const v = rec[fk.field]
      if (v === undefined || v === null) {
        if (!fk.optional) throw new IntegrityError(`${table}.${fk.field} is required`)
        continue
      }
      const parent = await this.db[fk.ref].get(v as string)
      if (!parent) throw new IntegrityError(`${table}.${fk.field} points at missing ${fk.ref} ${String(v)}`)
    }
  }

  async get<K extends TableName>(table: K, id: string): Promise<RecordMap[K] | undefined> {
    return (await this.db[table].get(id)) as RecordMap[K] | undefined
  }

  async insert<K extends TableName>(table: K, rec: RecordMap[K]): Promise<RecordMap[K]> {
    this.validate(table, rec)
    return this.tx(async () => {
      await this.checkRefs(table, rec as unknown as Rec)
      await this.db[table].add(rec as never)
      return rec
    })
  }

  async update<K extends TableName>(table: K, id: string, patch: Partial<RecordMap[K]>): Promise<RecordMap[K]> {
    if (APPEND_ONLY.has(table)) throw new IntegrityError(`${table} is append-only`)
    return this.tx(async () => {
      const existing = await this.db[table].get(id)
      if (!existing) throw new IntegrityError(`${table} ${id} not found`)
      const merged = { ...(existing as object), ...patch, id } as RecordMap[K]
      this.validate(table, merged)
      await this.checkRefs(table, merged as unknown as Rec)
      await this.db[table].put(merged as never)
      return merged
    })
  }

  private async children(fk: (typeof FOREIGN_KEYS)[number], parentId: string): Promise<Rec[]> {
    const t = this.db[fk.table]
    const indexed = t.schema.idxByName[fk.field] !== undefined
    const rows = indexed
      ? await t.where(fk.field).equals(parentId).toArray()
      : await t.filter((r) => (r as unknown as Rec)[fk.field] === parentId).toArray()
    return rows as unknown as Rec[]
  }

  /** Delete with restrict/cascade rules. Throws if a restricting child exists anywhere in the tree. */
  async remove(table: TableName, id: string): Promise<void> {
    if (APPEND_ONLY.has(table)) throw new IntegrityError(`${table} is append-only`)
    await this.tx(async () => {
      const toDelete: Array<[TableName, string]> = []
      const visit = async (t: TableName, rid: string) => {
        toDelete.push([t, rid])
        for (const fk of FOREIGN_KEYS) {
          if (fk.ref !== t) continue
          const kids = await this.children(fk, rid)
          if (kids.length === 0) continue
          if (fk.onDelete === 'restrict') {
            throw new IntegrityError(`cannot delete ${t} ${rid}: ${kids.length} ${fk.table} row(s) use it`)
          }
          if (APPEND_ONLY.has(fk.table)) throw new IntegrityError(`cannot cascade into append-only ${fk.table}`)
          for (const k of kids) await visit(fk.table, k.id)
        }
      }
      await visit(table, id)
      for (const [t, rid] of toDelete.reverse()) await this.db[t].delete(rid)
    })
  }

  /** Scan every foreign key for orphans. Returns a list of problems; empty means sound. */
  async checkIntegrity(): Promise<string[]> {
    const problems: string[] = []
    for (const fk of FOREIGN_KEYS) {
      const parentIds = new Set((await this.db[fk.ref].toCollection().primaryKeys()) as string[])
      await this.db[fk.table].each((row) => {
        const r = row as unknown as Rec
        const v = r[fk.field]
        if (v === undefined || v === null) {
          if (!fk.optional) problems.push(`${fk.table} ${r.id}: missing ${fk.field}`)
        } else if (!parentIds.has(v as string)) {
          problems.push(`${fk.table} ${r.id}: ${fk.field} -> missing ${fk.ref} ${String(v)}`)
        }
      })
    }
    return problems
  }
}
