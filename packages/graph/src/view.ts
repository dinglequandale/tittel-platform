// Viewport and grid geometry (GRAPH-SPEC §3.3).
import type { Viewport } from './state.ts'

/** Default view: x ∈ [−10, 10] across the width, y scaled for a 1:1 aspect,
 *  centred on the origin [OBS]. */
export function defaultViewport(widthPx: number, heightPx: number): Viewport {
  const half = 10 * (heightPx / Math.max(1, widthPx))
  return { xmin: -10, xmax: 10, ymin: -half, ymax: half }
}

/** Major grid step ("nice": 1, 2, 5 × 10ⁿ) aiming for ~`targetPx` per step,
 *  plus the number of minor subdivisions: 4 for a 2-step, 5 otherwise.
 *  Observed: ±10 over ~860px → major 2, minor 0.5 [OBS]. */
export function gridStep(unitsPerPx: number, targetPx = 100): { major: number; minor: number } {
  const raw = unitsPerPx * targetPx
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  const mant = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10
  const major = mant * p
  return { major, minor: major / (mant === 2 ? 4 : 5) }
}

/** Axis label for a grid value: no floating-point noise (0.30000000000000004). */
export function gridLabel(v: number, step: number): string {
  if (Math.abs(v) < step * 1e-9) return '0'
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  if (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-5) {
    const e = Math.floor(Math.log10(Math.abs(v)))
    const m = Number((v / 10 ** e).toPrecision(6))
    return `${m}×10${superscript(e)}`
  }
  return v.toFixed(decimals).replace('-', '−')
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
const superscript = (n: number) => String(n).split('').map((c) => SUP[c]).join('')

/** Zoom about a point (math coordinates) by `factor` (>1 zooms out). */
export function zoomAbout(v: Viewport, cx: number, cy: number, factor: number): Viewport {
  return {
    xmin: cx + (v.xmin - cx) * factor,
    xmax: cx + (v.xmax - cx) * factor,
    ymin: cy + (v.ymin - cy) * factor,
    ymax: cy + (v.ymax - cy) * factor,
  }
}

/** Keep the x-range but re-fit y to the canvas aspect (after a resize). */
export function fitAspect(v: Viewport, widthPx: number, heightPx: number): Viewport {
  const cy = (v.ymin + v.ymax) / 2
  const half = ((v.xmax - v.xmin) / 2) * (heightPx / Math.max(1, widthPx))
  return { ...v, ymin: cy - half, ymax: cy + half }
}
