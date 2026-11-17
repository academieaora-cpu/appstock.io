/**
 * Requêtes géométriques sur le projet : désignation d'un objet, sélection par fenêtre,
 * accrochage aux objets. Tout est calculé sur les listes d'affichage, dans le système
 * de coordonnées du projet, avec les index spatiaux.
 */
import { projector } from '../core/crs'
import { distToSegment2, pointInRing } from '../core/geom'
import type { Item, Project } from '../core/project'

export interface Selection {
  item: Item
  entity: number
}

export type SnapKind = 'extrémité' | 'milieu' | 'centre' | 'intersection' | 'perpendiculaire' | 'proche' | 'nœud' | 'insertion' | 'libre'

export interface Snap {
  x: number
  y: number
  kind: SnapKind
}

export interface SnapModes {
  extrémité: boolean
  milieu: boolean
  centre: boolean
  intersection: boolean
  perpendiculaire: boolean
  proche: boolean
  nœud: boolean
  insertion: boolean
}

export const ALL_SNAPS: SnapModes = { extrémité: true, milieu: true, centre: true, intersection: true, perpendiculaire: true, proche: false, nœud: true, insertion: true }

const PRIORITY: Record<SnapKind, number> = { nœud: 0, extrémité: 0, centre: 0, intersection: 0.15, insertion: 0.4, milieu: 0.3, perpendiculaire: 0.5, proche: 2, libre: 9 }

/** Passage des coordonnées d'un jeu de données à celles du projet. */
export function toProjectFn(project: Project, item: Item): (x: number, y: number) => [number, number] {
  const p = projector(item.ds.crs, project.crs)
  const m = item.ds.xform
  return (x, y) => {
    let tx = x
    let ty = y
    if (m) {
      tx = m[0] * x + m[2] * y + m[4]
      ty = m[1] * x + m[3] * y + m[5]
    }
    return p ? p(tx, ty) : [tx, ty]
  }
}

/** Un jeu de données est modifiable quand ses coordonnées sont celles du projet. */
export function isEditable(project: Project, item: Item): boolean {
  return !item.ds.xform && (item.ds.crs === project.crs || (!item.ds.crs && !project.crs))
}

/** Objet le plus proche du point (x, y), dans une tolérance en unités du projet. */
export function pickEntity(project: Project, x: number, y: number, tol: number): Selection | null {
  let best: Selection | null = null
  let bestD = Infinity
  for (let k = project.items.length - 1; k >= 0; k--) {
    const item = project.items[k]
    if (!item.ds.visible) continue
    const dl = item.dl
    if (dl.pointIndex) {
      for (const i of dl.pointIndex.search(x - tol, y - tol, x + tol, y + tol)) {
        if (!item.vis[dl.pointLayer[i]]) continue
        const d = Math.hypot(dl.points[i * 2] - x, dl.points[i * 2 + 1] - y) * 0.5
        if (d < bestD) [bestD, best] = [d, { item, entity: dl.pointEnt[i] }]
      }
    }
    if (dl.polyIndex) {
      for (const i of dl.polyIndex.search(x - tol, y - tol, x + tol, y + tol)) {
        if (!item.vis[dl.polyLayer[i]]) continue
        const from = dl.polyStart[i] * 2
        const to = dl.polyStart[i + 1] * 2
        let d2 = Infinity
        for (let j = from; j < to - 2; j += 2) d2 = Math.min(d2, distToSegment2(x, y, dl.coords[j], dl.coords[j + 1], dl.coords[j + 2], dl.coords[j + 3])[0])
        if (dl.polyClosed[i]) d2 = Math.min(d2, distToSegment2(x, y, dl.coords[to - 2], dl.coords[to - 1], dl.coords[from], dl.coords[from + 1])[0])
        const d = Math.sqrt(d2)
        if (d <= tol && d < bestD) [bestD, best] = [d, { item, entity: dl.polyEnt[i] }]
      }
    }
    for (const t of dl.texts) {
      if (!item.vis[t.layer]) continue
      const reach = Math.max(t.h * t.text.length * 0.5, tol)
      if (Math.abs(t.x - x) > reach || Math.abs(t.y - y) > Math.max(t.h * 1.2, tol)) continue
      const d = Math.hypot(t.x - x, t.y - y) * 0.2
      if (d < bestD && d < tol) [bestD, best] = [d, { item, entity: t.ent }]
    }
    if (!best) {
      for (const f of dl.fills) {
        if (!item.vis[f.layer]) continue
        if (x < f.bbox[0] || x > f.bbox[2] || y < f.bbox[1] || y > f.bbox[3]) continue
        let inside = false
        for (const r of f.rings) if (pointInRing(x, y, r)) inside = !inside
        if (inside && tol * 0.95 < bestD) [bestD, best] = [tol * 0.95, { item, entity: f.ent }]
      }
    }
  }
  return best
}

