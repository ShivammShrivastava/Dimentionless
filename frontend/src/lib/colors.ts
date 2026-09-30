export const CLASS_NAMES = ['ignore', 'drivable', 'terrain_nondrivable', 'static_obstacle', 'dynamic_object'] as const
export const CLASS_LABELS = ['Empty', 'Drivable surface', 'Non-drivable terrain', 'Static obstacle', 'Dynamic object']
export const CLASS_SHORT = ['Empty', 'Drivable', 'Terrain', 'Static', 'Dynamic']

/** Default map palette: blue road, sand terrain, slate structure, coral dynamic. No green, no purple. */
export const PALETTE_DEFAULT = ['#0F172A', '#3B82F6', '#E8B04B', '#9AA8BF', '#FF6B9D']
/** Colour-blind safe alternative (Okabe-Ito derived). */
export const PALETTE_CB = ['#0F172A', '#0072B2', '#E69F00', '#C9D1DB', '#D55E00']

export type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function paletteRgb(palette: string[]): Rgb[] {
  return palette.map(hexToRgb)
}

/** Brightness factor from height: flat ground stays deep, tall structure reads lighter. */
export function heightFactor(zCm: number): number {
  const t = Math.min(1, Math.max(0, (zCm + 40) / 340))
  return 0.62 + 0.62 * t
}

export function shade(rgb: Rgb, f: number): Rgb {
  return [Math.min(255, rgb[0] * f), Math.min(255, rgb[1] * f), Math.min(255, rgb[2] * f)]
}

export const STAGE_COLORS: Record<string, string> = {
  range_proj: '#6FA8FF',
  inference: '#FF6B9D',
  unproject: '#A9C4FF',
  projection: '#D4FC79',
  encode: '#9AA8BF',
}
