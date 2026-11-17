/**
 * Contour d'une parcelle à partir de ses bornes. Une superficie n'a de sens que pour un
 * polygone simple (sans côtés qui se croisent) : l'ordre de parcours est donc contrôlé,
 * et proposé quand celui du fichier ou de la numérotation donne un contour croisé.
 *
 * Convention de numérotation des plans cadastraux : B.1 est la borne la plus au nord,
 * puis on tourne dans le sens des aiguilles d'une montre.
 */

export interface BorneInput {
  /** Nom tel qu'il figure dans le fichier. */
  id: string
  x: number
  y: number
}

export interface BorneVertex {
  label: string
  x: number
  y: number
  /** Nom d'origine dans le fichier. */
  source: string
}

export type OrderMode = 'numeros' | 'fichier' | 'nord-horaire'

/** Numéro d'une borne (« B.12 », « B12 », « 12 », « BR-12 » → 12), ou null. */
export function borneNumber(id: string): number | null {
  const m = /(\d+)\s*[a-z]?\s*$/i.exec(id.trim())
  return m ? parseInt(m[1], 10) : null
}

export const isBorneLabel = (id: string) => /^B[.\s-]?\d+[A-Za-z]?$/i.test(id.trim())

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

/** Les segments [p1,p2] et [p3,p4] se coupent-ils (contact compris) ? */
function segmentsIntersect(p1: BorneInput, p2: BorneInput, p3: BorneInput, p4: BorneInput): boolean {
  const d1 = cross(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y)
  const d2 = cross(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y)
  const d3 = cross(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y)
  const d4 = cross(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  const on = (a: BorneInput, b: BorneInput, c: BorneInput, d: number) => Math.abs(d) < 1e-9 && Math.min(a.x, b.x) - 1e-9 <= c.x && c.x <= Math.max(a.x, b.x) + 1e-9 && Math.min(a.y, b.y) - 1e-9 <= c.y && c.y <= Math.max(a.y, b.y) + 1e-9
  return on(p3, p4, p1, d1) || on(p3, p4, p2, d2) || on(p1, p2, p3, d3) || on(p1, p2, p4, d4)
}

/** Paires de côtés qui se croisent (indices des côtés i → i+1). */
export function crossings(poly: BorneInput[]): [number, number][] {
  const n = poly.length
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segmentsIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) out.push([i, j])
    }
  }
  return out
}

export function isSimple(poly: BorneInput[]): boolean {
  return poly.length >= 3 && crossings(poly).length === 0
}

/** Aire signée (positive : sens trigonométrique), calculée en coordonnées recentrées. */
export function signedArea(poly: { x: number; y: number }[]): number {
  if (poly.length < 3) return 0
  const ox = poly[0].x
  const oy = poly[0].y
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += (p.x - ox) * (q.y - oy) - (q.x - ox) * (p.y - oy)
  }
  return a / 2
}

/**
 * Ordre sans croisement : tri angulaire autour du centre de gravité, puis suppression des
 * croisements restants par inversion de tronçons (2-opt), qui raccourcit le périmètre.
 */
export function simpleOrder<T extends BorneInput>(pts: T[]): T[] {
  const n = pts.length
  if (n < 4) return [...pts]
  const cx = pts.reduce((s, p) => s + p.x, 0) / n
  const cy = pts.reduce((s, p) => s + p.y, 0) / n
  let order = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  for (let guard = 0; guard < n * n * 4; guard++) {
    const c = crossings(order)
    if (!c.length) break
    const [i, j] = c[0]
    order = [...order.slice(0, i + 1), ...order.slice(i + 1, j + 1).reverse(), ...order.slice(j + 1)]
  }
  return order
}

/** Sens des aiguilles d'une montre, en commençant par la borne la plus au nord. */
export function clockwiseFromNorth<T extends BorneInput>(poly: T[]): T[] {
  let p = [...poly]
  if (signedArea(p) > 0) p.reverse()
  let start = 0
  for (let i = 1; i < p.length; i++) if (p[i].y > p[start].y + 1e-9 || (Math.abs(p[i].y - p[start].y) <= 1e-9 && p[i].x < p[start].x)) start = i
  p = [...p.slice(start), ...p.slice(0, start)]
  return p
}

export interface ParcelProposal {
  mode: OrderMode
  label: string
  vertices: BorneVertex[]
  simple: boolean
  area: number
  perimeter: number
}

function finish(mode: OrderMode, label: string, list: BorneInput[], relabel: boolean, prefix: string): ParcelProposal {
  const vertices = list.map((p, i) => ({ label: relabel ? prefix + (i + 1) : p.id.trim() || prefix + (i + 1), x: p.x, y: p.y, source: p.id }))
  let perimeter = 0
  for (let i = 0; i < list.length; i++) {
    const q = list[(i + 1) % list.length]
    perimeter += Math.hypot(q.x - list[i].x, q.y - list[i].y)
  }
  return { mode, label, vertices, simple: isSimple(list), area: Math.abs(signedArea(list)), perimeter }
}

/**
 * Propositions d'ordre de parcours : numérotation du fichier (si toutes les bornes sont
 * numérotées), ordre du fichier, et contour sans croisement numéroté B.1 au nord puis
 * sens horaire. La recommandée est la première proposition valide de cette liste.
 */
export function parcelProposals(bornes: BorneInput[], prefix = 'B.'): { proposals: ParcelProposal[]; recommended: OrderMode } {
  const proposals: ParcelProposal[] = []
  const nums = bornes.map((b) => borneNumber(b.id))
  const numbered = nums.every((n) => n !== null) && new Set(nums).size === nums.length
  if (numbered) {
    const sorted = [...bornes].sort((a, b) => (borneNumber(a.id) as number) - (borneNumber(b.id) as number))
    proposals.push(finish('numeros', 'Noms du fichier, dans l’ordre des numéros', sorted, false, prefix))
  }
  proposals.push(finish('fichier', 'Ordre des lignes du fichier', bornes, !bornes.every((b) => b.id.trim()), prefix))
  proposals.push(finish('nord-horaire', 'Contour sans croisement, renuméroté B.1 au nord puis sens horaire', clockwiseFromNorth(simpleOrder(bornes)), true, prefix))
  const byNames = proposals.find((p) => p.mode === 'numeros')
  // Les noms du géomètre sont respectés s'ils donnent un contour valide ; sinon on propose le contour corrigé.
  const recommended: OrderMode = byNames?.simple && bornes.every((b) => isBorneLabel(b.id)) ? 'numeros' : 'nord-horaire'
  return { proposals, recommended }
}
