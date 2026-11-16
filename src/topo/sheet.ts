/**
 * Mise en page d'un plan sur une feuille (A4 à A0), à l'échelle exacte.
 * Le même tracé sert à l'aperçu écran et au PDF vectoriel.
 *
 * Unité : le millimètre papier, origine en haut à gauche de la feuille.
 * Le dessin n'est jamais déformé pour tenir dans la feuille : s'il déborde,
 * `fitInfo` propose une autre échelle ou un autre format.
 */
import type { Extent } from '../core/types'
import { drawDisplayList, resolveColor, type DrawOptions, type Painter, type RGB, type View } from '../render/painter'
import type { DisplayList } from '../render/scene'
import type { LegendItem, Parcel } from './generate'

export const PAPERS: Record<string, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  A0: [841, 1189],
}

export const SCALES = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000]

export type TemplateName = 'cameroun' | 'cartouche' | 'aucun'

export interface SheetInfo {
  pays: string
  devise: string
  ville: string
  /** Lignes libres en haut à gauche (ministère, ordre, cabinet…). */
  enteteGauche: string
  region: string
  departement: string
  arrondissement: string
  lieuDit: string
  /** Titre du plan (plusieurs lignes possibles). */
  titre: string
  /** Nom mis en valeur sous le titre (bénéficiaire, client). */
  beneficiaire: string
  geometre: string
  date: string
  reference: string
  /** Mention du système de coordonnées (plusieurs lignes possibles). */
  systeme: string
  /** Mentions libres en bas à droite. */
  mentions: string
}

export const EMPTY_INFO: SheetInfo = {
  pays: 'REPUBLIQUE DU CAMEROUN',
  devise: 'Paix - Travail - Patrie',
  ville: '',
  enteteGauche: '',
  region: '',
  departement: '',
  arrondissement: '',
  lieuDit: '',
  titre: '',
  beneficiaire: '',
  geometre: '',
  date: '',
  reference: '',
  systeme: '',
  mentions: '',
}

export interface SheetSpec {
  paper: string
  landscape: boolean
  /** Dénominateur de l'échelle. */
  scale: number
  template: TemplateName
  info: SheetInfo
  /** Centre du plan en coordonnées terrain (par défaut : centre de l'emprise). */
  center: [number, number] | null
  showGrid: boolean
  showNorth: boolean
  showTable: boolean
  showLegend: boolean
  showArea: boolean
  monochrome: boolean
  /** Mètres terrain par unité de dessin (1 si le dessin est en mètres). */
  unit: number
}

