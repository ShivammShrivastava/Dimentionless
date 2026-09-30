export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US')

export function fmtBytes(b: number, digits = 1): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(digits)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(digits)} MB`
  if (b >= 1e3) return `${(b / 1e3).toFixed(digits)} KB`
  return `${b} B`
}

export const fmtMs = (ms: number, digits = 1) => `${ms.toFixed(digits)} ms`
export const fmtPct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`
export const fmtX = (v: number) => `${v.toFixed(v >= 100 ? 0 : 1)}×`
export const fmtM = (m: number, digits = 2) => `${m.toFixed(digits)} m`

export function fmtTimestamp(us: number): string {
  const d = new Date(us / 1000)
  return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(Math.floor((us / 1000) % 1000)).padStart(3, '0')
}
