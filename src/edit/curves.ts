/**
 * Géométrie exacte des courbes planes (segments et arcs) pour ajuster, prolonger et
 * raccorder. Les arcs de polyligne (« bulges ») restent des arcs : aucune approximation
 * par facettes, les intersections sont calculées analytiquement.
 */
import type { EArc, ELine, EPolyline, Entity } from '../core/types'
import type { Pt } from './ops'

export type Prim =
  | { k: 'seg'; x0: number; y0: number; x1: number; y1: number }
  /** `sweep` signé en radians (positif = sens trigonométrique) ; cercle complet : 2π. */
  | { k: 'arc'; cx: number; cy: number; r: number; a0: number; sweep: number }

const TAU = Math.PI * 2
const EPS = 1e-9

function normAngle(a: number): number {
  a %= TAU
  return a < 0 ? a + TAU : a
}

/** Arc d'un segment de polyligne à bulge, du point 0 au point 1. */
export function bulgePrim(x0: number, y0: number, x1: number, y1: number, b: number): Prim {
  if (Math.abs(b) < 1e-12) return { k: 'seg', x0, y0, x1, y1 }
  const dx = x1 - x0
  const dy = y1 - y0
  const f = (1 - b * b) / (4 * b)
  const cx = (x0 + x1) / 2 - dy * f
  const cy = (y0 + y1) / 2 + dx * f
  return { k: 'arc', cx, cy, r: Math.hypot(x0 - cx, y0 - cy), a0: Math.atan2(y0 - cy, x0 - cx), sweep: 4 * Math.atan(b) }
}

/** Décomposition d'une entité en primitives (null si l'entité n'est pas une courbe). */
export function toPrims(e: Entity): { prims: Prim[]; closed: boolean } | null {
  switch (e.t) {
    case 'line':
      return { prims: [{ k: 'seg', x0: e.x1, y0: e.y1, x1: e.x2, y1: e.y2 }], closed: false }
    case 'pline': {
      const n = e.pts.length >> 1
      if (n < 2) return null
      const prims: Prim[] = []
      const count = e.closed ? n : n - 1
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % n
        prims.push(bulgePrim(e.pts[i * 2], e.pts[i * 2 + 1], e.pts[j * 2], e.pts[j * 2 + 1], e.bulges?.[i] ?? 0))
      }
      return { prims, closed: e.closed }
    }
    case 'polygon': {
      const r = e.rings[0]
      const n = r.length >> 1
      if (n < 3) return null
      const prims: Prim[] = []
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        prims.push({ k: 'seg', x0: r[i * 2], y0: r[i * 2 + 1], x1: r[j * 2], y1: r[j * 2 + 1] })
      }
      return { prims, closed: true }
    }
    case 'circle':
      return { prims: [{ k: 'arc', cx: e.cx, cy: e.cy, r: e.r, a0: 0, sweep: TAU }], closed: true }
    case 'arc': {
      let sweep = normAngle(e.a1 - e.a0)
      if (sweep < EPS) sweep = TAU
      return { prims: [{ k: 'arc', cx: e.cx, cy: e.cy, r: e.r, a0: e.a0, sweep }], closed: false }
    }
    default:
      return null
  }
}

/** Arêtes de coupe ou limites : toutes les primitives d'une entité (trous de surfaces compris). */
export function edgePrims(e: Entity): Prim[] {
  if (e.t === 'polygon') {
    const out: Prim[] = []
    for (const r of e.rings) {
      const n = r.length >> 1
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        out.push({ k: 'seg', x0: r[i * 2], y0: r[i * 2 + 1], x1: r[j * 2], y1: r[j * 2 + 1] })
      }
    }
    return out
  }
  return toPrims(e)?.prims ?? []
}

export function primPoint(p: Prim, t: number): Pt {
  if (p.k === 'seg') return [p.x0 + (p.x1 - p.x0) * t, p.y0 + (p.y1 - p.y0) * t]
  const a = p.a0 + p.sweep * t
  return [p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a)]
}

