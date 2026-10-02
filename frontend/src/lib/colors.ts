export const CLASS_NAMES = ['ignore', 'drivable', 'terrain_nondrivable', 'static_obstacle', 'dynamic_object'] as const
export const CLASS_LABELS = ['Empty', 'Drivable surface', 'Non-drivable terrain', 'Static obstacle', 'Dynamic object']
export const CLASS_SHORT = ['Empty', 'Drivable', 'Terrain', 'Static', 'Dynamic']

/**
 * LiDAR thermal depth palette — matches classic point-cloud colourmaps:
 *   ignore        → near-black (not rendered)
 *   drivable      → cyan-blue   (flat road surface, low height)
 *   terrain       → lime-green  (kerb / grass, mid height)
 *   static_obs    → amber→orange (walls, buildings, high static)
 *   dynamic_obj   → vivid red    (moving vehicles, pedestrians — highest urgency)
 */
export const PALETTE_DEFAULT = ['#050608', '#00BFFF', '#39FF14', '#FF8C00', '#FF2020']

/** Colour-blind safe alternative — same thermal metaphor but shifted for CVD. */
export const PALETTE_CB = ['#050608', '#56B4E9', '#009E73', '#E69F00', '#D55E00']

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
  return 0.55 + 0.70 * t
}

/**
 * Continuous thermal colormap for 3D height rendering.
 * Maps a normalised t ∈ [0,1] through:
 *   0.00 → deep blue   (#0000CC)
 *   0.15 → cyan         (#00BFFF)
 *   0.30 → green        (#00DD44)
 *   0.50 → yellow-green (#88DD00)
 *   0.65 → yellow       (#DDDD00)
 *   0.80 → orange       (#FF8800)
 *   1.00 → red          (#FF1100)
 *
 * zCm: height in centimetres, mapped to [0,1] over the range [-40, 600].
 */
export function thermalColor(zCm: number): Rgb {
  const t = Math.min(1, Math.max(0, (zCm + 40) / 640))

  // Piecewise linear ramp through 7 control points
  const stops: { t: number; c: Rgb }[] = [
    { t: 0.00, c: [  0,   0, 204] },   // deep blue
    { t: 0.15, c: [  0, 191, 255] },   // cyan
    { t: 0.30, c: [  0, 221,  68] },   // green
    { t: 0.50, c: [136, 221,   0] },   // yellow-green
    { t: 0.65, c: [221, 221,   0] },   // yellow
    { t: 0.80, c: [255, 136,   0] },   // orange
    { t: 1.00, c: [255,  17,   0] },   // red
  ]

  // Find the two surrounding stops
  let lo = stops[0], hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) {
      lo = stops[i]
      hi = stops[i + 1]
      break
    }
  }

  const f = hi.t === lo.t ? 0 : (t - lo.t) / (hi.t - lo.t)
  return [
    Math.round(lo.c[0] + (hi.c[0] - lo.c[0]) * f),
    Math.round(lo.c[1] + (hi.c[1] - lo.c[1]) * f),
    Math.round(lo.c[2] + (hi.c[2] - lo.c[2]) * f),
  ]
}

export function shade(rgb: Rgb, f: number): Rgb {
  return [Math.min(255, rgb[0] * f), Math.min(255, rgb[1] * f), Math.min(255, rgb[2] * f)]
}

export const STAGE_COLORS: Record<string, string> = {
  range_proj: '#E3A63A',
  inference:  '#FF6B9D',
  unproject:  '#F0D8A0',
  projection: '#39FF14',
  encode:     '#9A9A9F',
}