export interface SheetContent {
  layers: { dl: DisplayList; visible: Uint8Array }[]
  extent: Extent
  parcel: Parcel | null
  legend: LegendItem[]
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface SheetGeometry {
  w: number
  h: number
  /** Cadre du plan. */
  frame: Rect
  /** Zone utile pour le dessin à l'intérieur du cadre. */
  map: Rect
  /** Facteur d'agrandissement des textes d'habillage selon le format. */
  k: number
  view: View
}

const BLACK: RGB = [0, 0, 0]

export function paperSize(spec: Pick<SheetSpec, 'paper' | 'landscape'>): [number, number] {
  const [a, b] = PAPERS[spec.paper] ?? PAPERS.A4
  return spec.landscape ? [b, a] : [a, b]
}

export function sheetGeometry(spec: SheetSpec, extent: Extent): SheetGeometry {
  const [w, h] = paperSize(spec)
  const k = Math.min(2.4, Math.max(1, Math.sqrt((w * h) / (210 * 297)) * 0.85 + 0.15))
  let frame: Rect
  let map: Rect
  if (spec.template === 'cameroun') {
    const top = 6 + 22 * k
    const bottom = 6 + 20 * k
    frame = { x: 10, y: top, w: w - 20, h: h - top - bottom }
    const titleLines = spec.info.titre ? spec.info.titre.split('\n').length : 0
    const band = titleLines || spec.info.beneficiaire ? (titleLines * 5.2 + (spec.info.beneficiaire ? 7 : 0) + 6) * k : 0
    map = { x: frame.x, y: frame.y + band, w: frame.w, h: frame.h - band }
  } else if (spec.template === 'cartouche') {
    frame = { x: 10, y: 10, w: w - 20, h: h - 20 }
    const ch = 38 * k
    map = { x: frame.x, y: frame.y, w: frame.w, h: frame.h - ch }
  } else {
    frame = { x: 0, y: 0, w, h }
    map = frame
  }
  const mmPerUnit = (1000 / spec.scale) * spec.unit
  const cx = spec.center ? spec.center[0] : (extent[0] + extent[2]) / 2
  const cy = spec.center ? spec.center[1] : (extent[1] + extent[3]) / 2
  return { w, h, frame, map, k, view: { cx, cy, scale: mmPerUnit, ox: map.x + map.w / 2, oy: map.y + map.h / 2 } }
}

export interface FitInfo {
  fits: boolean
  /** Dimensions du dessin sur le papier à l'échelle demandée (mm). */
  needW: number
  needH: number
  availW: number
  availH: number
  /** Plus grande échelle normalisée qui tient sur ce format. */
  bestScale: number | null
  /** Plus petit format qui tient à cette échelle (même orientation), ou null. */
  bestPaper: string | null
}

export function fitInfo(spec: SheetSpec, extent: Extent): FitInfo {
  const need = (scale: number): [number, number] => [((extent[2] - extent[0]) * 1000 * spec.unit) / scale, ((extent[3] - extent[1]) * 1000 * spec.unit) / scale]
  const avail = (s: SheetSpec): [number, number] => {
    const g = sheetGeometry(s, extent)
    const margin = s.template === 'aucun' ? 0 : 6
    return [g.map.w - margin * 2, g.map.h - margin * 2]
  }
  const [needW, needH] = need(spec.scale)
  const [availW, availH] = avail(spec)
  const fits = needW <= availW && needH <= availH
  let bestScale: number | null = null
  for (const s of SCALES) {
    const [nw, nh] = need(s)
    if (nw <= availW && nh <= availH) {
      bestScale = s
      break
    }
  }
  let bestPaper: string | null = null
  for (const name of Object.keys(PAPERS)) {
    const [aw, ah] = avail({ ...spec, paper: name })
    if (needW <= aw && needH <= ah) {
      bestPaper = name
      break
    }
  }
  return { fits, needW, needH, availW, availH, bestScale, bestPaper }
}

/** Pas « rond » de quadrillage donnant environ 70 à 140 mm sur le papier. */
function gridStep(scale: number, unit: number): number {
  const target = (70 * scale) / 1000 / unit
  for (const base of [1, 2, 2.5, 5, 10]) {
    for (let p = -2; p < 7; p++) {
      const s = base * 10 ** p
      if (s >= target && s <= target * 2.6) return s
    }
  }
  return target
}

/** Remplace les caractères absents des polices PDF standard. */
export function plain(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
}

export function formatArea(m2: number): string {
  if (m2 >= 10000) {
    const ha = Math.floor(m2 / 10000)
    const a = Math.floor((m2 - ha * 10000) / 100)
    const ca = Math.round(m2 - ha * 10000 - a * 100)
    return `${ha} ha ${String(a).padStart(2, '0')} a ${String(ca).padStart(2, '0')} ca`
  }
  return Math.round(m2) + ' m²'
}

function line(p: Painter, x1: number, y1: number, x2: number, y2: number, width = 0.18, color: RGB = BLACK): void {
  p.beginStroke(color, width)
  p.moveTo(x1, y1)
  p.lineTo(x2, y2)
  p.endStroke()
}

function rect(p: Painter, r: Rect, width = 0.18): void {
  p.beginStroke(BLACK, width)
  p.moveTo(r.x, r.y)
  p.lineTo(r.x + r.w, r.y)
  p.lineTo(r.x + r.w, r.y + r.h)
  p.lineTo(r.x, r.y + r.h)
  p.closePath()
  p.endStroke()
}

function whiteBox(p: Painter, r: Rect): void {
  p.fillPolygon([[r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h]], [255, 255, 255], 1)
}

function northArrow(p: Painter, x: number, y: number, size: number): void {
  // Flèche vers le haut du papier : le plan n'est pas tourné, le haut est le nord de la grille.
  line(p, x, y + size, x, y, 0.35)
  p.fillPolygon([[x, y - size * 0.12, x - size * 0.11, y + size * 0.26, x, y + size * 0.16, x + size * 0.11, y + size * 0.26]], BLACK, 1)
  p.beginStroke(BLACK, 0.25)
  const r = size * 0.2
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2
    const px = x + Math.cos(a) * r
    const py = y + size * 0.62 + Math.sin(a) * r
    if (i === 0) p.moveTo(px, py)
    else p.lineTo(px, py)
  }
  p.endStroke()
  p.text(x + r + 1.2, y + size * 0.62, size * 0.2, 0, 'N', 0, 2, BLACK, true)
}

