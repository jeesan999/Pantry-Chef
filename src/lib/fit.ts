/** How a planned total compares with its target. */
export function fitStatus(value: number, target: number): { tone: 'leaf' | 'ember' | 'red' | 'stone'; label: string } {
  if (target <= 0) return { tone: 'stone', label: '' }
  const r = value / target
  if (r > 1.1) return { tone: 'red', label: 'above' }
  if (r >= 0.9) return { tone: 'leaf', label: 'on target' }
  if (r >= 0.75) return { tone: 'ember', label: 'slightly below' }
  return { tone: 'ember', label: 'well below' }
}