/**
 * Sélection par fenêtre. `crossing` : tout objet qui touche la fenêtre (de droite à gauche
 * dans AutoCAD) ; sinon seuls les objets entièrement contenus (de gauche à droite).
 */
export function entitiesInRect(project: Project, r: [number, number, number, number], crossing: boolean): Selection[] {
  const [x0, y0, x1, y1] = r
  const out: Selection[] = []
  for (const item of project.items) {
    if (!item.ds.visible) continue
    const dl = item.dl
    const inside = new Map<number, boolean>()
    const mark = (ent: number, fully: boolean, touches: boolean) => {
      const prev = inside.get(ent)
      if (crossing) {
        if (touches) inside.set(ent, true)
      } else inside.set(ent, (prev ?? true) && fully)
    }
    const within = (bx0: number, by0: number, bx1: number, by1: number) => bx0 >= x0 && bx1 <= x1 && by0 >= y0 && by1 <= y1
    const overlaps = (bx0: number, by0: number, bx1: number, by1: number) => bx1 >= x0 && bx0 <= x1 && by1 >= y0 && by0 <= y1
    for (let i = 0; i < dl.polyEnt.length; i++) {
      if (!item.vis[dl.polyLayer[i]]) continue
      const b = i * 4
      mark(dl.polyEnt[i], within(dl.polyBox[b], dl.polyBox[b + 1], dl.polyBox[b + 2], dl.polyBox[b + 3]), overlaps(dl.polyBox[b], dl.polyBox[b + 1], dl.polyBox[b + 2], dl.polyBox[b + 3]))
    }
    for (let i = 0; i < dl.pointEnt.length; i++) {
      if (!item.vis[dl.pointLayer[i]]) continue
      const px = dl.points[i * 2]
      const py = dl.points[i * 2 + 1]
      const w = within(px, py, px, py)
      mark(dl.pointEnt[i], w, w)
    }
    for (const t of dl.texts) {
      if (!item.vis[t.layer]) continue
      const w = within(t.x, t.y, t.x, t.y)
      mark(t.ent, w, w)
    }
    for (const f of dl.fills) {
      if (!item.vis[f.layer]) continue
      mark(f.ent, within(...f.bbox), overlaps(...f.bbox))
    }
    for (const [ent, ok] of inside) if (ok) out.push({ item, entity: ent })
  }
  return out
}

