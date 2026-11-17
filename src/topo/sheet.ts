/**
 * Mise en page d'un plan sur une feuille (A4 à A0), à l'échelle exacte.
 * Le même tracé sert à l'aperçu écran et au PDF vectoriel.
 *
 * Unité : le millimètre papier, origine en haut à gauche de la feuille.
 * Le dessin n'est jamais déformé pour tenir dans la feuille : s'il déborde,
 * `fitInfo` propose une autre échelle ou un autre format.
 */
import type { Extent } from '../core/types'
import { drawDisplayList, resolveColor, type DrawOptions, type Painter, type RGB, type TextFamily, type View } from '../render/painter'
import type { DisplayList } from '../render/scene'
import type { SituationMap } from '../render/situation'
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
  /** Encart « Plan de situation » (affiché par défaut). */
  showSituation?: boolean
  /** Échelle du plan de situation (dénominateur). */
  situationScale?: number
  /** Légende du plan de situation : avec l'échelle, ou « Sans Echelle ». */
  situationCaption?: 'echelle' | 'sans'
  /** Étiquette « Emplacement » reliée au terrain dans le plan de situation. */
  showEmplacement?: boolean
  /** Cadre extérieur autour de toute la feuille. */
  showBorder?: boolean
  /** Décimales des coordonnées du tableau (celles du fichier source). */
  coordDecimals?: number
}

export interface TableRow {
  label: string
  x: number
  y: number
}

export interface SheetContent {
  layers: { dl: DisplayList; visible: Uint8Array }[]
  extent: Extent
  parcel: Parcel | null
  legend: LegendItem[]
  /** Lignes du tableau des coordonnées (sinon : sommets de la parcelle). */
  table?: TableRow[] | null
  /** Extrait de carte du plan de situation, ou raison de son absence. */
  situation?: SituationMap | string | null
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
  /** Zone où le dessin est centré (le cadre, moins le bandeau du haut). */
  map: Rect
  /** Bandeau du haut (titre, flèche du nord, plan de situation), hauteur en mm. */
  band: number
  /** Plan de situation : image et légende. */
  situation: { image: Rect; caption: Rect } | null
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
  let band = 0
  let situation: SheetGeometry['situation'] = null
  if (spec.template === 'cameroun') {
    // Proportions relevées sur les plans cadastraux camerounais (A4 : cadre à 12,5 mm des
    // bords, 34 mm en haut, 32 mm en bas ; bandeau du haut sur 28,5 % du cadre).
    frame = { x: 12.5 * k, y: 34 * k, w: w - 25 * k, h: h - 66 * k }
    const used = spec.showNorth || spec.showSituation !== false || !!spec.info.titre || !!spec.info.beneficiaire
    band = used ? frame.h * 0.285 : 0
    map = { x: frame.x, y: frame.y + band, w: frame.w, h: frame.h - band }
    if (spec.showSituation !== false && band) {
      const left = frame.x + frame.w / 2
      const capH = Math.max(7, band * 0.135)
      situation = {
        image: { x: left, y: frame.y, w: frame.x + frame.w - left, h: band - capH },
        caption: { x: left, y: frame.y + band - capH, w: frame.x + frame.w - left, h: capH },
      }
    }
  } else if (spec.template === 'cartouche') {
    frame = { x: 10, y: 10, w: w - 20, h: h - 20 }
    const ch = 38 * k
    map = { x: frame.x, y: frame.y, w: frame.w, h: frame.h - ch }
    if (spec.showSituation !== false) {
      const box = { x: map.x + 4 * k, y: map.y + 4 * k, w: 52 * k, h: 40 * k }
      situation = { image: { x: box.x, y: box.y, w: box.w, h: box.h - 6 * k }, caption: { x: box.x, y: box.y + box.h - 6 * k, w: box.w, h: 6 * k } }
    }
  } else {
    frame = { x: 0, y: 0, w, h }
    map = frame
  }
  const mmPerUnit = (1000 / spec.scale) * spec.unit
  const cx = spec.center ? spec.center[0] : (extent[0] + extent[2]) / 2
  const cy = spec.center ? spec.center[1] : (extent[1] + extent[3]) / 2
  return { w, h, frame, map, band, situation, k, view: { cx, cy, scale: mmPerUnit, ox: map.x + map.w / 2, oy: map.y + map.h / 2 } }
}

