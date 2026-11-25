/**
 * Dates, meal slots and times in a Chef command, relative to a given today.
 * Input is already normalised (see normalise.ts). Returns what it found and the text with those words removed.
 */
import type { SlotName } from '../contract'
import { addDays, mondayOf } from '../nutrition/engine'

export interface When { date?: string; slot?: SlotName; time?: string; rest: string }

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const pad = (n: number) => String(n).padStart(2, '0')
const weekdayIdx = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7

const SLOT_WORDS: Array<[RegExp, SlotName]> = [
  [/\b(breakfast|brekfast)s?\b/, 'breakfast'],
  [/\b(smoko|morning tea|morning snack|snack)\b/, 'smoko'],
  [/\b(lunch|lunches)\b/, 'lunch'],
  [/\b(dinner|dinners|supper|evening meal)\b/, 'dinner'],
]

function cut(text: string, re: RegExp): [RegExpMatchArray | null, string] {
  const m = text.match(re)
  if (!m) return [null, text]
  return [m, (text.slice(0, m.index) + ' ' + text.slice(m.index! + m[0].length)).replace(/\s+/g, ' ').trim()]
}

/** "6", "6am", "6 pm", "17:30", "5:30pm" -> "HH:MM". Bare hours from 1 to 4 read as afternoon. */
export function parseTime(h: string, m: string | undefined, ampm: string | undefined): string | undefined {
  let hour = Number(h)
  const min = m ? Number(m) : 0
  if (hour > 23 || min > 59) return undefined
  if (ampm === 'pm' && hour < 12) hour += 12
  else if (ampm === 'am' && hour === 12) hour = 0
  else if (!ampm && hour >= 1 && hour <= 4) hour += 12
  return `${pad(hour)}:${pad(min)}`
}

export function parseWhen(text: string, today: string): When {
  let rest = ` ${text} `
  let date: string | undefined
  let slot: SlotName | undefined
  let time: string | undefined
  let m: RegExpMatchArray | null

  // times first, so "at 6" isn't read as a date
  ;[m, rest] = cut(rest, /\b(?:at|from|by)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  if (!m) [m, rest] = cut(rest, /\b(?:at|from|by)\s+(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:kg|g|ml|l|th|st|nd|rd|\/))/)
  if (!m) [m, rest] = cut(rest, /\b(\d{1,2}):(\d{2})\b/)
  if (m) time = parseTime(m[1], m[2], m[3])

  ;[m, rest] = cut(rest, /\btonights?\b/)
  if (m) {
    date = today
    slot = 'dinner'
  }
  if (!date) {
    ;[m, rest] = cut(rest, /\b(?:the )?day after tomorrow\b/)
    if (m) date = addDays(today, 2)
  }
  if (!date) {
    ;[m, rest] = cut(rest, /\btomorrows?\b/)
    if (m) date = addDays(today, 1)
  }
  if (!date) {
    ;[m, rest] = cut(rest, /\byesterdays?\b/)
    if (m) date = addDays(today, -1)
  }
  if (!date) {
    ;[m, rest] = cut(rest, /\b(?:todays?|this (?:morning|afternoon|arvo|evening))\b/)
    if (m) date = today
  }
  if (!date) {
    ;[m, rest] = cut(rest, /\b(?:(this|next|on)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/)
    if (m) {
      const idx = WEEKDAYS.indexOf(m[2])
      if (m[1] === 'next') date = addDays(mondayOf(today), 7 + idx)
      else date = addDays(today, (idx - weekdayIdx(today) + 7) % 7) // the next one, today included
    }
  }
  if (!date) {
    // 28/11, 28/11/2026, 28/11/26
    ;[m, rest] = cut(rest, /\b(?:on )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
    if (m) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4))
      const d = `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`
      if (!Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && Number(m[2]) <= 12 && Number(m[1]) <= 31) date = !m[3] && d < today ? `${y + 1}${d.slice(4)}` : d
    }
  }
  if (!date) {
    // "on the 28th"
    ;[m, rest] = cut(rest, /\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)?\b/)
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
      const [y, mo] = today.split('-').map(Number)
      let d = `${y}-${pad(mo)}-${pad(Number(m[1]))}`
      if (d < today) d = mo === 12 ? `${y + 1}-01-${pad(Number(m[1]))}` : `${y}-${pad(mo + 1)}-${pad(Number(m[1]))}`
      date = d
    }
  }

  if (!slot) {
    for (const [re, s] of SLOT_WORDS) {
      const [hit, r] = cut(rest, re)
      if (hit) {
        slot = s
        rest = r
        break
      }
    }
  }
  return { date, slot, time, rest: rest.replace(/\s+/g, ' ').trim() }
}