function drawGrid(p: Painter, spec: SheetSpec, g: SheetGeometry): void {
  const { frame, view, k } = g
  const step = gridStep(spec.scale, spec.unit)
  const x0 = view.cx + (frame.x - view.ox) / view.scale
  const x1 = view.cx + (frame.x + frame.w - view.ox) / view.scale
  const y1 = view.cy - (frame.y - view.oy) / view.scale
  const y0 = view.cy - (frame.y + frame.h - view.oy) / view.scale
  const xs: number[] = []
  const ys: number[] = []
  for (let v = Math.ceil(x0 / step) * step; v <= x1; v += step) xs.push(v)
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) ys.push(v)
  const px = (v: number) => view.ox + (v - view.cx) * view.scale
  const py = (v: number) => view.oy - (v - view.cy) * view.scale
  const cap = 1.7 * k
  // Les coordonnées sont cotées en kilomètres avec trois décimales, comme sur les plans cadastraux.
  const label = (v: number) => ((v * spec.unit) / 1000).toFixed(3)
  const arm = 2.2 * k
  for (const y of ys) {
    const yy = py(y)
    if (yy < frame.y + 3 || yy > frame.y + frame.h - 3) continue
    line(p, frame.x - 1.5, yy, frame.x + 2.5, yy, 0.25)
    line(p, frame.x + frame.w - 2.5, yy, frame.x + frame.w + 1.5, yy, 0.25)
    p.text(frame.x + 3.5, yy, cap, 0, label(y), 0, 2, BLACK)
    for (const x of xs) {
      const xx = px(x)
      if (xx < frame.x + 12 * k || xx > frame.x + frame.w - 4) continue
      line(p, xx - arm, yy, xx + arm, yy, 0.18)
      line(p, xx, yy - arm, xx, yy + arm, 0.18)
    }
  }
  for (const x of xs) {
    const xx = px(x)
    if (xx < frame.x + 12 * k || xx > frame.x + frame.w - 6) continue
    line(p, xx, frame.y + frame.h - 2.5, xx, frame.y + frame.h + 1.5, 0.25)
    line(p, xx, frame.y - 1.5, xx, frame.y + 2.5, 0.25)
    p.text(xx - 1, frame.y + frame.h - 3.5, cap, Math.PI / 2, label(x), 0, 0, BLACK)
  }
}

