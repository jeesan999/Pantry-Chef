import { cx } from './ui'

const src = (n: number) => `${import.meta.env.BASE_URL}brand/pantry-chef-logo-${n}.webp`

/**
 * The official Pantry Chef logo and mascot. The artwork is never altered: it keeps its own proportions
 * (object-contain inside a square box) and the browser picks the smallest file that stays sharp.
 */
export function Logo({ size, className, eager = false, decorative = false }: { size: number; className?: string; eager?: boolean; decorative?: boolean }) {
  return (
    <img
      src={src(size <= 64 ? 128 : size <= 128 ? 256 : 512)}
      srcSet={`${src(128)} 128w, ${src(256)} 256w, ${src(512)} 512w`}
      sizes={`${size}px`}
      width={size}
      height={size}
      alt={decorative ? '' : 'Pantry Chef'}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      className={cx('shrink-0 select-none object-contain', className)}
      style={{ width: size, height: size }}
    />
  )
}
