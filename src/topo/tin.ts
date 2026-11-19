/**
 * Modèle numérique de terrain (MNT) et courbes de niveau.
 *
 * Méthode (celle des logiciels de topographie de référence, MNT « TIN ») :
 *  - triangulation de Delaunay aux prédicats géométriques exacts (Shewchuk) ;
 *  - contrainte par les lignes de rupture (talus, fossés, bords de route…) : chaque
 *    segment de rupture devient un côté de triangle, aucun triangle ne le traverse ;
 *  - interpolation linéaire sur chaque facette (plan passant par ses trois sommets) ;
 *  - courbes de niveau = intersection exacte des facettes et des plans horizontaux.
 *
 * Rien n'est estimé hors des points : les grands triangles de bordure sont écartés et
 * comptés, les conflits (deux altitudes au même endroit, ruptures qui se croisent) sont
 * signalés au lieu d'être tranchés en silence. Un contrôle indépendant vérifie chaque
 * sommet de courbe contre le modèle.
 */
import Constrainautor from '@kninnug/constrainautor'
import Delaunator from 'delaunator'
import { orient2d } from 'robust-predicates'

export interface Tin {
  /** x,y,z par sommet. */
  xs: Float64Array
  ys: Float64Array
  zs: Float64Array
  /** Indices de sommets, trois par triangle. */
  triangles: Uint32Array
  /** Triangles écartés car trop étirés (zone non couverte par le levé). */
  discarded: number
  maxEdge: number
  /** Segments de rupture intégrés comme côtés de triangles. */
  constrained: number
  /** Anomalies relevées pendant la construction, à montrer à l'utilisateur. */
  conflicts: string[]
}

export interface TerrainPoint {
  x: number
  y: number
  z: number | null
  /** Nom du point (pour les messages). */
  id?: string
}

export interface TinOptions {
  /** Longueur d'arête maximale ; au-delà, le triangle est écarté. 0 ou absent : automatique ; Infinity : tout garder. */
  maxEdge?: number
  /** Lignes de rupture : polylignes 3D dont chaque segment devient un côté de triangle. */
  breaklines?: TerrainPoint[][]
  /** Contour extérieur facultatif (x,y,…) : les triangles dont le centre est dehors sont écartés. */
  boundary?: ArrayLike<number>
}

function pointInRing(x: number, y: number, ring: ArrayLike<number>): boolean {
  let inside = false
  const n = ring.length >> 1
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]
    const yi = ring[i * 2 + 1]
    const xj = ring[j * 2]
    const yj = ring[j * 2 + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Les segments [a,b] et [c,d] se coupent-ils en un point intérieur aux deux (prédicats exacts) ? */
function properCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o1 = orient2d(ax, ay, bx, by, cx, cy)
  const o2 = orient2d(ax, ay, bx, by, dx, dy)
  const o3 = orient2d(cx, cy, dx, dy, ax, ay)
  const o4 = orient2d(cx, cy, dx, dy, bx, by)
  return o1 * o2 < 0 && o3 * o4 < 0
}

