/**
 * Modèle numérique de terrain par triangulation de Delaunay, et courbes de niveau.
 * Calculs déterministes : aucune valeur n'est estimée hors de la zone couverte par
 * les points (les grands triangles de bordure sont écartés et comptés).
 */
import Delaunator from 'delaunator'

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
}

export interface TinOptions {
  /** Longueur d'arête maximale ; au-delà, le triangle est écarté. Par défaut : automatique. */
  maxEdge?: number
}

export function buildTin(points: { x: number; y: number; z: number | null }[], options: TinOptions = {}): Tin | null {
  // Un seul point par position (au millimètre) : le premier rencontré.
  const seen = new Set<string>()
  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  for (const p of points) {
    if (p.z === null || !Number.isFinite(p.z)) continue
    const key = Math.round(p.x * 1000) + ':' + Math.round(p.y * 1000)
    if (seen.has(key)) continue
    seen.add(key)
    xs.push(p.x)
    ys.push(p.y)
    zs.push(p.z)
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
    if (edge(a, b) > maxEdge || edge(b, c) > maxEdge || edge(c, a) > maxEdge) discarded++
    else kept.push(a, b, c)
  }
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys), zs: Float64Array.from(zs), triangles: Uint32Array.from(kept), discarded, maxEdge }
}

export interface Contour {
  z: number
  /** x,y,… */
  pts: number[]
  closed: boolean
}

/** Courbes de niveau du modèle, à l'équidistance donnée. */
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
    const level = k * interval
    // Un sommet exactement au niveau est considéré comme juste au-dessus : pas de cas dégénéré.
    const above = (i: number) => zs[i] >= level
    // Chaque arête coupée a un point d'intersection unique ; un triangle relie deux arêtes.
    const links = new Map<number, number[]>()
    const pos = new Map<number, [number, number]>()
    const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a)
    const cut = (a: number, b: number): number => {
      const kk = key(a, b)
      if (!pos.has(kk)) {
        const t = (level - zs[a]) / (zs[b] - zs[a])
        pos.set(kk, [xs[a] + (xs[b] - xs[a]) * t, ys[a] + (ys[b] - ys[a]) * t])
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
    // Chaînage des segments en polylignes
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
      if (chain.length < 2) return
      const pts: number[] = []
      for (const kk of chain) {
        const p = pos.get(kk)!
        pts.push(p[0], p[1])
      }
      out.push({ z: level, pts, closed })
    }
    // D'abord les courbes ouvertes (extrémités à un seul voisin), puis les fermées.
    for (const [kk, l] of links) if (l.length === 1 && !visited.has(kk)) emit(walk(kk), false)
    for (const kk of links.keys()) if (!visited.has(kk)) emit(walk(kk), true)
  }
  return out
}

/** Lissage de Chaikin (cosmétique : les sommets calculés ne sont plus tous sur la courbe). */
export function smooth(pts: number[], closed: boolean, iterations: number): number[] {
  let cur = pts
  for (let it = 0; it < iterations; it++) {
    const n = cur.length >> 1
    if (n < 3) return cur
    const next: number[] = []
    if (!closed) next.push(cur[0], cur[1])
    const count = closed ? n : n - 1
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % n
      const x0 = cur[i * 2]
      const y0 = cur[i * 2 + 1]
      const x1 = cur[j * 2]
      const y1 = cur[j * 2 + 1]
      next.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1, 0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1)
    }
    if (!closed) next.push(cur[cur.length - 2], cur[cur.length - 1])
    cur = next
  }
  return cur
}

/** Altitude interpolée dans le modèle (null hors de la zone triangulée). */
export function elevationAt(tin: Tin, x: number, y: number): number | null {
  const { xs, ys, zs, triangles } = tin
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t]
    const b = triangles[t + 1]
    const c = triangles[t + 2]
    const d = (ys[b] - ys[c]) * (xs[a] - xs[c]) + (xs[c] - xs[b]) * (ys[a] - ys[c])
    if (d === 0) continue
    const u = ((ys[b] - ys[c]) * (x - xs[c]) + (xs[c] - xs[b]) * (y - ys[c])) / d
    const v = ((ys[c] - ys[a]) * (x - xs[c]) + (xs[a] - xs[c]) * (y - ys[c])) / d
    const w = 1 - u - v
    if (u >= -1e-9 && v >= -1e-9 && w >= -1e-9) return u * zs[a] + v * zs[b] + w * zs[c]
  }
  return null
}

/** Surface plane et volume au-dessus d'un plan de référence (prismes sur triangles). */
export function tinStats(tin: Tin, reference: number): { area2d: number; volumeAbove: number; volumeBelow: number } {
  const { xs, ys, zs, triangles } = tin
  let area2d = 0
  let above = 0
  let below = 0
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t]
    const b = triangles[t + 1]
    const c = triangles[t + 2]
    const area = Math.abs((xs[b] - xs[a]) * (ys[c] - ys[a]) - (xs[c] - xs[a]) * (ys[b] - ys[a])) / 2
    area2d += area
    const h = (zs[a] + zs[b] + zs[c]) / 3 - reference
    if (h >= 0) above += area * h
    else below -= area * h
  }
  return { area2d, volumeAbove: above, volumeBelow: below }
}