/** Paramètre t ∈ [0, 1] d'un angle sur un arc, ou null s'il est hors de l'arc. */
function arcParam(p: Extract<Prim, { k: 'arc' }>, ang: number): number | null {
  const s = Math.abs(p.sweep)
  if (s >= TAU - EPS) return normAngle(ang - p.a0) / TAU
  const u = normAngle(p.sweep > 0 ? ang - p.a0 : p.a0 - ang)
  if (u <= s + EPS) return Math.min(1, u / s)
  if (u >= TAU - EPS) return 0
  return null
}

/** Intersections droite (x0,y0)+s·(dx,dy) × cercle : valeurs de s. */
function lineCircle(x0: number, y0: number, dx: number, dy: number, cx: number, cy: number, r: number): number[] {
  const fx = x0 - cx
  const fy = y0 - cy
  const a = dx * dx + dy * dy
  const b = 2 * (fx * dx + fy * dy)
  const c = fx * fx + fy * fy - r * r
  const disc = b * b - 4 * a * c
  if (a === 0 || disc < -1e-12 * Math.max(1, b * b)) return []
  if (disc <= 0) return [-b / (2 * a)]
  const q = Math.sqrt(disc)
  return [(-b - q) / (2 * a), (-b + q) / (2 * a)]
}

/** Paramètres, sur la primitive `a`, de ses intersections avec `b`. */
export function intersectParams(a: Prim, b: Prim): number[] {
  const out: number[] = []
  const inRange = (t: number) => t >= -EPS && t <= 1 + EPS
  if (a.k === 'seg' && b.k === 'seg') {
    const dax = a.x1 - a.x0
    const day = a.y1 - a.y0
    const dbx = b.x1 - b.x0
    const dby = b.y1 - b.y0
    const den = dax * dby - day * dbx
    if (Math.abs(den) < 1e-14 * Math.max(1, dax * dax + day * day) * Math.max(1, dbx * dbx + dby * dby)) return out
    const t = ((b.x0 - a.x0) * dby - (b.y0 - a.y0) * dbx) / den
    const u = ((b.x0 - a.x0) * day - (b.y0 - a.y0) * dax) / den
    if (inRange(t) && inRange(u)) out.push(Math.max(0, Math.min(1, t)))
    return out
  }
  if (a.k === 'seg' && b.k === 'arc') {
    for (const t of lineCircle(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0, b.cx, b.cy, b.r)) {
      if (!inRange(t)) continue
      const [x, y] = primPoint(a, t)
      if (arcParam(b, Math.atan2(y - b.cy, x - b.cx)) !== null) out.push(Math.max(0, Math.min(1, t)))
    }
    return out
  }
  if (a.k === 'arc' && b.k === 'seg') {
    for (const s of lineCircle(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, a.cx, a.cy, a.r)) {
      if (!inRange(s)) continue
      const [x, y] = primPoint(b, s)
      const t = arcParam(a, Math.atan2(y - a.cy, x - a.cx))
      if (t !== null) out.push(t)
    }
    return out
  }
  if (a.k === 'arc' && b.k === 'arc') {
    const dx = b.cx - a.cx
    const dy = b.cy - a.cy
    const d = Math.hypot(dx, dy)
    if (d < 1e-12 || d > a.r + b.r + 1e-9 || d < Math.abs(a.r - b.r) - 1e-9) return out
    const l = (a.r * a.r - b.r * b.r + d * d) / (2 * d)
    const h = Math.sqrt(Math.max(0, a.r * a.r - l * l))
    const mx = a.cx + (dx * l) / d
    const my = a.cy + (dy * l) / d
    const cands: Pt[] = h < 1e-12 ? [[mx, my]] : [[mx - (dy * h) / d, my + (dx * h) / d], [mx + (dy * h) / d, my - (dx * h) / d]]
    for (const [x, y] of cands) {
      if (arcParam(b, Math.atan2(y - b.cy, x - b.cx)) === null) continue
      const t = arcParam(a, Math.atan2(y - a.cy, x - a.cx))
      if (t !== null) out.push(t)
    }
  }
  return out
}