export function buildTin(points: TerrainPoint[], options: TinOptions = {}): Tin | null {
  const conflicts: string[] = []
  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  const names: string[] = []
  const index = new Map<string, number>()
  // Un sommet par position (au dixième de millimètre). Deux altitudes différentes au même
  // endroit sont un conflit : la première est gardée et le conflit est signalé.
  const vertex = (p: TerrainPoint): number | null => {
    if (p.z === null || !Number.isFinite(p.z) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
    const key = Math.round(p.x * 10000) + ':' + Math.round(p.y * 10000)
    const found = index.get(key)
    if (found !== undefined) {
      if (Math.abs(zs[found] - p.z) > 1e-9 && conflicts.length < 50) {
        conflicts.push(`Deux altitudes au même endroit : ${names[found] || 'sommet'} (${zs[found]}) et ${p.id || 'sommet'} (${p.z}) — la première est retenue.`)
      }
      return found
    }
    index.set(key, xs.length)
    xs.push(p.x)
    ys.push(p.y)
    zs.push(p.z)
    names.push(p.id ?? '')
    return xs.length - 1
  }
  for (const p of points) vertex(p)
  // Segments de rupture (indices de sommets)
  const segs: [number, number][] = []
  for (const line of options.breaklines ?? []) {
    let prev: number | null = null
    for (const p of line) {
      const v = vertex(p)
      if (v === null) {
        prev = null
        continue
      }
      if (prev !== null && prev !== v) segs.push([prev, v])
      prev = v
    }
  }
  const n = xs.length
  if (n < 3) return null
  // Coordonnées recentrées : la triangulation reste exacte avec de grandes coordonnées.
  const ox = xs[0]
  const oy = ys[0]
  const flat = new Float64Array(n * 2)
  for (let i = 0; i < n; i++) {
    flat[i * 2] = xs[i] - ox
    flat[i * 2 + 1] = ys[i] - oy
  }
  const d = new Delaunator(flat)
  if (!d.triangles.length) return null

  // Contraintes : on écarte (en le signalant) un segment qui en croise un autre ou qui
  // passe par un autre sommet — l'altitude y serait ambiguë.
  let constrained = 0
  if (segs.length) {
    const kept: [number, number][] = []
    const seen = new Set<string>()
    for (const [a, b] of segs) {
      const key = a < b ? a + ':' + b : b + ':' + a
      if (seen.has(key)) continue
      seen.add(key)
      const ax = flat[a * 2]
      const ay = flat[a * 2 + 1]
      const bx = flat[b * 2]
      const by = flat[b * 2 + 1]
      const crossing = kept.find(([c, e]) => c !== a && c !== b && e !== a && e !== b && properCross(ax, ay, bx, by, flat[c * 2], flat[c * 2 + 1], flat[e * 2], flat[e * 2 + 1]))
      if (crossing) {
        if (conflicts.length < 50) conflicts.push(`Lignes de rupture qui se croisent (${names[a] || a}–${names[b] || b} et ${names[crossing[0]] || crossing[0]}–${names[crossing[1]] || crossing[1]}) : le second segment n’est pas imposé.`)
        continue
      }
      let through = -1
      const minx = Math.min(ax, bx)
      const maxx = Math.max(ax, bx)
      const miny = Math.min(ay, by)
      const maxy = Math.max(ay, by)
      for (let v = 0; v < n && through < 0; v++) {
        if (v === a || v === b) continue
        const vx = flat[v * 2]
        const vy = flat[v * 2 + 1]
        if (vx < minx || vx > maxx || vy < miny || vy > maxy) continue
        if (orient2d(ax, ay, bx, by, vx, vy) === 0) through = v
      }
      if (through >= 0) {
        if (conflicts.length < 50) conflicts.push(`La rupture ${names[a] || a}–${names[b] || b} passe exactement sur le point ${names[through] || through} : coupez-la à ce point pour l’imposer.`)
        continue
      }
      kept.push([a, b])
    }
    if (kept.length) {
      const con = new Constrainautor(d)
      for (const [a, b] of kept) {
        try {
          con.constrainOne(a, b)
          constrained++
        } catch {
          if (conflicts.length < 50) conflicts.push(`Rupture ${names[a] || a}–${names[b] || b} non imposée (géométrie dégénérée).`)
        }
      }
    }
  }

  const tri = d.triangles
  const edge = (a: number, b: number) => Math.hypot(xs[a] - xs[b], ys[a] - ys[b])
  let maxEdge = options.maxEdge ?? 0
  if (!maxEdge) {
    const lengths: number[] = []
    for (let t = 0; t < tri.length; t += 3) lengths.push(edge(tri[t], tri[t + 1]), edge(tri[t + 1], tri[t + 2]), edge(tri[t + 2], tri[t]))
    lengths.sort((a, b) => a - b)
    const median = lengths[lengths.length >> 1] || 1
    maxEdge = median * 6
  }
  const kept: number[] = []
  let discarded = 0
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t]
    const b = tri[t + 1]
    const c = tri[t + 2]
    if (edge(a, b) > maxEdge || edge(b, c) > maxEdge || edge(c, a) > maxEdge) {
      discarded++
      continue
    }
    if (options.boundary && options.boundary.length >= 6) {
      const gx = (xs[a] + xs[b] + xs[c]) / 3
      const gy = (ys[a] + ys[b] + ys[c]) / 3
      if (!pointInRing(gx, gy, options.boundary)) {
        discarded++
        continue
      }
    }
    kept.push(a, b, c)
  }
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys), zs: Float64Array.from(zs), triangles: Uint32Array.from(kept), discarded, maxEdge, constrained, conflicts }
}

// ---------------------------------------------------------------------------
// Localisation rapide d'un point dans le MNT
// ---------------------------------------------------------------------------

/** Grille d'accès aux triangles : altitude en un point sans parcourir tout le modèle. */
export class TinLocator {
  private cell: number
  private x0: number
  private y0: number
  private nx: number
  private ny: number
  private buckets: Uint32Array[]

