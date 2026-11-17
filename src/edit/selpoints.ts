/**
 * Points désignés dans le dessin → lignes d'un tableau des coordonnées. Accepte les points
 * topographiques (nom = matricule), les points, et les sommets des polylignes, polygones et
 * lignes (nom = numéro de borne écrit à côté sur le calque SOMMETS, sinon B.1, B.2…).
 */
import type { Project } from '../core/project'
import type { Entity } from '../core/types'
import { closedRing, vertices } from './ops'
import { toProjectFn, type Selection } from './query'

export interface NamedPoint {
  label: string
  x: number
  y: number
}

function pointName(e: Entity): string | null {
  const p = e.props
  const v = p?.MAT ?? p?.NUM ?? p?.NOM ?? p?.BORNE ?? p?.name ?? p?.id
  if (v !== undefined && v !== null && String(v).trim()) return String(v)
  if (e.t === 'insert') {
    const a = e.attribs?.find((x) => x.tag === 'MAT') ?? e.attribs?.[0]
    if (a?.text?.trim()) return a.text.trim()
  }
  return null
}

export function canProvidePoints(e: Entity): boolean {
  return e.t === 'insert' || e.t === 'point' || !!vertices(e)
}

/**
 * Lignes du tableau dans l'ordre de désignation, sans doublon (au millimètre).
 * `parcel` vaut vrai quand la sélection est un seul objet fermé : sa surface a un sens.
 */
export function pointsFromSelection(project: Project, sel: Selection[], prefix = 'B.', start = 1): { rows: NamedPoint[]; parcel: boolean } {
  const rows: NamedPoint[] = []
  let n = start
  const seen = new Set<string>()
  const push = (label: string | null, x: number, y: number) => {
    const key = Math.round(x * 1000) + ':' + Math.round(y * 1000)
    if (seen.has(key)) return
    seen.add(key)
    rows.push({ label: label ?? prefix + n++, x, y })
  }
  for (const s of sel) {
    const e = s.item.ds.entities[s.entity]
    if (!e) continue
    const toP = toProjectFn(project, s.item)
    if (e.t === 'insert' || e.t === 'point') {
      const p = toP(e.x, e.y)
      push(pointName(e), p[0], p[1])
      continue
    }
    const v = vertices(e)
    if (!v) continue
    const labels = s.item.ds.entities.filter((t) => t.t === 'text' && t.layer === 'SOMMETS')
    for (let i = 0; i < v.pts.length; i += 2) {
      const x = v.pts[i]
      const y = v.pts[i + 1]
      let label: string | null = null
      let best = Infinity
      for (const t of labels) {
        if (t.t !== 'text') continue
        const d = Math.hypot(t.x - x, t.y - y)
        if (d < best && d < t.h * 4) {
          best = d
          label = t.text
        }
      }
      const p = toP(x, y)
      push(label, p[0], p[1])
    }
  }
  const parcel = sel.length === 1 && !!closedRing(sel[0].item.ds.entities[sel[0].entity])
  return { rows, parcel }
}
