/**
 * Tracé d'une liste d'affichage vers une cible quelconque (écran, PDF).
 * La cible implémente `Painter` ; les coordonnées qu'elle reçoit sont déjà dans
 * son unité (pixels pour l'écran, millimètres pour le papier).
 */
import { FOREGROUND, type Color, type Extent } from '../core/types'
import type { DisplayList, TextPrim } from './scene'

export type RGB = [number, number, number]

export interface Painter {
  beginStroke(color: RGB, width: number, dash?: number[]): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  endStroke(): void
  fillPolygon(rings: number[][], color: RGB, alpha: number): void
  /** Disque plein (symbole de point). */
  dot(x: number, y: number, radius: number, color: RGB): void
  /**
   * Texte. `capHeight` : hauteur des majuscules dans l'unité de la cible ;
   * `rot` en radians, sens trigonométrique ; ha 0/1/2 = gauche/centre/droite ;
   * va 0/1/2/3 = ligne de base/bas/milieu/haut.
   */
  text(x: number, y: number, capHeight: number, rot: number, text: string, ha: number, va: number, color: RGB, bold?: boolean): void
  /** Largeur d'un texte d'une ligne, dans l'unité de la cible. */
  textWidth(text: string, capHeight: number, bold?: boolean): number
  save(): void
  clipRect(x: number, y: number, w: number, h: number): void
  restore(): void
}

/** Transformation monde → cible : le point monde (cx, cy) est placé en (ox, oy). */
export interface View {
  cx: number
  cy: number
  /** Unités de la cible par unité du monde. */
  scale: number
  ox: number
  oy: number
}

export function toOut(v: View, x: number, y: number): [number, number] {
  return [v.ox + (x - v.cx) * v.scale, v.oy - (y - v.cy) * v.scale]
}

export function toWorld(v: View, px: number, py: number): [number, number] {
  return [v.cx + (px - v.ox) / v.scale, v.cy - (py - v.oy) / v.scale]
}

export interface DrawOptions {
  /** Couleur de premier plan (ACI 7) : blanc sur fond sombre, noir sur papier. */
  foreground: RGB
  /** Fond clair : les couleurs trop pâles sont assombries pour rester lisibles. */
  lightBackground: boolean
  /** Tout en noir (tracé monochrome). */
  monochrome?: boolean
  /** Largeur de trait dans l'unité cible pour une épaisseur donnée en mm. */
  lineWidth(lwMm: number): number
  /** Rayon des symboles de point dans l'unité cible. */
  pointRadius: number
  /** Hauteur de texte minimale tracée (unité cible). */
  minText: number
  /** Taille minimale d'un objet tracé (unité cible). */
  minSize: number
  /** Nombre maximal de textes tracés (écran). */
  maxTexts?: number
  /** Zone visible, en coordonnées monde. */
  viewport: Extent
  /** Visibilité par calque (index de calque de la liste). */
  layerVisible: Uint8Array
  /** Tracer aussi les surfaces. */
  fills?: boolean
}

export function resolveColor(color: Color, o: Pick<DrawOptions, 'foreground' | 'lightBackground' | 'monochrome'>): RGB {
  if (o.monochrome) return [0, 0, 0]
  if (color === FOREGROUND || color < 0) return o.foreground
  let r = (color >> 16) & 255
  let g = (color >> 8) & 255
  let b = color & 255
  if (o.lightBackground) {
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    if (lum > 0.95) return [0, 0, 0]
    if (lum > 0.62) {
      const k = 0.62 / lum
      r = Math.round(r * k)
      g = Math.round(g * k)
      b = Math.round(b * k)
    }
  } else {
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    if (lum < 0.12) return [200, 200, 200]
  }
  return [r, g, b]
}

/** Trace une liste d'affichage. Renvoie le nombre de primitives tracées. */
export function drawDisplayList(p: Painter, dl: DisplayList, v: View, o: DrawOptions): number {
  const [vx0, vy0, vx1, vy1] = o.viewport
  const s = v.scale
  const { cx, cy, ox, oy } = v
  let drawn = 0

  if (o.fills !== false) {
    for (const f of dl.fills) {
      if (!o.layerVisible[f.layer]) continue
      const b = f.bbox
      if (b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1) continue
      if (Math.max(b[2] - b[0], b[3] - b[1]) * s < o.minSize) continue
      const rings = f.rings.map((r) => {
        const out = new Array<number>(r.length)
        for (let i = 0; i < r.length; i += 2) {
          out[i] = ox + (r[i] - cx) * s
          out[i + 1] = oy - (r[i + 1] - cy) * s
        }
        return out
      })
      p.fillPolygon(rings, resolveColor(f.color, o), f.alpha)
      drawn++
    }
  }

  const coords = dl.coords
  const start = dl.polyStart
  const box = dl.polyBox
  for (const batch of dl.batches) {
    let open = false
    const ids = batch.ids
    for (let k = 0; k < ids.length; k++) {
      const i = ids[k]
      if (!o.layerVisible[dl.polyLayer[i]]) continue
      const b = i * 4
      if (box[b + 2] < vx0 || box[b] > vx1 || box[b + 3] < vy0 || box[b + 1] > vy1) continue
      const size = Math.max(box[b + 2] - box[b], box[b + 3] - box[b + 1]) * s
      if (size < o.minSize) continue
      if (!open) {
        p.beginStroke(resolveColor(batch.color, o), o.lineWidth(batch.lw))
        open = true
      }
      const from = start[i] * 2
      const to = start[i + 1] * 2
      p.moveTo(ox + (coords[from] - cx) * s, oy - (coords[from + 1] - cy) * s)
      for (let j = from + 2; j < to; j += 2) p.lineTo(ox + (coords[j] - cx) * s, oy - (coords[j + 1] - cy) * s)
      if (dl.polyClosed[i]) p.closePath()
      drawn++
    }
    if (open) p.endStroke()
  }

  const pts = dl.points
  for (let i = 0; i < pts.length; i += 2) {
    const k = i >> 1
    if (!o.layerVisible[dl.pointLayer[k]]) continue
    const x = pts[i]
    const y = pts[i + 1]
    if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue
    p.dot(ox + (x - cx) * s, oy - (y - cy) * s, o.pointRadius, resolveColor(dl.pointColor[k], o))
    drawn++
  }

  let texts = 0
  const max = o.maxTexts ?? Infinity
  for (const t of dl.texts) {
    if (!o.layerVisible[t.layer]) continue
    const h = t.h * s
    if (h < o.minText) continue
    const reach = t.h * Math.max(4, t.text.length)
    if (t.x + reach < vx0 || t.x - reach > vx1 || t.y + reach < vy0 || t.y - reach > vy1) continue
    if (++texts > max) break
    drawText(p, t, v, o)
    drawn++
  }
  return drawn
}