  constructor(readonly tin: Tin) {
    const { xs, ys, triangles } = tin
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i < xs.length; i++) {
      x0 = Math.min(x0, xs[i])
      x1 = Math.max(x1, xs[i])
      y0 = Math.min(y0, ys[i])
      y1 = Math.max(y1, ys[i])
    }
    const nt = Math.max(1, triangles.length / 3)
    const side = Math.max(1, Math.ceil(Math.sqrt(nt / 2)))
    this.cell = Math.max((x1 - x0) / side, (y1 - y0) / side, 1e-6)
    this.x0 = x0
    this.y0 = y0
    this.nx = Math.max(1, Math.ceil((x1 - x0) / this.cell) + 1)
    this.ny = Math.max(1, Math.ceil((y1 - y0) / this.cell) + 1)
    const lists: number[][] = Array.from({ length: this.nx * this.ny }, () => [])
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t]
      const b = triangles[t + 1]
      const c = triangles[t + 2]
      const i0 = Math.floor((Math.min(xs[a], xs[b], xs[c]) - x0) / this.cell)
      const i1 = Math.floor((Math.max(xs[a], xs[b], xs[c]) - x0) / this.cell)
      const j0 = Math.floor((Math.min(ys[a], ys[b], ys[c]) - y0) / this.cell)
      const j1 = Math.floor((Math.max(ys[a], ys[b], ys[c]) - y0) / this.cell)
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lists[j * this.nx + i].push(t)
    }
    this.buckets = lists.map((l) => Uint32Array.from(l))
  }

  /** Altitude interpolée linéairement sur la facette qui contient (x, y), ou null hors du MNT. */
  elevation(x: number, y: number): number | null {
    const i = Math.floor((x - this.x0) / this.cell)
    const j = Math.floor((y - this.y0) / this.cell)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return null
    const { xs, ys, zs, triangles } = this.tin
    for (const t of this.buckets[j * this.nx + i]) {
      const a = triangles[t]
      const b = triangles[t + 1]
      const c = triangles[t + 2]
      const z = facetZ(xs, ys, zs, a, b, c, x, y)
      if (z !== null) return z
    }
    return null
  }
}

/** Altitude sur la facette (a, b, c) si (x, y) est dedans (bords compris), sinon null. */
function facetZ(xs: Float64Array, ys: Float64Array, zs: Float64Array, a: number, b: number, c: number, x: number, y: number): number | null {
  const d = (ys[b] - ys[c]) * (xs[a] - xs[c]) + (xs[c] - xs[b]) * (ys[a] - ys[c])
  if (d === 0) return null
  const u = ((ys[b] - ys[c]) * (x - xs[c]) + (xs[c] - xs[b]) * (y - ys[c])) / d
  const v = ((ys[c] - ys[a]) * (x - xs[c]) + (xs[a] - xs[c]) * (y - ys[c])) / d
  const w = 1 - u - v
  const eps = 1e-12
  if (u < -eps || v < -eps || w < -eps) return null
  return u * zs[a] + v * zs[b] + w * zs[c]
}

const locators = new WeakMap<Tin, TinLocator>()

/** Altitude interpolée dans le modèle (null hors de la zone triangulée). */
export function elevationAt(tin: Tin, x: number, y: number): number | null {
  let loc = locators.get(tin)
  if (!loc) locators.set(tin, (loc = new TinLocator(tin)))
  return loc.elevation(x, y)
}

// ---------------------------------------------------------------------------
// Courbes de niveau
// ---------------------------------------------------------------------------

export interface Contour {
  z: number
  /** x,y,… */
  pts: number[]
  closed: boolean
}

/** Nombre de décimales d'une équidistance (0.25 → 2). */
export function intervalDecimals(interval: number): number {
  for (let d = 0; d <= 6; d++) if (Math.abs(Math.round(interval * 10 ** d) - interval * 10 ** d) < 1e-9) return d
  return 6
}

/** Altitude exacte de la k-ième courbe : k × équidistance, sans erreur d'arrondi binaire cumulée. */
export function levelValue(k: number, interval: number): number {
  const d = intervalDecimals(interval)
  const step = Math.round(interval * 10 ** d)
  return (k * step) / 10 ** d
}

/**
 * Courbes de niveau du modèle, à l'équidistance donnée. Chaque sommet de courbe est
 * l'intersection exacte d'un côté de triangle avec le plan horizontal ; un sommet du MNT
 * exactement à l'altitude d'une courbe est traité comme « au-dessus » (règle de
 * perturbation symbolique), ce qui garde des courbes continues et sans branche fantôme.
 */
