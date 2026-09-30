/**
 * Top-down car glyph for the ego vehicle. Heading is "up" on screen (+x forward).
 * L, W are the body length and width in pixels. Works from ~12 px up to full size.
 */
export function drawCar(ctx: CanvasRenderingContext2D, cx: number, cy: number, L: number, W: number, alpha = 1) {
  const r = Math.min(W * 0.28, 8)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.globalAlpha = alpha

  // wheels (slightly outside the body)
  const ww = W * 0.16
  const wl = L * 0.16
  ctx.fillStyle = '#2B2B30'
  for (const [sx, sy] of [
    [-W / 2 - ww * 0.35, -L * 0.3],
    [W / 2 - ww * 0.65, -L * 0.3],
    [-W / 2 - ww * 0.35, L * 0.18],
    [W / 2 - ww * 0.65, L * 0.18],
  ]) {
    ctx.beginPath()
    ctx.roundRect(sx, sy, ww, wl, ww * 0.35)
    ctx.fill()
  }

  // body
  const body = ctx.createLinearGradient(-W / 2, 0, W / 2, 0)
  body.addColorStop(0, '#D9D4CA')
  body.addColorStop(0.5, '#F4F1EA')
  body.addColorStop(1, '#D3CEC4')
  ctx.fillStyle = body
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.lineWidth = Math.max(1, W * 0.04)
  ctx.beginPath()
  ctx.roundRect(-W / 2, -L / 2, W, L, [r * 1.6, r * 1.6, r, r])
  ctx.fill()
  ctx.stroke()

  if (L > 18) {
    // windshield + rear window (dark glass)
    ctx.fillStyle = '#26262C'
    ctx.beginPath()
    ctx.moveTo(-W * 0.38, -L * 0.22)
    ctx.lineTo(W * 0.38, -L * 0.22)
    ctx.lineTo(W * 0.32, -L * 0.06)
    ctx.lineTo(-W * 0.32, -L * 0.06)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-W * 0.33, L * 0.24)
    ctx.lineTo(W * 0.33, L * 0.24)
    ctx.lineTo(W * 0.38, L * 0.36)
    ctx.lineTo(-W * 0.38, L * 0.36)
    ctx.closePath()
    ctx.fill()
    // roof
    ctx.fillStyle = 'rgba(0,0,0,0.08)'
    ctx.beginPath()
    ctx.roundRect(-W * 0.34, -L * 0.06, W * 0.68, L * 0.3, r * 0.6)
    ctx.fill()
    // side mirrors
    ctx.fillStyle = '#2B2B30'
    ctx.fillRect(-W / 2 - W * 0.12, -L * 0.2, W * 0.12, L * 0.05)
    ctx.fillRect(W / 2, -L * 0.2, W * 0.12, L * 0.05)
  }

  // headlights (lime) and tail lights (coral)
  const lw = W * 0.22
  const lh = Math.max(1.5, L * 0.035)
  ctx.fillStyle = '#D4FC79'
  ctx.fillRect(-W / 2 + W * 0.08, -L / 2 + lh * 0.4, lw, lh)
  ctx.fillRect(W / 2 - W * 0.08 - lw, -L / 2 + lh * 0.4, lw, lh)
  ctx.fillStyle = '#FF6B9D'
  ctx.fillRect(-W / 2 + W * 0.08, L / 2 - lh * 1.4, lw, lh)
  ctx.fillRect(W / 2 - W * 0.08 - lw, L / 2 - lh * 1.4, lw, lh)

  // heading chevron above the bonnet
  ctx.fillStyle = '#FF6B9D'
  ctx.beginPath()
  ctx.moveTo(0, -L / 2 - Math.max(6, L * 0.14))
  ctx.lineTo(-Math.max(4, W * 0.28), -L / 2 - Math.max(2, L * 0.03))
  ctx.lineTo(Math.max(4, W * 0.28), -L / 2 - Math.max(2, L * 0.03))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}