export function drawText(p: Painter, t: TextPrim, v: View, o: Pick<DrawOptions, 'foreground' | 'lightBackground' | 'monochrome'>): void {
  p.text(v.ox + (t.x - v.cx) * v.scale, v.oy - (t.y - v.cy) * v.scale, t.h * v.scale, t.rot, t.text, t.ha, t.va, resolveColor(t.color, o))
}

// ---------------------------------------------------------------------------
// Cible écran (Canvas 2D)
// ---------------------------------------------------------------------------

/** Rapport hauteur des majuscules / corps de la police (Arial, Helvetica). */
export const CAP_RATIO = 0.716
/** Interligne des textes multilignes, en hauteurs de texte. */
export const LINE_SPACING = 1.6

export class CanvasPainter implements Painter {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private font = 'Arial, Helvetica, sans-serif',
  ) {}

  beginStroke(color: RGB, width: number, dash?: number[]): void {
    const c = this.ctx
    c.beginPath()
    c.strokeStyle = `rgb(${color[0]},${color[1]},${color[2]})`
    c.lineWidth = width
    c.lineJoin = 'round'
    c.lineCap = 'round'
    c.setLineDash(dash ?? [])
  }
  moveTo(x: number, y: number): void {
    this.ctx.moveTo(x, y)
  }
  lineTo(x: number, y: number): void {
    this.ctx.lineTo(x, y)
  }
  closePath(): void {
    this.ctx.closePath()
  }
  endStroke(): void {
    this.ctx.stroke()
  }
  fillPolygon(rings: number[][], color: RGB, alpha: number): void {
    const c = this.ctx
    c.beginPath()
    for (const r of rings) {
      c.moveTo(r[0], r[1])
      for (let i = 2; i < r.length; i += 2) c.lineTo(r[i], r[i + 1])
      c.closePath()
    }
    c.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha})`
    c.fill('evenodd')
  }
  dot(x: number, y: number, radius: number, color: RGB): void {
    const c = this.ctx
    c.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`
    c.beginPath()
    c.arc(x, y, radius, 0, Math.PI * 2)
    c.fill()
  }
  text(x: number, y: number, capHeight: number, rot: number, text: string, ha: number, va: number, color: RGB, bold?: boolean): void {
    const c = this.ctx
    const em = capHeight / CAP_RATIO
    c.save()
    c.translate(x, y)
    if (rot) c.rotate(-rot)
    c.font = `${bold ? 'bold ' : ''}${em}px ${this.font}`
    c.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`
    c.textAlign = ha === 1 ? 'center' : ha === 2 ? 'right' : 'left'
    c.textBaseline = 'alphabetic'
    const lines = text.indexOf('\n') >= 0 ? text.split('\n') : [text]
    const step = capHeight * LINE_SPACING
    const block = capHeight + step * (lines.length - 1)
    // Décalage de la première ligne de base par rapport au point d'ancrage (vers le bas, en positif).
    let y0 = 0
    if (va === 3) y0 = capHeight
    else if (va === 2) y0 = capHeight - block / 2
    else if (va === 1) y0 = -(block - capHeight) - capHeight * 0.3
    else y0 = -(block - capHeight)
    for (let i = 0; i < lines.length; i++) c.fillText(lines[i], 0, y0 + i * step)
    c.restore()
  }
  textWidth(text: string, capHeight: number, bold?: boolean): number {
    this.ctx.font = `${bold ? 'bold ' : ''}${capHeight / CAP_RATIO}px ${this.font}`
    return this.ctx.measureText(text).width
  }
  save(): void {
    this.ctx.save()
  }
  clipRect(x: number, y: number, w: number, h: number): void {
    this.ctx.beginPath()
    this.ctx.rect(x, y, w, h)
    this.ctx.clip()
  }
  restore(): void {
    this.ctx.restore()
  }
}
