import { useEffect, useState } from 'react'
import type { Recipe } from '../db/types'
import { cx } from './ui'

const PALETTES: Record<string, [string, string]> = {
  Australian: ['#f6e7c8', '#b8611a'],
  Italian: ['#fde2d6', '#b23a2b'],
  Mexican: ['#fdf0c6', '#c2410c'],
  Thai: ['#e1f3dc', '#2e7445'],
  Japanese: ['#e7ecf3', '#1f3a5f'],
  Indian: ['#fde9c4', '#a16207'],
  'Middle Eastern': ['#f3e8d8', '#7c4a1e'],
  Korean: ['#fbe0e0', '#9f1239'],
  Greek: ['#dcebf7', '#1d4f8a'],
  Chinese: ['#fde4d0', '#b91c1c'],
}

/** The recipe's own photo if one has been added, otherwise a styled placeholder card. */
export function RecipeArt({ recipe, className }: { recipe: Pick<Recipe, 'name' | 'cuisine' | 'photo'>; className?: string }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!recipe.photo) return
    const u = URL.createObjectURL(recipe.photo)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [recipe.photo])
  if (url) return <img src={url} alt={recipe.name} className={cx('object-cover', className)} />
  const [bg, fg] = PALETTES[recipe.cuisine] ?? ['#ecebe8', '#44403c']
  const initials = recipe.name.split(/[\s,:]+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
  return (
    <div className={cx('relative flex items-center justify-center overflow-hidden', className)} style={{ background: bg }} aria-hidden>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full opacity-25">
        <circle cx="78" cy="22" r="30" fill={fg} opacity="0.35" />
        <circle cx="18" cy="88" r="26" fill={fg} opacity="0.25" />
      </svg>
      <span className="relative text-2xl font-semibold tracking-wide" style={{ color: fg }}>{initials}</span>
    </div>
  )
}