/** Paramètre global (indice de primitive + t) du point de la courbe le plus proche de `p`. */
export function nearestParam(prims: Prim[], p: Pt): number {
  let best = Infinity
  let g = 0
  prims.forEach((q, i) => {
    let t: number
    if (q.k === 'seg') {
      const dx = q.x1 - q.x0
      const dy = q.y1 - q.y0
      const l2 = dx * dx + dy * dy
      t = l2 ? Math.max(0, Math.min(1, ((p[0] - q.x0) * dx + (p[1] - q.y0) * dy) / l2)) : 0
    } else {
      const ang = Math.atan2(p[1] - q.cy, p[0] - q.cx)
      const tt = arcParam(q, ang)
      if (tt !== null) t = tt
      else {
        const e0 = primPoint(q, 0)
        const e1 = primPoint(q, 1)
        t = Math.hypot(p[0] - e0[0], p[1] - e0[1]) <= Math.hypot(p[0] - e1[0], p[1] - e1[1]) ? 0 : 1
      }
    }
    const c = primPoint(q, t)
    const d = Math.hypot(c[0] - p[0], c[1] - p[1])
    if (d < best - 1e-12) {
      best = d
      g = i + t
    }
  })
  return g
}

/** Morceau de courbe entre deux paramètres globaux croissants : sommets et bulges. */
function piece(prims: Prim[], g0: number, g1: number): { pts: number[]; bulges: number[] } {
  const pts: number[] = []
  const bulges: number[] = []
  const first = Math.min(prims.length - 1, Math.floor(g0 + EPS))
  for (let i = first; i < prims.length && i < g1 - EPS; i++) {
    const ta = Math.max(0, g0 - i)
    const tb = Math.min(1, g1 - i)
    if (tb - ta < EPS) continue
    const q = prims[i]
    const a = primPoint(q, ta)
    if (!pts.length) pts.push(a[0], a[1])
    bulges.push(q.k === 'arc' ? Math.tan((q.sweep * (tb - ta)) / 4) : 0)
    const b = primPoint(q, tb)
    pts.push(b[0], b[1])
  }
  return { pts, bulges }
}

function concatPieces(a: { pts: number[]; bulges: number[] }, b: { pts: number[]; bulges: number[] }): { pts: number[]; bulges: number[] } {
  if (!a.pts.length) return b
  if (!b.pts.length) return a
  return { pts: [...a.pts, ...b.pts.slice(2)], bulges: [...a.bulges, ...b.bulges] }
}

/** Reconstitue une entité à partir d'un morceau, en gardant calque, couleur et attributs. */
function rebuild(src: Entity, prims: Prim[], part: { pts: number[]; bulges: number[] }): Entity | null {
  const n = part.pts.length >> 1
  if (n < 2) return null
  const base = { layer: src.layer, color: src.color, ...(src.lw !== undefined ? { lw: src.lw } : {}), ...(src.props ? { props: src.props } : {}) }
  if (src.t === 'line') {
    const l: ELine = { t: 'line', ...base, x1: part.pts[0], y1: part.pts[1], x2: part.pts[2], y2: part.pts[3] }
    return l
  }
  if ((src.t === 'arc' || src.t === 'circle') && prims[0].k === 'arc' && n === 2) {
    const q = prims[0]
    const s = part.bulges[0]
    const a = Math.atan2(part.pts[1] - q.cy, part.pts[0] - q.cx)
    const b = Math.atan2(part.pts[3] - q.cy, part.pts[2] - q.cx)
    const arc: EArc = { t: 'arc', ...base, cx: q.cx, cy: q.cy, r: q.r, a0: s >= 0 ? a : b, a1: s >= 0 ? b : a }
    return arc
  }
  const hasBulge = part.bulges.some((b) => Math.abs(b) > 1e-12)
  const pl: EPolyline = {
    t: 'pline',
    ...base,
    pts: Float64Array.from(part.pts),
    ...(hasBulge ? { bulges: Float64Array.from([...part.bulges, 0]) } : {}),
    closed: false,
    ...(src.t === 'pline' && src.elev !== undefined ? { elev: src.elev } : {}),
  }
  return pl
}