function drawTable(p: Painter, parcel: Parcel, right: number, bottom: number, k: number, maxHeight: number): Rect {
  const rowH = 4.0 * k
  const widths = [13 * k, 24 * k, 24 * k]
  const total = widths[0] + widths[1] + widths[2]
  const maxRows = Math.max(1, Math.floor(maxHeight / rowH) - 2)
  const rows = parcel.vertices.slice(0, maxRows)
  const h = rowH * (rows.length + 2)
  const x = right - total
  const y = bottom - h
  const box = { x, y, w: total, h }
  whiteBox(p, box)
  rect(p, box, 0.3)
  const cap = 2.0 * k
  p.text(x + total / 2, y + rowH / 2, cap, 0, 'Tableau des Coordonnées', 1, 2, BLACK, true)
  line(p, x, y + rowH, x + total, y + rowH, 0.25)
  const cols = ['Borne', 'X', 'Y']
  let cx = x
  cols.forEach((c, i) => {
    p.text(cx + widths[i] / 2, y + rowH * 1.5, cap, 0, c, 1, 2, BLACK, true)
    cx += widths[i]
    if (i < 2) line(p, cx, y + rowH, cx, y + h, 0.18)
  })
  rows.forEach((v, r) => {
    const yy = y + rowH * (r + 2)
    line(p, x, yy, x + total, yy, 0.18)
    p.text(x + widths[0] / 2, yy + rowH / 2, cap, 0, plain(v.label), 1, 2, BLACK)
    p.text(x + widths[0] + widths[1] - 1.2 * k, yy + rowH / 2, cap, 0, v.x.toFixed(3), 2, 2, BLACK)
    p.text(x + total - 1.2 * k, yy + rowH / 2, cap, 0, v.y.toFixed(3), 2, 2, BLACK)
  })
  return box
}

function drawLegend(p: Painter, legend: LegendItem[], x: number, bottom: number, k: number, opts: Pick<DrawOptions, 'foreground' | 'lightBackground' | 'monochrome'>): void {
  if (!legend.length) return
  const rowH = 4.6 * k
  const cap = 1.9 * k
  let width = p.textWidth('Légende', cap, true)
  for (const it of legend) width = Math.max(width, p.textWidth(plain(it.label), cap))
  const w = width + 16 * k
  const h = rowH * (legend.length + 1) + 2 * k
  const box = { x, y: bottom - h, w, h }
  whiteBox(p, box)
  rect(p, box, 0.3)
  p.text(x + 2 * k, box.y + rowH * 0.6, cap, 0, 'Légende', 0, 2, BLACK, true)
  legend.forEach((it, i) => {
    const yy = box.y + rowH * (i + 1.5) + 1 * k
    const color = resolveColor(it.color, opts)
    const sx = x + 2 * k
    if (it.kind === 'ligne' || it.kind === 'surface') {
      p.beginStroke(color, Math.max(0.18, it.lw))
      p.moveTo(sx, yy)
      p.lineTo(sx + 9 * k, yy)
      p.endStroke()
    } else {
      const c = sx + 4.5 * k
      const r = 0.9 * k
      p.beginStroke(color, 0.25)
      if (it.symbol === 'croix') {
        p.moveTo(c - r, yy)
        p.lineTo(c + r, yy)
        p.moveTo(c, yy - r)
        p.lineTo(c, yy + r)
      } else if (it.symbol === 'carre' || it.symbol === 'borne') {
        p.moveTo(c - r, yy - r)
        p.lineTo(c + r, yy - r)
        p.lineTo(c + r, yy + r)
        p.lineTo(c - r, yy + r)
        p.closePath()
      } else {
        for (let a = 0; a <= 24; a++) {
          const t = (a / 24) * Math.PI * 2
          if (a === 0) p.moveTo(c + r * Math.cos(t), yy + r * Math.sin(t))
          else p.lineTo(c + r * Math.cos(t), yy + r * Math.sin(t))
        }
      }
      p.endStroke()
    }
    p.text(sx + 12 * k, yy, cap, 0, plain(it.label), 0, 2, BLACK)
  })
}

function scaleBar(p: Painter, cx: number, y: number, spec: SheetSpec, k: number): void {
  // Barre graphique : longueur « ronde » proche de 40 mm papier.
  const target = (40 * k * spec.scale) / 1000
  let length = 1
  for (const base of [1, 2, 5]) for (let e = -1; e < 6; e++) if (base * 10 ** e <= target) length = Math.max(length, base * 10 ** e)
  const mm = (length * 1000) / spec.scale
  const x0 = cx - mm / 2
  const hbar = 1.2 * k
  for (let i = 0; i < 4; i++) {
    const r = { x: x0 + (mm / 4) * i, y, w: mm / 4, h: hbar }
    if (i % 2 === 0) p.fillPolygon([[r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h]], BLACK, 1)
  }
  rect(p, { x: x0, y, w: mm, h: hbar }, 0.2)
  const cap = 1.5 * k
  p.text(x0, y + hbar + 1 * k, cap, 0, '0', 1, 3, BLACK)
  p.text(x0 + mm / 2, y + hbar + 1 * k, cap, 0, String(length / 2), 1, 3, BLACK)
  p.text(x0 + mm, y + hbar + 1 * k, cap, 0, length + ' m', 1, 3, BLACK)
}