/** Accrochage aux objets autour du point (x, y). */
export function findSnap(project: Project, x: number, y: number, tol: number, base: [number, number] | null, modes: SnapModes): Snap {
  let best: Snap = { x, y, kind: 'libre' }
  let bestScore = Infinity
  const consider = (px: number, py: number, kind: SnapKind) => {
    if (!modes[kind as keyof SnapModes]) return
    const d = Math.hypot(px - x, py - y)
    if (d > tol) return
    const score = d / tol + PRIORITY[kind]
    if (score < bestScore) {
      bestScore = score
      best = { x: px, y: py, kind }
    }
  }
  const segs: number[] = []
  for (const item of project.items) {
    if (!item.ds.visible) continue
    const dl = item.dl
    const ents = item.ds.entities
    if (dl.pointIndex) {
      for (const i of dl.pointIndex.search(x - tol, y - tol, x + tol, y + tol)) {
        if (item.vis[dl.pointLayer[i]]) consider(dl.points[i * 2], dl.points[i * 2 + 1], 'nœud')
      }
    }
    for (const t of dl.texts) {
      if (!item.vis[t.layer] || Math.abs(t.x - x) > tol || Math.abs(t.y - y) > tol) continue
      consider(t.x, t.y, 'insertion')
    }
    if (!dl.polyIndex) continue
    let toProj: ((x: number, y: number) => [number, number]) | null = null
    const seen = new Set<number>()
    for (const i of dl.polyIndex.search(x - tol, y - tol, x + tol, y + tol)) {
      if (!item.vis[dl.polyLayer[i]]) continue
      const e = ents[dl.polyEnt[i]]
      const from = dl.polyStart[i] * 2
      const to = dl.polyStart[i + 1] * 2
      const curve = e && (e.t === 'circle' || e.t === 'arc' || e.t === 'ellipse' || e.t === 'spline')
      if (e && !seen.has(dl.polyEnt[i])) {
        seen.add(dl.polyEnt[i])
        if (e.t === 'circle' || e.t === 'arc' || e.t === 'ellipse') {
          toProj ??= toProjectFn(project, item)
          const c = toProj(e.cx, e.cy)
          consider(c[0], c[1], 'centre')
        } else if (e.t === 'insert' && !e.mirror) {
          toProj ??= toProjectFn(project, item)
          const c = toProj(e.x, e.y)
          consider(c[0], c[1], 'insertion')
        }
      }
      if (curve) {
        if (e.t !== 'circle') {
          consider(dl.coords[from], dl.coords[from + 1], 'extrémité')
          consider(dl.coords[to - 2], dl.coords[to - 1], 'extrémité')
        }
      } else {
        for (let j = from; j < to; j += 2) consider(dl.coords[j], dl.coords[j + 1], 'extrémité')
        for (let j = from; j < to - 2; j += 2) consider((dl.coords[j] + dl.coords[j + 2]) / 2, (dl.coords[j + 1] + dl.coords[j + 3]) / 2, 'milieu')
        if (dl.polyClosed[i] && to - from >= 6) consider((dl.coords[to - 2] + dl.coords[from]) / 2, (dl.coords[to - 1] + dl.coords[from + 1]) / 2, 'milieu')
      }
      if (segs.length < 4000) {
        for (let j = from; j < to - 2; j += 2) segs.push(dl.coords[j], dl.coords[j + 1], dl.coords[j + 2], dl.coords[j + 3])
        if (dl.polyClosed[i]) segs.push(dl.coords[to - 2], dl.coords[to - 1], dl.coords[from], dl.coords[from + 1])
      }
    }
  }
  // Segments proches : intersection, perpendiculaire, proche.
  const near: number[] = []
  for (let s = 0; s < segs.length; s += 4) {
    const [d2] = distToSegment2(x, y, segs[s], segs[s + 1], segs[s + 2], segs[s + 3])
    if (d2 <= tol * tol) near.push(s)
  }
  if (modes.intersection && near.length <= 300) {
    for (let a = 0; a < near.length; a++) {
      for (let b = a + 1; b < near.length; b++) {
        const p = segs.slice(near[a], near[a] + 4)
        const q = segs.slice(near[b], near[b] + 4)
        const rx = p[2] - p[0]
        const ry = p[3] - p[1]
        const sx = q[2] - q[0]
        const sy = q[3] - q[1]
        const den = rx * sy - ry * sx
        if (Math.abs(den) < 1e-12) continue
        const t = ((q[0] - p[0]) * sy - (q[1] - p[1]) * sx) / den
        const u = ((q[0] - p[0]) * ry - (q[1] - p[1]) * rx) / den
        if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue
        consider(p[0] + rx * t, p[1] + ry * t, 'intersection')
      }
    }
  }
  for (const s of near) {
    const x0 = segs[s]
    const y0 = segs[s + 1]
    const dx = segs[s + 2] - x0
    const dy = segs[s + 3] - y0
    const l2 = dx * dx + dy * dy
    if (l2 === 0) continue
    if (base && modes.perpendiculaire) {
      const t = ((base[0] - x0) * dx + (base[1] - y0) * dy) / l2
      if (t >= 0 && t <= 1) consider(x0 + t * dx, y0 + t * dy, 'perpendiculaire')
    }
    if (modes.proche) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2))
      consider(x0 + t * dx, y0 + t * dy, 'proche')
    }
  }
  return best
}

/** Géométrie affichée d'une sélection (polylignes en coordonnées du projet), pour la surbrillance et les aperçus. */
export function selectionGeometry(sel: Selection[]): { lines: Float64Array[]; closed: boolean[]; points: number[] } {
  const lines: Float64Array[] = []
  const closed: boolean[] = []
  const points: number[] = []
  const byItem = new Map<Item, Set<number>>()
  for (const s of sel) {
    let set = byItem.get(s.item)
    if (!set) byItem.set(s.item, (set = new Set()))
    set.add(s.entity)
  }
  for (const [item, set] of byItem) {
    const dl = item.dl
    for (let i = 0; i < dl.polyEnt.length; i++) {
      if (!set.has(dl.polyEnt[i])) continue
      lines.push(dl.coords.subarray(dl.polyStart[i] * 2, dl.polyStart[i + 1] * 2))
      closed.push(dl.polyClosed[i] === 1)
    }
    for (const f of dl.fills) {
      if (!set.has(f.ent)) continue
      for (const r of f.rings) {
        lines.push(Float64Array.from(r))
        closed.push(true)
      }
    }
    for (let i = 0; i < dl.pointEnt.length; i++) if (set.has(dl.pointEnt[i])) points.push(dl.points[i * 2], dl.points[i * 2 + 1])
    for (const t of dl.texts) if (set.has(t.ent)) points.push(t.x, t.y)
  }
  return { lines, closed, points }
}