function sortedUnique(v: number[]): number[] {
  v.sort((a, b) => a - b)
  const out: number[] = []
  for (const x of v) if (!out.length || x - out[out.length - 1] > 1e-7) out.push(x)
  return out
}

/**
 * AJUSTER : supprime la partie de `target` désignée par `pick`, entre les deux intersections
 * qui l'encadrent. Renvoie les morceaux restants (vide = tout supprimé), ou null si aucune
 * arête de coupe ne croise la partie désignée.
 */
export function trimEntity(target: Entity, cutters: Prim[], pick: Pt): Entity[] | null {
  const tp = toPrims(target)
  if (!tp) return null
  const { prims, closed } = tp
  const N = prims.length
  const hits: number[] = []
  prims.forEach((q, i) => {
    for (const c of cutters) for (const t of intersectParams(q, c)) hits.push(i + t)
  })
  let G = sortedUnique(hits)
  if (closed && G.length && G[G.length - 1] > N - 1e-7) {
    // Le point de départ d'une courbe fermée est le même que son point d'arrivée.
    G = sortedUnique(G.map((g) => (g > N - 1e-7 ? 0 : g)))
  }
  const gp = nearestParam(prims, pick)
  if (!closed) {
    G = G.filter((g) => g > 1e-7 && g < N - 1e-7)
    const lower = [...G].reverse().find((g) => g < gp)
    const upper = G.find((g) => g > gp)
    if (lower === undefined && upper === undefined) return null
    const out: Entity[] = []
    if (lower !== undefined) {
      const e = rebuild(target, prims, piece(prims, 0, lower))
      if (e) out.push(e)
    }
    if (upper !== undefined) {
      const e = rebuild(target, prims, piece(prims, upper, N))
      if (e) out.push(e)
    }
    return out
  }
  if (G.length < 2) return null
  const lower = [...G].reverse().find((g) => g < gp) ?? G[G.length - 1]
  const upper = G.find((g) => g > gp) ?? G[0]
  if (target.t === 'circle') {
    // Le cercle devient l'arc restant, parcouru dans le sens trigonométrique.
    const { t: _t, ...rest } = target
    void _t
    return [{ ...rest, t: 'arc', a0: TAU * upper, a1: TAU * lower }]
  }
  // Le morceau conservé va de `upper` à `lower` dans le sens de parcours.
  const part = upper < lower ? piece(prims, upper, lower) : concatPieces(piece(prims, upper, N), piece(prims, 0, lower))
  const e = rebuild(target, prims, part)
  return e ? [e] : []
}

/** Intersections d'une demi-droite (origine, direction unitaire) : distances positives. */
function rayHits(o: Pt, d: Pt, limits: Prim[]): number[] {
  const out: number[] = []
  for (const q of limits) {
    if (q.k === 'seg') {
      const ex = q.x1 - q.x0
      const ey = q.y1 - q.y0
      const den = d[0] * ey - d[1] * ex
      if (Math.abs(den) < 1e-14) continue
      const s = ((q.x0 - o[0]) * ey - (q.y0 - o[1]) * ex) / den
      const u = ((q.x0 - o[0]) * d[1] - (q.y0 - o[1]) * d[0]) / den
      if (s > 1e-7 && u >= -EPS && u <= 1 + EPS) out.push(s)
    } else {
      for (const s of lineCircle(o[0], o[1], d[0], d[1], q.cx, q.cy, q.r)) {
        if (s <= 1e-7) continue
        if (arcParam(q, Math.atan2(o[1] + d[1] * s - q.cy, o[0] + d[0] * s - q.cx)) !== null) out.push(s)
      }
    }
  }
  return out
}

