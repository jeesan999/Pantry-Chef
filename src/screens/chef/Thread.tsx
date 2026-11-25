import { Link } from 'react-router-dom'
import { Button, cx } from '../../components/ui'

export type MsgState = 'open' | 'applied' | 'cancelled' | 'used' | 'undone' | 'expired'

/** A message as stored (no functions, so it can be kept in sessionStorage). */
export type Msg =
  | { id: string; from: 'me'; text: string }
  | {
      id: string
      from: 'chef'
      kind: 'answer' | 'proposal' | 'done' | 'unknown' | 'info' | 'error'
      text: string
      lines?: string[]
      changes?: string[]
      options?: Array<{ label: string; detail?: string }>
      examples?: string[]
      link?: { to: string; label: string }
      undoable?: boolean
      state?: MsgState
    }

type ChefMsg = Extract<Msg, { from: 'chef' }>

export interface Handlers {
  live: (id: string) => boolean // closures still held for this message
  pick: (id: string, index: number) => void
  apply: (id: string) => void
  cancel: (id: string) => void
  undo: (id: string) => void
  say: (text: string) => void
  busy: boolean
}

export function Thread({ msgs, h }: { msgs: Msg[]; h: Handlers }) {
  return (
    <ol role="log" aria-live="polite" aria-label="Conversation with Chef" className="space-y-3">
      {msgs.map((m) =>
        m.from === 'me' ? (
          <li key={m.id} className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl rounded-br-md bg-leaf-700 px-3.5 py-2 text-sm text-white">{m.text}</p>
          </li>
        ) : (
          <li key={m.id} className="flex justify-start">
            <ChefBubble m={m} h={h} />
          </li>
        ),
      )}
    </ol>
  )
}

function ChefBubble({ m, h }: { m: ChefMsg; h: Handlers }) {
  const live = h.live(m.id)
  const open = m.state === 'open' && live
  const expired = m.state === 'open' && !live
  return (
    <div
      className={cx(
        'w-full max-w-[92%] rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-sm',
        m.kind === 'error' ? 'border-red-200 bg-red-50 text-red-900' : m.kind === 'done' ? 'border-leaf-200 bg-leaf-50 text-leaf-900' : 'border-stone-200 bg-white text-stone-800',
      )}
    >
      <p className={m.kind === 'proposal' ? 'font-medium' : undefined}>{m.text}</p>

      {m.lines && (
        <ul className="mt-1.5 space-y-0.5 text-stone-700">
          {m.lines.map((l, i) =>
            m.kind === 'answer' && m.text.startsWith('Here’s what I can do') ? (
              <li key={i}>
                <button type="button" className="min-h-9 text-left text-leaf-700 underline-offset-2 hover:underline" onClick={() => h.say(l)} disabled={h.busy}>“{l}”</button>
              </li>
            ) : (
              <li key={i} className="flex gap-1.5"><span aria-hidden className="text-stone-400">•</span><span>{l}</span></li>
            ),
          )}
        </ul>
      )}

      {m.changes && (
        <ul className="mt-2 space-y-1 rounded-xl bg-stone-50 px-3 py-2 text-stone-700">
          {m.changes.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      )}

      {m.kind === 'proposal' && (
        open ? (
          <div className="mt-2.5 flex gap-2">
            <Button className="flex-1" onClick={() => h.apply(m.id)} disabled={h.busy}>Do it</Button>
            <Button variant="secondary" className="flex-1" onClick={() => h.cancel(m.id)} disabled={h.busy}>Cancel</Button>
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-stone-500">
            {m.state === 'applied' ? 'Done.' : m.state === 'cancelled' ? 'Cancelled: nothing changed.' : expired ? 'This expired when the app was reopened. Ask again to do it.' : ''}
          </p>
        )
      )}

      {m.options && m.options.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {m.options.map((o, i) => (
            <li key={i}>
              <button
                type="button"
                disabled={!open || h.busy}
                onClick={() => h.pick(m.id, i)}
                className="w-full rounded-xl border border-leaf-200 bg-leaf-50 px-3 py-2 text-left transition hover:bg-leaf-100 disabled:border-stone-200 disabled:bg-stone-50 disabled:text-stone-500"
              >
                <span className="block font-medium">{o.label}</span>
                {o.detail && <span className="block text-xs text-stone-500">{o.detail}</span>}
              </button>
            </li>
          ))}
          {expired && <li className="text-xs text-stone-500">These choices expired when the app was reopened. Ask again.</li>}
        </ul>
      )}

      {m.examples && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.examples.map((e) => <Chip key={e} text={e} onClick={() => h.say(e)} disabled={h.busy} />)}
        </div>
      )}

      {(m.link || (m.kind === 'done' && m.undoable)) && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {m.link && <Link to={m.link.to} className="min-h-9 py-2 text-sm font-medium text-leaf-700 underline">{m.link.label}</Link>}
          {m.kind === 'done' && m.undoable && (
            m.state === 'undone' ? <span className="text-xs text-stone-500">Undone.</span>
            : live ? <Button variant="ghost" className="min-h-9 px-2" onClick={() => h.undo(m.id)} disabled={h.busy}>Undo</Button>
            : null
          )}
        </div>
      )}
    </div>
  )
}

export function Chip({ text, onClick, disabled }: { text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="min-h-9 rounded-full border border-leaf-200 bg-white px-3 text-sm text-leaf-700 transition hover:bg-leaf-50 disabled:opacity-50">
      {text}
    </button>
  )
}
