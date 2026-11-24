/** In-app events. The Meal Planning Engine listens for targets-approved (Phase 5). */
export interface AppEvents {
  'targets-approved': { targetsId: string; version: number }
  'data-changed': { table: string }
}

type AnyHandler = (payload: unknown) => void
const handlers = new Map<keyof AppEvents, Set<AnyHandler>>()

export function on<K extends keyof AppEvents>(event: K, h: (payload: AppEvents[K]) => void): () => void {
  let set = handlers.get(event)
  if (!set) handlers.set(event, (set = new Set()))
  set.add(h as AnyHandler)
  return () => set.delete(h as AnyHandler)
}

export function emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
  for (const h of handlers.get(event) ?? []) h(payload)
}
