import { ChefHat, Send } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const QUICK = ['What can I make from my pantry?', 'High-protein lunch ideas', 'How do I reach my protein target today?', 'Dinner under $5', 'Use up what expires soon', 'Post-workout meal']

/** Ask Chef from the dashboard: type a question or tap one; the answer opens in Chef. */
export function AskChef() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const go = (text: string) => text.trim() && nav('/chef', { state: { ask: text.trim() } })
  return (
    <section aria-labelledby="ask-chef" className="rounded-2xl bg-leaf-700 p-4 text-on-accent shadow-raised">
      <h2 id="ask-chef" className="flex items-center gap-2 text-base font-semibold"><ChefHat className="h-5 w-5" aria-hidden />Ask Chef</h2>
      <p className="mt-0.5 text-sm opacity-90">Ask about meals, your pantry, protein or money, in your own words.</p>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); go(q) }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ask Chef a question" placeholder="e.g. I have chicken, rice and broccoli" enterKeyHint="send" autoComplete="off"
          className="block min-h-11 w-full rounded-xl border-0 bg-white px-3 text-ink placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-leaf-200" />
        <button type="submit" disabled={!q.trim()} aria-label="Ask" className="grid min-h-11 w-12 shrink-0 place-items-center rounded-xl bg-white/15 transition hover:bg-white/25 disabled:opacity-50">
          <Send className="h-5 w-5" aria-hidden />
        </button>
      </form>
      <div className="-mx-1 mt-2 flex flex-wrap gap-1.5">
        {QUICK.map((t) => (
          <button key={t} type="button" onClick={() => go(t)} className="min-h-9 rounded-full bg-white/15 px-3 text-xs font-medium transition hover:bg-white/25">{t}</button>
        ))}
      </div>
    </section>
  )
}
