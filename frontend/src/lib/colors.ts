export const CLASS_NAMES = ['ignore', 'drivable', 'terrain_nondrivable', 'static_obstacle', 'dynamic_object'] as const
export const CLASS_LABELS = ['Empty', 'Drivable surface', 'Non-drivable terrain', 'Static obstacle', 'Dynamic object']
export const CLASS_SHORT = ['Empty', 'Drivable', 'Terrain', 'Static', 'Dynamic']

/** Map palette on warm graphite: stone road, amber terrain, white structure, coral dynamic. No blue, green or purple. */
export const PALETTE_DEFAULT = ['#111113', '#A79F93', '#E3A63A', '#EDEDF0', '#FF6B9D']
/** Colour-blind safe alternative (Okabe-Ito derived, still blue/green free). */
export const PALETTE_CB = ['#111113', '#8C8C8C', '#E69F00', '#FFFFFF', '#D55E00']

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
  range_proj: '#E3A63A',
  inference: '#FF6B9D',
  unproject: '#F0D8A0',
  projection: '#D4FC79',
  encode: '#9A9A9F',
}
