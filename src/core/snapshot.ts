/**
 * Instantané d'un projet : tout ce qu'il faut pour reprendre le travail plus tard
 * (jeux de données, calques, systèmes de coordonnées, résultat de génération, vue).
 * Format : JSON compressé (gzip). Le même fichier sert à la sauvegarde sur
 * l'appareil, au fichier « .geoprojet » et à l'enregistrement en ligne.
 */
import { gunzipSync, gzipSync } from 'fflate'
import { customCrsDefinition, registerCustomCrs } from './crs'
import type { Project } from './project'
import { reserveDatasetId, type Dataset } from './types'
import type { LegendItem, Parcel, PlanResult } from '../topo/generate'

export interface ViewState {
  cx: number
  cy: number
  scale: number
}

interface StoredItem {
  ds: Dataset
  plan?: { parcel: Parcel | null; legend: LegendItem[]; report: PlanResult['report'] }
}

interface Snapshot {
  format: 'appstock-geo'
  version: 1
  name: string
  savedAt: string
  crs: string | null
  customCrs: Record<string, string>
  view: ViewState | null
  items: StoredItem[]
}

export interface SnapshotInfo {
  name: string
  savedAt: string
  files: string[]
}

/** Sérialise le projet. Les tableaux numériques gardent toute leur précision. */
export function takeSnapshot(project: Project, view: ViewState | null, name: string): Uint8Array {
  const customCrs: Record<string, string> = {}
  for (const code of [project.crs, ...project.items.map((i) => i.ds.crs)]) {
    const def = customCrsDefinition(code)
    if (code && def) customCrs[code] = def
  }
  const snap: Snapshot = {
    format: 'appstock-geo',
    version: 1,
    name,
    savedAt: new Date().toISOString(),
    crs: project.crs,
    customCrs,
    view,
    items: project.items.map((i) => ({ ds: i.ds, ...(i.plan ? { plan: { parcel: i.plan.parcel, legend: i.plan.legend, report: i.plan.report } } : {}) })),
  }
  const json = JSON.stringify(snap, (_k, v: unknown) => {
    if (v instanceof Float64Array) return { $f64: Array.from(v) }
    if (v instanceof Map) return { $map: Array.from(v.entries()) }
    return v
  })
  return gzipSync(new TextEncoder().encode(json), { level: 6 })
}

function parse(bytes: Uint8Array): Snapshot {
  let text: string
  try {
    text = new TextDecoder().decode(gunzipSync(bytes))
  } catch {
    throw new Error('Ce fichier n’est pas un projet enregistré par la plateforme.')
  }
  const snap = JSON.parse(text, (_k, v: unknown) => {
    if (v && typeof v === 'object') {
      const o = v as { $f64?: number[]; $map?: [unknown, unknown][] }
      if (Array.isArray(o.$f64)) return Float64Array.from(o.$f64)
      if (Array.isArray(o.$map)) return new Map(o.$map)
    }
    return v
  }) as Snapshot
  if (snap.format !== 'appstock-geo' || !Array.isArray(snap.items)) throw new Error('Ce fichier n’est pas un projet enregistré par la plateforme.')
  if (snap.version > 1) throw new Error('Ce projet a été enregistré par une version plus récente de la plateforme.')
  return snap
}

export function snapshotInfo(bytes: Uint8Array): SnapshotInfo {
  const s = parse(bytes)
  return { name: s.name, savedAt: s.savedAt, files: s.items.map((i) => i.ds.name) }
}

/** Remplace le contenu du projet par celui de l'instantané. Renvoie la vue enregistrée. */
export function restoreSnapshot(bytes: Uint8Array, project: Project): { name: string; view: ViewState | null } {
  const snap = parse(bytes)
  for (const def of Object.values(snap.customCrs ?? {})) {
    try {
      registerCustomCrs(def)
    } catch {
      /* système illisible : le jeu concerné sera affiché en coordonnées brutes */
    }
  }
  for (const item of [...project.items]) project.remove(item)
  project.crs = snap.crs
  for (const it of snap.items) {
    reserveDatasetId(it.ds.id)
    project.add(it.ds, it.plan ? { dataset: it.ds, parcel: it.plan.parcel, legend: it.plan.legend, report: it.plan.report, tin: null } : undefined)
  }
  return { name: snap.name, view: snap.view }
}
