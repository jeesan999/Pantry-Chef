import { useEffect, useRef, useState } from 'react'
import { Page } from '../components/ui'
import { pantry, repo, today } from '../db/instance'
import { newId } from '../db/repo'
import { ask, type Option, type Reply } from '../lib/chef'
import { on } from '../lib/events'
import { Chip, Thread, type Handlers, type Msg } from './chef/Thread'

const STORE = 'chef-thread'
const STARTERS = ['Swap tonight’s dinner', 'Make tomorrow a rest day', 'Use up what expires soon', 'What can I cook?', 'Add milk to the shopping list', 'How much budget is left?']

function load(): Msg[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? '[]') as Msg[]
  } catch {
    return []
  }
}

const nowHHMM = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Live actions for messages in this session; they can't be stored, so reopened messages show as expired. */
interface Live { options?: Option[]; apply?: () => Promise<{ text: string; undo?: () => Promise<string>; link?: { to: string; label: string } }>; undo?: () => Promise<string> }

// Kept outside the component so actions survive switching screens; a reload clears them.
const LIVE = new Map<string, Live>()
on('data-replaced', () => LIVE.clear()) // a restore makes held actions meaningless

export default function ChefScreen() {
  const [msgs, setMsgs] = useState<Msg[]>(load)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-60)))
    } catch {
      // private mode or storage full: the thread just isn't kept
    }
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [msgs])

  const push = (...m: Msg[]) => setMsgs((xs) => [...xs, ...m])
  const setState = (id: string, state: NonNullable<Extract<Msg, { from: 'chef' }>['state']>) =>
    setMsgs((xs) => xs.map((x) => (x.id === id && x.from === 'chef' ? { ...x, state } : x)))

  const fromReply = (r: Reply): Msg => {
    const id = newId()
    switch (r.kind) {
      case 'answer':
        if (r.options?.length) LIVE.set(id, { options: r.options })
        return { id, from: 'chef', kind: 'answer', text: r.text, lines: r.lines, link: r.link, options: r.options?.map((o) => ({ label: o.label, detail: o.detail })), state: r.options?.length ? 'open' : undefined }
      case 'proposal':
        LIVE.set(id, { apply: r.apply })
        return { id, from: 'chef', kind: 'proposal', text: r.text, changes: r.changes, state: 'open' }
      case 'done':
        if (r.undo) LIVE.set(id, { undo: r.undo })
        return { id, from: 'chef', kind: 'done', text: r.text, link: r.link, undoable: !!r.undo }
      case 'unknown':
        return { id, from: 'chef', kind: 'unknown', text: r.text, examples: r.examples }
    }
  }

  const run = async (fn: () => Promise<Msg | null>) => {
    setBusy(true)
    try {
      const m = await fn()
      if (m) push(m)
    } catch (e) {
      push({ id: newId(), from: 'chef', kind: 'error', text: (e as Error).message || 'That didn’t work.' })
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  const say = (raw: string) => {
    const t = raw.replace(/[“”]/g, '').trim()
    if (!t || busy) return
    setText('')
    push({ id: newId(), from: 'me', text: t })
    void run(async () => fromReply(await ask({ repo, pantry, today: today(), now: nowHHMM() }, t)))
  }

  const h: Handlers = {
    busy,
    live: (id) => LIVE.has(id),
    say,
    pick: (id, i) => {
      const o = LIVE.get(id)?.options?.[i]
      if (!o) return
      setState(id, 'used')
      LIVE.delete(id)
      push({ id: newId(), from: 'me', text: o.label })
      void run(async () => fromReply(await o.run()))
    },
    apply: (id) => {
      const a = LIVE.get(id)?.apply
      if (!a) return
      void run(async () => {
        const done = await a()
        setState(id, 'applied')
        LIVE.delete(id)
        return fromReply({ kind: 'done', ...done })
      })
    },
    cancel: (id) => {
      LIVE.delete(id)
      setState(id, 'cancelled')
    },
    undo: (id) => {
      const u = LIVE.get(id)?.undo
      if (!u) return
      void run(async () => {
        const said = await u()
        LIVE.delete(id)
        setState(id, 'undone')
        return { id: newId(), from: 'chef', kind: 'info', text: said }
      })
    },
  }

  return (
    <Page title="Chef" subtitle="Ask in your own words. Works offline: no AI service, nothing leaves your phone.">
      {msgs.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-stone-600">Change meals, set training or rest days, use up food, add to your shopping list, or ask about your plan and spending. Nothing changes until you tap “Do it”, and you can undo.</p>
          <div className="flex flex-wrap gap-1.5">
            {STARTERS.map((s) => <Chip key={s} text={s} onClick={() => say(s)} disabled={busy} />)}
          </div>
        </div>
      ) : (
        <>
          <Thread msgs={msgs} h={h} />
          <button type="button" className="text-xs text-stone-500 underline" onClick={() => { LIVE.clear(); setMsgs([]) }}>Clear conversation</button>
        </>
      )}
      <div ref={end} className="h-20" aria-hidden />

      <form
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-stone-200 bg-stone-50/95 backdrop-blur lg:bottom-0 lg:left-60"
        onSubmit={(e) => {
          e.preventDefault()
          say(text)
        }}
      >
        <div className="mx-auto flex max-w-2xl gap-2 px-4 py-2">
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Message Chef"
            placeholder="e.g. swap tonight’s dinner"
            enterKeyHint="send"
            autoComplete="off"
            className="block min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-ink focus:border-leaf-500 focus:outline-none focus:ring-2 focus:ring-leaf-200"
          />
          <button type="submit" disabled={busy || !text.trim()} className="min-h-11 shrink-0 rounded-xl bg-leaf-700 px-4 text-sm font-medium text-on-accent transition hover:bg-leaf-600 disabled:opacity-40">
            Send
          </button>
        </div>
      </form>
    </Page>
  )
}