export function contours(tin: Tin, interval: number): Contour[] {
  if (!(interval > 0)) return []
  const { xs, ys, zs, triangles } = tin
  let zmin = Infinity
  let zmax = -Infinity
  for (let i = 0; i < zs.length; i++) {
    if (zs[i] < zmin) zmin = zs[i]
    if (zs[i] > zmax) zmax = zs[i]
  }
  const out: Contour[] = []
  const first = Math.ceil(zmin / interval - 1e-9)
  const last = Math.floor(zmax / interval + 1e-9)
  if (last - first > 5000) return []
  const n = xs.length
  for (let k = first; k <= last; k++) {
    const level = levelValue(k, interval)
    const above = (i: number) => zs[i] >= level
    const links = new Map<number, number[]>()
    const pos = new Map<number, [number, number]>()
    const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a)
    const cut = (a: number, b: number): number => {
      const kk = key(a, b)
      if (!pos.has(kk)) {
        // Interpolation toujours faite depuis le sommet le plus bas : résultat identique
        // quel que soit le triangle qui partage le côté.
        const lo = zs[a] <= zs[b] ? a : b
        const hi = lo === a ? b : a
        const t = (level - zs[lo]) / (zs[hi] - zs[lo])
        pos.set(kk, [xs[lo] + (xs[hi] - xs[lo]) * t, ys[lo] + (ys[hi] - ys[lo]) * t])
      }
      return kk
    }
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t]
      const b = triangles[t + 1]
      const c = triangles[t + 2]
      const ia = above(a)
      const ib = above(b)
      const ic = above(c)
      if (ia === ib && ib === ic) continue
      const cuts: number[] = []
      if (ia !== ib) cuts.push(cut(a, b))
      if (ib !== ic) cuts.push(cut(b, c))
      if (ic !== ia) cuts.push(cut(c, a))
      if (cuts.length !== 2) continue
      const [p, q] = cuts
      let lp = links.get(p)
      if (!lp) links.set(p, (lp = []))
      lp.push(q)
      let lq = links.get(q)
      if (!lq) links.set(q, (lq = []))
      lq.push(p)
    }
    const visited = new Set<number>()
    const walk = (start: number): number[] => {
      const chain = [start]
      visited.add(start)
      let cur = start
      for (;;) {
        const next = (links.get(cur) ?? []).find((x) => !visited.has(x))
        if (next === undefined) break
        visited.add(next)
        chain.push(next)
        cur = next
      }
      return chain
    }
    const emit = (chain: number[], closed: boolean) => {
      const pts: number[] = []
      for (const kk of chain) {
        const p = pos.get(kk)!
        const m = pts.length
        // Points confondus (sommet du MNT exactement à l'altitude) : un seul.
        if (m && pts[m - 2] === p[0] && pts[m - 1] === p[1]) continue
        pts.push(p[0], p[1])
      }
      if (closed && pts.length >= 4 && pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1]) pts.length -= 2
      if (pts.length >= 4) out.push({ z: level, pts, closed: closed && pts.length >= 6 })
    }
    for (const [kk, l] of links) if (l.length === 1 && !visited.has(kk)) emit(walk(kk), false)
    for (const kk of links.keys()) if (!visited.has(kk)) emit(walk(kk), true)
  }
  return out
}

/**
 * Lissage d'affichage : courbe de Catmull-Rom centripète qui passe exactement par les
 * sommets calculés (ils restent sur le MNT) et ajoute des points intermédiaires. Entre deux
 * sommets, la courbe s'écarte légèrement du modèle linéaire : l'écart est mesuré par
 * `smoothingDeviation` et doit être affiché.
 */
export function smooth(pts: number[], closed: boolean, perSegment = 4): number[] {
  const n = pts.length >> 1
  if (n < 3) return pts.slice()
  const P = (i: number): [number, number] => {
    const j = closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))
    return [pts[j * 2], pts[j * 2 + 1]]
  }
  const out: number[] = []
  const count = closed ? n : n - 1
  for (let i = 0; i < count; i++) {
    const p0 = P(i - 1)
    const p1 = P(i)
    const p2 = P(i + 1)
    const p3 = P(i + 2)
    out.push(p1[0], p1[1])
    const d01 = Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])) || 1e-9
    const d12 = Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])) || 1e-9
    const d23 = Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])) || 1e-9
    const t0 = 0
    const t1 = t0 + d01
    const t2 = t1 + d12
    const t3 = t2 + d23
    for (let s = 1; s < perSegment; s++) {
      const t = t1 + ((t2 - t1) * s) / perSegment
      const lerp = (a: [number, number], b: [number, number], ta: number, tb: number): [number, number] => {
        const u = (tb - t) / (tb - ta)
        const v = (t - ta) / (tb - ta)
        return [a[0] * u + b[0] * v, a[1] * u + b[1] * v]
      }
      const a1 = lerp(p0, p1, t0, t1)
      const a2 = lerp(p1, p2, t1, t2)
      const a3 = lerp(p2, p3, t2, t3)
      const b1 = lerp(a1, a2, t0, t2)
      const b2 = lerp(a2, a3, t1, t3)
      const c = lerp(b1, b2, t1, t2)
      out.push(c[0], c[1])
    }
  }
  if (!closed) out.push(pts[pts.length - 2], pts[pts.length - 1])
  return out
}