/** Image du plan de situation (dimensions de la carte à produire). */
export function situationRect(g: Pick<SheetGeometry, 'situation'>): { image: Rect } | null {
  return g.situation ? { image: g.situation.image } : null
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

/**
 * Flèche du nord des plans cadastraux : longue flèche verticale au milieu du bandeau,
 * pointe en haut, cercle marqué N, queue épaisse. Le plan n'est pas tourné : le haut de la
 * feuille est le nord de la grille.
 */
function northArrow(p: Painter, x: number, top: number, bottom: number): void {
  const L = bottom - top
  const head = Math.min(9, L * 0.13)
  const r = Math.min(7.5, L * 0.11)
  const cy = top + L * 0.5
  // Pointe
  p.fillPolygon([[x, top, x - head * 0.18, top + head, x + head * 0.18, top + head]], BLACK, 1)
  // Tige fine jusqu'au cercle
  line(p, x, top + head * 0.9, x, cy - r, 0.35)
  // Cercle et N
  p.beginStroke(BLACK, 0.3)
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2
    const px = x + Math.cos(a) * r
    const py = cy + Math.sin(a) * r
    if (i === 0) p.moveTo(px, py)
    else p.lineTo(px, py)
  }
  p.endStroke()
  p.text(x, cy, r * 0.88, 0, 'N', 1, 2, BLACK, false, 'serif')
  // Queue épaisse, légèrement effilée
  const w0 = Math.max(0.9, r * 0.17)
  p.fillPolygon([[x - w0 / 2, cy + r, x + w0 / 2, cy + r, x + w0 * 0.3, bottom, x - w0 * 0.3, bottom]], BLACK, 1)
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

interface TableStyle {
  rowH: number
  cap: number
  widths: [number, number, number]
  head: string
  decimals: number
}

function drawTable(p: Painter, vertices: TableRow[], right: number, bottom: number, st: TableStyle, maxHeight: number): Rect {
  const { rowH, cap, widths, decimals } = st
  const total = widths[0] + widths[1] + widths[2]
  const maxRows = Math.max(1, Math.floor(maxHeight / rowH) - 2)
  const rows = vertices.slice(0, maxRows)
  const h = rowH * (rows.length + 2)
  const x = right - total
  const y = bottom - h
  const box = { x, y, w: total, h }
  whiteBox(p, box)
  rect(p, box, 0.25)
  p.text(x + total / 2, y + rowH / 2, cap, 0, 'Tableau des Coordonnées', 1, 2, BLACK)
  line(p, x, y + rowH, x + total, y + rowH, 0.2)
  const cols = [st.head, 'X', 'Y']
  let cx = x
  cols.forEach((c, i) => {
    p.text(cx + widths[i] / 2, y + rowH * 1.5, cap, 0, c, 1, 2, BLACK)
    cx += widths[i]
    if (i < 2) line(p, cx, y + rowH, cx, y + h, 0.15)
  })
  rows.forEach((v, r) => {
    const yy = y + rowH * (r + 2)
    line(p, x, yy, x + total, yy, 0.15)
    p.text(x + widths[0] / 2, yy + rowH / 2, cap, 0, plain(v.label), 1, 2, BLACK)
    p.text(x + widths[0] + widths[1] / 2, yy + rowH / 2, cap, 0, v.x.toFixed(decimals), 1, 2, BLACK)
    p.text(x + total - widths[2] / 2, yy + rowH / 2, cap, 0, v.y.toFixed(decimals), 1, 2, BLACK)
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

function situationBox(p: Painter, g: SheetGeometry, spec: SheetSpec, situation: SituationMap | string | null | undefined, ownBorder: boolean): void {
  const sit = g.situation
  if (!sit) return
  const k = g.k
  const { image, caption } = sit
  whiteBox(p, { x: image.x, y: image.y, w: image.w, h: image.h + caption.h })
  if (situation && typeof situation === 'object' && p.image) {
    p.save()
    p.clipRect(image.x, image.y, image.w, image.h)
    p.image(situation.canvas, image.x, image.y, image.w, image.h)
    p.restore()
  } else {
    const msg = typeof situation === 'string' ? situation : 'Chargement de la carte…'
    p.text(image.x + image.w / 2, image.y + image.h / 2, 2 * k, 0, plain(msg).slice(0, 70), 1, 2, BLACK)
  }
  // Légende sous la carte, dans son cadre
  rect(p, caption, 0.3)
  if (ownBorder) rect(p, { x: image.x, y: image.y, w: image.w, h: image.h }, 0.3)
  const scale = typeof situation === 'object' && situation ? situation.scale : (spec.situationScale ?? 10000)
  const label = spec.situationCaption === 'sans' ? 'Plan de Situation Sans Echelle' : 'Plan de Situation - Echelle 1/' + scale.toLocaleString('fr-FR').replace(/\s/g, ' ')
  p.text(caption.x + caption.w / 2, caption.y + caption.h / 2, Math.min(3.3 * k, caption.h * 0.42), 0, label, 1, 2, BLACK, false, 'serif')
}

/** Étiquette « Emplacement » à gauche de la flèche, reliée au terrain (centre de la carte). */
function emplacement(p: Painter, g: SheetGeometry, maxBottom: number): void {
  const sit = g.situation
  if (!sit) return
  const k = g.k
  const cap = 3.1 * k
  const tw = p.textWidth('Emplacement', cap, false, 'serif')
  const right = g.frame.x + g.frame.w * 0.465
  const box = { x: right - tw - 3 * k, y: g.frame.y + g.band * 0.17, w: tw + 3 * k, h: cap + 2.6 * k }
  if (box.y + box.h > maxBottom - 2) box.y = g.frame.y + 2 * k
  if (box.y + box.h > maxBottom - 2) return
  const target = [sit.image.x + sit.image.w / 2, sit.image.y + sit.image.h / 2]
  line(p, box.x + box.w, box.y + box.h, target[0], target[1], 0.25)
  whiteBox(p, box)
  rect(p, box, 0.3)
  p.text(box.x + box.w / 2, box.y + box.h / 2, cap, 0, 'Emplacement', 1, 2, BLACK, false, 'serif')
}

function multiline(p: Painter, text: string, x: number, y: number, cap: number, ha: number, bold = false, step = 1.75, family?: TextFamily): number {
  let yy = y
  for (const l of text.split('\n')) {
    if (l.trim()) p.text(x, yy, cap, 0, plain(l), ha, 0, BLACK, bold, family)
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
  if (spec.showBorder !== false && spec.template === 'cameroun') rect(p, { x: 3.5, y: 3.5, w: w - 7, h: h - 7 }, 0.3)

  if (spec.template === 'cameroun') {
    // En-tête : au centre la République, la devise et la ville ; à droite la localisation.
    const cx = w / 2
    p.text(cx, 13.5 * k, 3.5 * k, 0, plain(info.pays), 1, 0, BLACK, true, 'serif')
    p.text(cx, 18.2 * k, 1.6 * k, 0, plain(info.devise), 1, 0, BLACK, false, 'serif-italic')
    if (info.ville) p.text(cx, 25.4 * k, 3.6 * k, 0, plain(info.ville), 1, 0, BLACK, false, 'serif')
    if (info.reference) p.text(cx, 30.2 * k, 2.0 * k, 0, plain(info.reference), 1, 0, BLACK, false, 'serif')
    if (info.enteteGauche) multiline(p, info.enteteGauche, frame.x, 10 * k, 2.0 * k, 0, false, 1.9, 'serif')
    const right = [
      info.region && 'Région: ' + info.region,
      info.departement && 'Département: ' + info.departement,
      info.arrondissement && 'Arrondissement: ' + info.arrondissement,
      info.lieuDit && 'Lieu-dit: ' + info.lieuDit,
    ].filter(Boolean) as string[]
    right.forEach((t, i) => p.text(frame.x + frame.w - 1 * k, (13 + i * 5.6) * k, 2.4 * k, 0, plain(t), 2, 0, BLACK, false, 'serif'))

    // Bandeau du haut : titre à gauche, flèche du nord au milieu, plan de situation à droite
    const ax = frame.x + frame.w / 2
    const bandBottom = frame.y + g.band
    let titleTop = bandBottom
    if (info.titre || info.beneficiaire) {
      const cap = 3.3 * k
      const step = cap * 1.55
      const maxW = ax - frame.x - 12 * k
      const wrap = (txt: string, bold: boolean): string[] => {
        const out: string[] = []
        for (const para of txt.split('\n')) {
          let cur = ''
          for (const word of para.split(/\s+/)) {
            const next = cur ? cur + ' ' + word : word
            if (cur && p.textWidth(plain(next), cap, bold, 'serif') > maxW) {
              out.push(cur)
              cur = word
            } else cur = next
          }
          out.push(cur)
        }
        return out
      }
      const titleLines = info.titre ? wrap(info.titre, false) : []
      const benLines = info.beneficiaire ? wrap(info.beneficiaire, true) : []
      const n = titleLines.length + benLines.length
      let y = bandBottom - 10 * k - (n - 1) * step
      titleTop = y - cap - 2 * k
      const tx = frame.x + 5.2 * k
      whiteBox(p, { x: frame.x + 0.3, y: titleTop, w: ax - frame.x - 4 * k, h: n * step + 2 * k })
      for (const l of titleLines) {
        p.text(tx, y, cap, 0, plain(l), 0, 0, BLACK, false, 'serif')
        y += step
      }
      for (const l of benLines) {
        p.text(tx, y, cap * 1.08, 0, plain(l), 0, 0, BLACK, true, 'serif')
        const tw = p.textWidth(plain(l), cap * 1.08, true, 'serif')
        line(p, tx, y + 0.9 * k, tx + tw, y + 0.9 * k, 0.3)
        y += step
      }
    }
    if (spec.showSituation !== false && g.situation) {
      situationBox(p, g, spec, content.situation, !spec.showNorth)
      if (spec.showEmplacement !== false) emplacement(p, g, titleTop)
    }
    if (spec.showNorth) northArrow(p, ax, frame.y + 0.6, (g.situation ? g.situation.caption.y + g.situation.caption.h * 0.75 : bandBottom - 2 * k))

    // Pied de page : lieu et date à gauche, échelle au centre, mentions à droite
    const fy = frame.y + frame.h
    const place = info.arrondissement || info.ville
    const left = [place && info.date ? `${plain(place)} le ${info.date}` : info.date, info.geometre && 'Borné, levé et dressé par :', info.geometre].filter(Boolean) as string[]
    left.forEach((t, i) => p.text(frame.x + 1.5 * k, fy + (11.5 + i * 4.6) * k, 2.5 * k, 0, plain(t), 0, 0, BLACK, false, 'serif'))
    p.text(cx, fy + 13 * k, 5 * k, 0, 'Echelle: 1/' + spec.scale, 1, 0, BLACK, true, 'serif')
    const rightFoot = [...info.mentions.split('\n'), ...info.systeme.split('\n')].map((x) => x.trim()).filter(Boolean)
    rightFoot.forEach((t, i) => p.text(frame.x + frame.w - 4.5 * k, fy + (8 + i * 4.6) * k, 2.5 * k, 0, plain(t), 2, 0, BLACK, false, 'serif'))

    // Superficie sous le plan de situation, tableau à droite vers le bas, placés là où ils ne
    // cachent pas la parcelle (positions du modèle d'abord, puis d'autres emplacements libres).
    const obstacles: Rect[] = []
    if (content.parcel?.vertices.length) {
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const v of content.parcel.vertices) {
        const px = view.ox + (v.x - view.cx) * view.scale
        const py = view.oy - (v.y - view.cy) * view.scale
        x0 = Math.min(x0, px)
        x1 = Math.max(x1, px)
        y0 = Math.min(y0, py)
        y1 = Math.max(y1, py)
      }
      const m = 5 * k
      obstacles.push({ x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m })
    }
    const free = (r: Rect) => !obstacles.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y)
    /** Place libre la plus proche de la position du modèle, dans la zone du plan sous le bandeau. */
    const nearestFree = (w0: number, h0: number, px: number, py: number): [number, number] => {
      const inside = (x: number, y: number) => x >= frame.x + 2 * k && x + w0 <= frame.x + frame.w - 2 * k && y >= bandBottom + 2 * k && y + h0 <= frame.y + frame.h - 2 * k
      if (inside(px, py) && free({ x: px, y: py, w: w0, h: h0 })) return [px, py]
      let best: [number, number] | null = null
      let bestD = Infinity
      const step = 2.5 * k
      for (let y = bandBottom + 2 * k; y + h0 <= frame.y + frame.h - 2 * k; y += step) {
        for (let x = frame.x + 2 * k; x + w0 <= frame.x + frame.w - 2 * k; x += step) {
          const d = (x - px) ** 2 + (y - py) ** 2
          if (d < bestD && free({ x, y, w: w0, h: h0 })) {
            bestD = d
            best = [x, y]
          }
        }
      }
      return best ?? [px, py]
    }
    if (spec.showArea && content.parcel) {
      const s2 = 'Superficie = ' + formatArea(content.parcel.area)
      const cap = 5.0 * k
      const tw = p.textWidth(plain(s2), cap, true, 'serif')
      const bw = tw + 4 * k
      const bh = cap + 5 * k
      const ref = { x: frame.x + frame.w * 0.709 - bw / 2, y: bandBottom + frame.h * 0.092 - cap - 2 * k }
      const [bx, by] = nearestFree(bw, bh, ref.x, ref.y)
      const xc = bx + bw / 2
      const y = by + cap + 2 * k
      const boxAt = (_: [number, number]): Rect => ({ x: bx, y: by, w: bw, h: bh })
      whiteBox(p, boxAt([xc, y]))
      p.text(xc, y, cap, 0, s2, 1, 0, BLACK, true, 'serif')
      line(p, xc - tw / 2, y + 1.3 * k, xc + tw / 2, y + 1.3 * k, 0.4)
      obstacles.push(boxAt([xc, y]))
    }
    const rows = content.table?.length ? content.table : content.parcel?.vertices
    if (spec.showTable && rows?.length) {
      const st: TableStyle = { rowH: 2.4 * k, cap: 1.65 * k, widths: [8 * k, 18.3 * k, 18.3 * k], head: 'MAT', decimals: spec.coordDecimals ?? 3 }
      const tw = st.widths[0] + st.widths[1] + st.widths[2]
      const th = st.rowH * (Math.min(rows.length, Math.floor((frame.h * 0.55) / st.rowH) - 2) + 2)
      if (spec.showLegend && content.legend.length) obstacles.push({ x: frame.x, y: frame.y + frame.h - (4.6 * (content.legend.length + 1) + 7) * k, w: 70 * k, h: (4.6 * (content.legend.length + 1) + 7) * k })
      const [tx, ty] = nearestFree(tw, th, frame.x + frame.w - 10.3 * k - tw, frame.y + frame.h * 0.842 - th)
      drawTable(p, rows, tx + tw, ty + th, st, frame.h * 0.55)
    }
    if (spec.showLegend) drawLegend(p, content.legend, frame.x + 5 * k, frame.y + frame.h - 5 * k, k, colors)
    return g
  }

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
  p.text((c2 + frame.x + frame.w) / 2, cy + 10 * k, 3.6 * k, 0, 'Echelle : 1/' + spec.scale, 1, 0, BLACK, true)
  multiline(p, [info.systeme, 'Format ' + spec.paper].filter(Boolean).join('\n'), (c2 + frame.x + frame.w) / 2, cy + 22 * k, 1.8 * k, 1, false, 2.0)

  if (spec.showNorth) northArrow(p, map.x + map.w / 2, map.y + 4 * k, map.y + 30 * k)
  if (spec.showSituation !== false && g.situation) situationBox(p, g, spec, content.situation, true)
  if (spec.showArea && content.parcel) {
    const s2 = 'Superficie = ' + formatArea(content.parcel.area)
    const cap = 3.8 * k
    const tw = p.textWidth(s2, cap, true)
    const x = map.x + map.w - 8 * k
    const yy = map.y + 12 * k
    whiteBox(p, { x: x - tw - 2 * k, y: yy - cap - 2 * k, w: tw + 4 * k, h: cap + 5 * k })
    p.text(x, yy, cap, 0, s2, 2, 0, BLACK, true)
    line(p, x - tw, yy + 1.4 * k, x, yy + 1.4 * k, 0.4)
  }
  const bottom = map.y + map.h - 5 * k
  const rows = content.table?.length ? content.table : content.parcel?.vertices
  if (spec.showTable && rows?.length) drawTable(p, rows, map.x + map.w - 5 * k, bottom, { rowH: 4 * k, cap: 2 * k, widths: [13 * k, 24 * k, 24 * k], head: 'Borne', decimals: spec.coordDecimals ?? 3 }, map.h * 0.6)
  if (spec.showLegend) drawLegend(p, content.legend, map.x + 5 * k, bottom, k, colors)
  return g
}
