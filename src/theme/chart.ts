import { useThemeColors } from './appearance'

/** Chart colours for the current theme, as plain values (chart libraries draw with SVG attributes). */
export function useChartPalette() {
  const c = useThemeColors(['--chart-series', '--chart-grid', '--chart-axis', '--chart-dots', '--chart-cursor', '--color-white', '--color-stone-500'] as const)
  return {
    SERIES: c['--chart-series'],
    TREND: c['--chart-series'],
    GRID: c['--chart-grid'],
    AXIS: c['--chart-axis'],
    DOTS: c['--color-stone-500'], // weigh-in dots: muted but 3:1 on cards in every theme
    CURSOR: c['--chart-cursor'],
    SURFACE: c['--color-white'],
    tick: { fill: c['--chart-axis'], fontSize: 11 },
  }
}