/** Plus grand écart vertical entre une courbe (lissée) et le MNT, en mètres. */
export function smoothingDeviation(tin: Tin, level: number, pts: ArrayLike<number>): number {
  let max = 0
  for (let i = 0; i < pts.length; i += 2) {
    const z = elevationAt(tin, pts[i], pts[i + 1])
    if (z !== null) max = Math.max(max, Math.abs(z - level))
  }
  return max
}

export interface ContourCheck {
  vertices: number
  /** Plus grand écart entre l'altitude du MNT sous un sommet de courbe et la cote de la courbe. */
  maxError: number
  /** Croisements entre courbes de cotes différentes (impossible sur un MNT correct). */
  crossings: number
}

/**
 * Contrôle indépendant des courbes : altitude du MNT recalculée sous chaque sommet (par la
 * facette qui le contient) et recherche de croisements entre courbes de cotes différentes.
 */
export function checkContours(tin: Tin, list: Contour[]): ContourCheck {
  let vertices = 0
  let maxError = 0
  for (const c of list) {
    for (let i = 0; i < c.pts.length; i += 2) {
      const z = elevationAt(tin, c.pts[i], c.pts[i + 1])
      vertices++
      if (z !== null) maxError = Math.max(maxError, Math.abs(z - c.z))
    }
  }
  // Croisements : grille de segments
  type Seg = { x0: number; y0: number; x1: number; y1: number; z: number }
  const segs: Seg[] = []
  let gx0 = Infinity
  let gy0 = Infinity
  let gx1 = -Infinity
  let gy1 = -Infinity
  for (const c of list) {
    const m = c.pts.length >> 1
    const count = c.closed ? m : m - 1
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % m
      const s = { x0: c.pts[i * 2], y0: c.pts[i * 2 + 1], x1: c.pts[j * 2], y1: c.pts[j * 2 + 1], z: c.z }
      segs.push(s)
      gx0 = Math.min(gx0, s.x0, s.x1)
      gx1 = Math.max(gx1, s.x0, s.x1)
      gy0 = Math.min(gy0, s.y0, s.y1)
      gy1 = Math.max(gy1, s.y0, s.y1)
    }
  }
  let crossings = 0
  if (segs.length) {
    const side = Math.max(1, Math.ceil(Math.sqrt(segs.length / 4)))
    const cell = Math.max((gx1 - gx0) / side, (gy1 - gy0) / side, 1e-6)
    const nx = Math.ceil((gx1 - gx0) / cell) + 1
    const grid = new Map<number, number[]>()
    segs.forEach((s, idx) => {
      const i0 = Math.floor((Math.min(s.x0, s.x1) - gx0) / cell)
      const i1 = Math.floor((Math.max(s.x0, s.x1) - gx0) / cell)
      const j0 = Math.floor((Math.min(s.y0, s.y1) - gy0) / cell)
      const j1 = Math.floor((Math.max(s.y0, s.y1) - gy0) / cell)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const k = j * nx + i
          let l = grid.get(k)
          if (!l) grid.set(k, (l = []))
          l.push(idx)
        }
    })
    const seen = new Set<string>()
    for (const l of grid.values()) {
      for (let a = 0; a < l.length; a++)
        for (let b = a + 1; b < l.length; b++) {
          const s = segs[l[a]]
          const t = segs[l[b]]
          if (s.z === t.z) continue
          const key = l[a] < l[b] ? l[a] + ':' + l[b] : l[b] + ':' + l[a]
          if (seen.has(key)) continue
          seen.add(key)
          if (properCross(s.x0, s.y0, s.x1, s.y1, t.x0, t.y0, t.x1, t.y1)) crossings++
        }
    }
  }
  return { vertices, maxError, crossings }
}
