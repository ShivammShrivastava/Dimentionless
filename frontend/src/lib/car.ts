/**
 * Top-down car glyph for the ego vehicle. Heading is "up" on screen (+x forward).
 * L, W are the body length and width in pixels. Works from ~12 px up to full size.
 * White body, black windows, white tyres, white LiDAR dome, magenta side sensor pods.
 */
export function drawCar(ctx: CanvasRenderingContext2D, cx: number, cy: number, L: number, W: number, alpha = 1) {
  const r = Math.min(W * 0.28, 8)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.globalAlpha = alpha

  // ── wheels (white) ─────────────────────────────────────────────────────────
  const ww = W * 0.16
  const wl = L * 0.16
  ctx.fillStyle = '#e8ecf2'
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = Math.max(0.5, W * 0.02)
  for (const [sx, sy] of [
    [-W / 2 - ww * 0.35, -L * 0.3],
    [ W / 2 - ww * 0.65, -L * 0.3],
    [-W / 2 - ww * 0.35,  L * 0.18],
    [ W / 2 - ww * 0.65,  L * 0.18],
  ]) {
    ctx.beginPath()
    ctx.roundRect(sx, sy, ww, wl, ww * 0.35)
    ctx.fill()
    ctx.stroke()
  }

  // ── body — bright white ────────────────────────────────────────────────────
  const body = ctx.createLinearGradient(-W / 2, 0, W / 2, 0)
  body.addColorStop(0,   '#dde3ee')
  body.addColorStop(0.5, '#f5f7fb')
  body.addColorStop(1,   '#d8dfe9')
  ctx.fillStyle = body
  ctx.strokeStyle = 'rgba(0,0,0,0.30)'
  ctx.lineWidth = Math.max(1, W * 0.04)
  ctx.beginPath()
  ctx.roundRect(-W / 2, -L / 2, W, L, [r * 1.6, r * 1.6, r, r])
  ctx.fill()
  ctx.stroke()

  if (L > 18) {
    // ── windshield (solid black) ──────────────────────────────────────────────
    ctx.fillStyle = '#0a0b0e'
    ctx.beginPath()
    ctx.moveTo(-W * 0.38, -L * 0.22)
    ctx.lineTo( W * 0.38, -L * 0.22)
    ctx.lineTo( W * 0.32, -L * 0.06)
    ctx.lineTo(-W * 0.32, -L * 0.06)
    ctx.closePath()
    ctx.fill()

    // ── rear window (solid black) ─────────────────────────────────────────────
    ctx.beginPath()
    ctx.moveTo(-W * 0.33, L * 0.24)
    ctx.lineTo( W * 0.33, L * 0.24)
    ctx.lineTo( W * 0.38, L * 0.36)
    ctx.lineTo(-W * 0.38, L * 0.36)
    ctx.closePath()
    ctx.fill()

    // ── roof panel — slightly whiter centre ───────────────────────────────────
    const roof = ctx.createRadialGradient(0, L * 0.08, 0, 0, L * 0.08, W * 0.5)
    roof.addColorStop(0,   'rgba(255,255,255,0.92)')
    roof.addColorStop(0.7, 'rgba(220,228,240,0.70)')
    roof.addColorStop(1,   'rgba(190,200,215,0.45)')
    ctx.fillStyle = roof
    ctx.beginPath()
    ctx.roundRect(-W * 0.34, -L * 0.06, W * 0.68, L * 0.3, r * 0.6)
    ctx.fill()

    // ── LiDAR sensor dome ─────────────────────────────────────────────────────
    const lidarR  = Math.max(3, W * 0.19)
    const lidarCx = 0
    const lidarCy = L * 0.08
    // outer glow
    const glow = ctx.createRadialGradient(lidarCx, lidarCy, lidarR * 0.6, lidarCx, lidarCy, lidarR * 1.6)
    glow.addColorStop(0, 'rgba(180,210,255,0.22)')
    glow.addColorStop(1, 'rgba(140,180,240,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(lidarCx, lidarCy, lidarR * 1.6, 0, Math.PI * 2)
    ctx.fill()
    // dome body
    const dome = ctx.createRadialGradient(lidarCx - lidarR * 0.3, lidarCy - lidarR * 0.3, 0, lidarCx, lidarCy, lidarR)
    dome.addColorStop(0,   '#ffffff')
    dome.addColorStop(0.5, '#d6dfe9')
    dome.addColorStop(1,   '#8fa0b4')
    ctx.fillStyle = dome
    ctx.strokeStyle = 'rgba(0,0,0,0.20)'
    ctx.lineWidth = Math.max(0.8, W * 0.025)
    ctx.beginPath()
    ctx.arc(lidarCx, lidarCy, lidarR, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    // inner ring detail
    ctx.strokeStyle = 'rgba(100,130,160,0.5)'
    ctx.lineWidth = Math.max(0.5, W * 0.015)
    ctx.beginPath()
    ctx.arc(lidarCx, lidarCy, lidarR * 0.52, 0, Math.PI * 2)
    ctx.stroke()
    // centre dot
    ctx.fillStyle = 'rgba(80,110,145,0.6)'
    ctx.beginPath()
    ctx.arc(lidarCx, lidarCy, lidarR * 0.18, 0, Math.PI * 2)
    ctx.fill()

    // ── side sensor pods (magenta) ────────────────────────────────────────────
    const podW = Math.max(2, W * 0.07)
    const podH = Math.max(3, L * 0.055)
    ctx.shadowColor = '#FF6B9D'
    ctx.shadowBlur  = Math.max(2, W * 0.08)
    ctx.fillStyle   = 'rgba(255,107,157,0.90)'
    ctx.beginPath(); ctx.roundRect(-W / 2 - podW * 0.6, -L * 0.26, podW, podH, podW * 0.3); ctx.fill()
    ctx.beginPath(); ctx.roundRect(-W / 2 - podW * 0.6,  L * 0.16, podW, podH, podW * 0.3); ctx.fill()
    ctx.beginPath(); ctx.roundRect( W / 2 - podW * 0.4, -L * 0.26, podW, podH, podW * 0.3); ctx.fill()
    ctx.beginPath(); ctx.roundRect( W / 2 - podW * 0.4,  L * 0.16, podW, podH, podW * 0.3); ctx.fill()
    ctx.shadowBlur = 0

    // ── side mirrors (dark gray) ──────────────────────────────────────────────
    ctx.fillStyle = '#555a66'
    ctx.fillRect(-W / 2 - W * 0.12, -L * 0.2, W * 0.12, L * 0.05)
    ctx.fillRect( W / 2,            -L * 0.2, W * 0.12, L * 0.05)
  }

  // ── headlights (lime green glow) ─────────────────────────────────────────
  const lw = W * 0.22
  const lh = Math.max(1.5, L * 0.035)
  ctx.fillStyle   = '#D4FC79'
  ctx.shadowColor = '#D4FC79'
  ctx.shadowBlur  = Math.max(4, W * 0.14)
  ctx.fillRect(-W / 2 + W * 0.08,      -L / 2 + lh * 0.4, lw, lh)
  ctx.fillRect( W / 2 - W * 0.08 - lw, -L / 2 + lh * 0.4, lw, lh)

  // ── tail lights (coral glow) ──────────────────────────────────────────────
  ctx.fillStyle   = '#FF6B9D'
  ctx.shadowColor = '#FF6B9D'
  ctx.fillRect(-W / 2 + W * 0.08,      L / 2 - lh * 1.4, lw, lh)
  ctx.fillRect( W / 2 - W * 0.08 - lw, L / 2 - lh * 1.4, lw, lh)
  ctx.shadowBlur = 0

  // ── heading chevron ───────────────────────────────────────────────────────
  ctx.fillStyle   = '#FF6B9D'
  ctx.shadowColor = '#FF6B9D'
  ctx.shadowBlur  = Math.max(5, W * 0.14)
  ctx.beginPath()
  ctx.moveTo(0, -L / 2 - Math.max(6, L * 0.14))
  ctx.lineTo(-Math.max(4, W * 0.28), -L / 2 - Math.max(2, L * 0.03))
  ctx.lineTo( Math.max(4, W * 0.28), -L / 2 - Math.max(2, L * 0.03))
  ctx.closePath()
  ctx.fill()
  ctx.shadowBlur = 0

  ctx.restore()
}