/**
 * PROLONGER : allonge l'extrémité de `target` la plus proche de `pick` jusqu'à la première
 * limite rencontrée. Lignes et polylignes ouvertes dont le segment d'extrémité est droit.
 */
export function extendEntity(target: Entity, limits: Prim[], pick: Pt): Entity | null {
  if (target.t !== 'line' && !(target.t === 'pline' && !target.closed)) return null
  const tp = toPrims(target)
  if (!tp) return null
  const { prims } = tp
  const N = prims.length
  const atEnd = nearestParam(prims, pick) > N / 2
  const q = prims[atEnd ? N - 1 : 0]
  if (q.k !== 'seg') return null
  const o: Pt = atEnd ? [q.x1, q.y1] : [q.x0, q.y0]
  const len = Math.hypot(q.x1 - q.x0, q.y1 - q.y0)
  if (len === 0) return null
  const d: Pt = atEnd ? [(q.x1 - q.x0) / len, (q.y1 - q.y0) / len] : [(q.x0 - q.x1) / len, (q.y0 - q.y1) / len]
  const hits = rayHits(o, d, limits)
  if (!hits.length) return null
  const s = Math.min(...hits)
  const p: Pt = [o[0] + d[0] * s, o[1] + d[1] * s]
  if (target.t === 'line') return atEnd ? { ...target, x2: p[0], y2: p[1] } : { ...target, x1: p[0], y1: p[1] }
  const pts = Float64Array.from(target.pts)
  const i = atEnd ? pts.length - 2 : 0
  pts[i] = p[0]
  pts[i + 1] = p[1]
  return { ...target, pts, zs: undefined }
}

export interface FilletResult {
  a: [Pt, Pt]
  b: [Pt, Pt]
  arc: { cx: number; cy: number; r: number; a0: number; a1: number } | null
}

/**
 * RACCORD entre deux lignes : chacune est coupée ou prolongée jusqu'au point de tangence
 * (ou jusqu'à leur intersection si r = 0) ; on garde le côté désigné par le clic.
 */
export function filletLines(a: [Pt, Pt], pickA: Pt, b: [Pt, Pt], pickB: Pt, r: number): FilletResult | string {
  const dax = a[1][0] - a[0][0]
  const day = a[1][1] - a[0][1]
  const dbx = b[1][0] - b[0][0]
  const dby = b[1][1] - b[0][1]
  const den = dax * dby - day * dbx
  if (Math.abs(den) < 1e-12 * Math.hypot(dax, day) * Math.hypot(dbx, dby)) return 'Les deux lignes sont parallèles.'
  const t = ((b[0][0] - a[0][0]) * dby - (b[0][1] - a[0][1]) * dbx) / den
  const I: Pt = [a[0][0] + dax * t, a[0][1] + day * t]
  const side = (l: [Pt, Pt], pick: Pt): { u: Pt; far: Pt } => {
    const dx = l[1][0] - l[0][0]
    const dy = l[1][1] - l[0][1]
    const len = Math.hypot(dx, dy)
    let u: Pt = [dx / len, dy / len]
    if ((pick[0] - I[0]) * u[0] + (pick[1] - I[1]) * u[1] < 0) u = [-u[0], -u[1]]
    const p0 = (l[0][0] - I[0]) * u[0] + (l[0][1] - I[1]) * u[1]
    const p1 = (l[1][0] - I[0]) * u[0] + (l[1][1] - I[1]) * u[1]
    return { u, far: p0 >= p1 ? l[0] : l[1] }
  }
  const A = side(a, pickA)
  const B = side(b, pickB)
  if (r <= 0) return { a: [A.far, I], b: [B.far, I], arc: null }
  const cos = Math.max(-1, Math.min(1, A.u[0] * B.u[0] + A.u[1] * B.u[1]))
  const theta = Math.acos(cos)
  if (theta < 1e-9 || Math.PI - theta < 1e-9) return 'Angle nul ou plat : raccord impossible.'
  const tl = r / Math.tan(theta / 2)
  const reachA = (A.far[0] - I[0]) * A.u[0] + (A.far[1] - I[1]) * A.u[1]
  const reachB = (B.far[0] - I[0]) * B.u[0] + (B.far[1] - I[1]) * B.u[1]
  if (tl > reachA + 1e-9 || tl > reachB + 1e-9) return `Rayon trop grand : la tangence tomberait hors des lignes (${tl.toFixed(3)} m depuis le sommet).`
  const TA: Pt = [I[0] + A.u[0] * tl, I[1] + A.u[1] * tl]
  const TB: Pt = [I[0] + B.u[0] * tl, I[1] + B.u[1] * tl]
  const bx = A.u[0] + B.u[0]
  const by = A.u[1] + B.u[1]
  const bl = Math.hypot(bx, by)
  const dc = r / Math.sin(theta / 2)
  const C: Pt = [I[0] + (bx / bl) * dc, I[1] + (by / bl) * dc]
  const aa = Math.atan2(TA[1] - C[1], TA[0] - C[0])
  const ab = Math.atan2(TB[1] - C[1], TB[0] - C[0])
  const ccw = (TA[0] - C[0]) * (TB[1] - C[1]) - (TA[1] - C[1]) * (TB[0] - C[0]) > 0
  return { a: [A.far, TA], b: [B.far, TB], arc: { cx: C[0], cy: C[1], r, a0: ccw ? aa : ab, a1: ccw ? ab : aa } }
}