function multiline(p: Painter, text: string, x: number, y: number, cap: number, ha: number, bold = false, step = 1.75): number {
  let yy = y
  for (const l of text.split('\n')) {
    if (l.trim()) p.text(x, yy, cap, 0, plain(l), ha, 0, BLACK, bold)
    yy += cap * step
  }
  return yy
}

/** Trace la feuille complète : dessin à l'échelle, puis habillage. */
export function drawSheet(p: Painter, spec: SheetSpec, content: SheetContent): SheetGeometry {
  const g = sheetGeometry(spec, content.extent)
  const { frame, map, view, k, w, h } = g
  const info = spec.info
  const colors = { foreground: BLACK, lightBackground: true, monochrome: spec.monochrome }

  // 1. Le dessin, à l'échelle, découpé au cadre
  p.save()
  p.clipRect(frame.x, frame.y, frame.w, frame.h)
  const viewport: Extent = [
    view.cx + (frame.x - view.ox) / view.scale,
    view.cy - (frame.y + frame.h - view.oy) / view.scale,
    view.cx + (frame.x + frame.w - view.ox) / view.scale,
    view.cy - (frame.y - view.oy) / view.scale,
  ]
  for (const layer of content.layers) {
    drawDisplayList(p, layer.dl, view, {
      ...colors,
      lineWidth: (lw) => (lw > 0 ? Math.max(0.1, lw) : 0.18),
      pointRadius: 0.22,
      minText: 0.35,
      minSize: 0,
      viewport,
      layerVisible: layer.visible,
    })
  }
  p.restore()
  if (spec.template === 'aucun') return g

  if (spec.showGrid) drawGrid(p, spec, g)
  rect(p, frame, 0.5)

  if (spec.template === 'cameroun') {
    // En-tête
    const cx = w / 2
    let y = 9 + 1.5 * k
    p.text(cx, y, 3.0 * k, 0, plain(info.pays), 1, 0, BLACK, true)
    y += 4.2 * k
    p.text(cx, y, 1.7 * k, 0, plain(info.devise), 1, 0, BLACK)
    y += 5.2 * k
    if (info.ville) p.text(cx, y, 3.0 * k, 0, plain(info.ville), 1, 0, BLACK, true)
    if (info.reference) p.text(cx, y + 4.6 * k, 2.0 * k, 0, plain(info.reference), 1, 0, BLACK)
    if (info.enteteGauche) multiline(p, info.enteteGauche, 10, 8 + 1.5 * k, 1.8 * k, 0)
    const right = [
      info.region && 'Région : ' + info.region,
      info.departement && 'Département : ' + info.departement,
      info.arrondissement && 'Arrondissement : ' + info.arrondissement,
      info.lieuDit && 'Lieu-dit : ' + info.lieuDit,
    ].filter(Boolean) as string[]
    multiline(p, right.join('\n'), w - 10, 8 + 1.5 * k, 2.1 * k, 2, false, 2.1)

    // Titre dans le haut du cadre
    let ty = frame.y + 7 * k
    if (info.titre) {
      whiteBox(p, { x: frame.x + 0.4, y: frame.y + 0.4, w: frame.w - 0.8, h: map.y - frame.y - 0.4 })
      for (const l of info.titre.split('\n')) {
        p.text(frame.x + 8 * k, ty, 2.7 * k, 0, plain(l), 0, 0, BLACK)
        ty += 5.2 * k
      }
    }
    if (info.beneficiaire) {
      p.text(frame.x + 8 * k, ty + 1.5 * k, 3.4 * k, 0, plain(info.beneficiaire), 0, 0, BLACK, true)
      const tw = p.textWidth(plain(info.beneficiaire), 3.4 * k, true)
      line(p, frame.x + 8 * k, ty + 2.8 * k, frame.x + 8 * k + tw, ty + 2.8 * k, 0.35)
    }

    // Pied de page
    const fy = frame.y + frame.h + 6 * k
    const left = [info.ville && info.date ? `${info.ville}, le ${info.date}` : info.date, info.geometre && 'Borné, levé et dressé par :', info.geometre].filter(Boolean) as string[]
    multiline(p, left.join('\n'), 10, fy, 2.0 * k, 0, false, 2.0)
    p.text(cx, fy + 3.2 * k, 4.2 * k, 0, 'Echelle : 1/' + spec.scale, 1, 0, BLACK, true)
    scaleBar(p, cx, fy + 6.4 * k, spec, k)
    const rightFoot = [info.systeme, info.mentions].filter(Boolean).join('\n')
    multiline(p, rightFoot, w - 10, fy, 2.0 * k, 2, false, 2.0)
  } else {
    // Cartouche générique, en bas du cadre
    const ch = h - 10 - (map.y + map.h)
    const cy = map.y + map.h
    whiteBox(p, { x: frame.x + 0.3, y: cy, w: frame.w - 0.6, h: ch - 0.3 })
    line(p, frame.x, cy, frame.x + frame.w, cy, 0.5)
    const c1 = frame.x + frame.w * 0.56
    const c2 = frame.x + frame.w * 0.8
    line(p, c1, cy, c1, cy + ch, 0.3)
    line(p, c2, cy, c2, cy + ch, 0.3)
    let y = cy + 6 * k
    y = multiline(p, info.titre || 'PLAN TOPOGRAPHIQUE', frame.x + 4 * k, y, 3.0 * k, 0, true, 1.8)
    if (info.beneficiaire) p.text(frame.x + 4 * k, y + 1 * k, 2.2 * k, 0, plain('Client : ' + info.beneficiaire), 0, 0, BLACK)
    const place = [info.lieuDit, info.arrondissement, info.departement, info.region].filter(Boolean).join(', ')
    if (place) p.text(frame.x + 4 * k, y + 6 * k, 2.0 * k, 0, plain(place), 0, 0, BLACK)
    multiline(p, [info.geometre && 'Géomètre : ' + info.geometre, info.date && 'Date : ' + info.date, info.reference && 'Réf. : ' + info.reference].filter(Boolean).join('\n'), c1 + 3 * k, cy + 6 * k, 2.0 * k, 0, false, 2.2)
    p.text((c2 + frame.x + frame.w) / 2, cy + 8 * k, 3.6 * k, 0, 'Echelle : 1/' + spec.scale, 1, 0, BLACK, true)
    scaleBar(p, (c2 + frame.x + frame.w) / 2, cy + 11 * k, spec, k * 0.8)
    multiline(p, [info.systeme, 'Format ' + spec.paper].filter(Boolean).join('\n'), (c2 + frame.x + frame.w) / 2, cy + 22 * k, 1.8 * k, 1, false, 2.0)
  }

  // Éléments posés dans la zone du plan
  if (spec.showNorth) northArrow(p, map.x + 14 * k, map.y + 6 * k, 18 * k)
  if (spec.showArea && content.parcel) {
    const s = 'Superficie = ' + formatArea(content.parcel.area)
    const cap = 3.8 * k
    const tw = p.textWidth(s, cap, true)
    const x = map.x + map.w - 8 * k
    const y = map.y + 12 * k
    whiteBox(p, { x: x - tw - 2 * k, y: y - cap - 2 * k, w: tw + 4 * k, h: cap + 5 * k })
    p.text(x, y, cap, 0, s, 2, 0, BLACK, true)
    line(p, x - tw, y + 1.4 * k, x, y + 1.4 * k, 0.4)
  }
  const bottom = map.y + map.h - 5 * k
  if (spec.showTable && content.parcel) drawTable(p, content.parcel, map.x + map.w - 5 * k, bottom, k, map.h * 0.6)
  if (spec.showLegend) drawLegend(p, content.legend, map.x + 5 * k, bottom, k, colors)
  return g
}