/**
 * RACCORD de tous les angles d'une polyligne (segments droits) : chaque sommet est remplacé
 * par un arc tangent de rayon r. Un sommet est laissé tel quel si le rayon ne tient pas.
 */
export function filletPolyline(pts: ArrayLike<number>, closed: boolean, r: number): { pts: number[]; bulges: number[]; done: number; skipped: number } {
  const n = pts.length >> 1
  const P = (i: number): Pt => [pts[((i + n) % n) * 2], pts[((i + n) % n) * 2 + 1]]
  const outPts: number[] = []
  const outB: number[] = []
  let done = 0
  let skipped = 0
  for (let i = 0; i < n; i++) {
    const v = P(i)
    const interior = closed || (i > 0 && i < n - 1)
    if (!interior || r <= 0) {
      outPts.push(v[0], v[1])
      outB.push(0)
      continue
    }
    const p = P(i - 1)
    const q = P(i + 1)
    const l1 = Math.hypot(p[0] - v[0], p[1] - v[1])
    const l2 = Math.hypot(q[0] - v[0], q[1] - v[1])
    if (l1 === 0 || l2 === 0) {
      outPts.push(v[0], v[1])
      outB.push(0)
      continue
    }
    const u1: Pt = [(p[0] - v[0]) / l1, (p[1] - v[1]) / l1]
    const u2: Pt = [(q[0] - v[0]) / l2, (q[1] - v[1]) / l2]
    const theta = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])))
    const tl = theta > 1e-9 && Math.PI - theta > 1e-9 ? r / Math.tan(theta / 2) : Infinity
    // Chaque segment peut porter deux raccords : chacun en utilise au plus la moitié.
    const lim1 = closed || i - 1 > 0 ? l1 / 2 : l1
    const lim2 = closed || i + 1 < n - 1 ? l2 / 2 : l2
    if (!(tl <= lim1 + 1e-9 && tl <= lim2 + 1e-9)) {
      if (Math.PI - theta > 1e-9) skipped++
      outPts.push(v[0], v[1])
      outB.push(0)
      continue
    }
    const left = (v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0]) > 0
    const sweep = Math.PI - theta
    outPts.push(v[0] + u1[0] * tl, v[1] + u1[1] * tl, v[0] + u2[0] * tl, v[1] + u2[1] * tl)
    outB.push(Math.tan(sweep / 4) * (left ? 1 : -1), 0)
    done++
  }
  return { pts: outPts, bulges: outB, done, skipped }
}
