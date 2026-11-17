/**
 * Projet : les jeux de données ouverts, le système de coordonnées commun
 * et les listes d'affichage reprojetées à la volée.
 */
import { getCrs, projector, toLonLat, utmFor } from './crs'
import { rawExtent } from './geom'
import type { Dataset, Extent } from './types'
import { buildDisplayList, layerVisibility, type DisplayList } from '../render/scene'
import type { PlanResult } from '../topo/generate'

export interface Item {
  ds: Dataset
  dl: DisplayList
  vis: Uint8Array
  /** Résultat de génération, pour les dessins produits par l'assistant. */
  plan?: PlanResult
  /** Message si la reprojection a échoué. */
  error?: string
}

export interface Selection {
  item: Item
  /** Index de l'entité dans `item.ds.entities`. */
  entity: number
}

type Listener = (what: 'data' | 'view' | 'selection') => void

export class Project {
  /** Système de coordonnées du projet (null : coordonnées locales, pas de fond de carte). */
  crs: string | null = null
  items: Item[] = []
  selection: Selection | null = null
  private listeners: Listener[] = []

  on(fn: Listener): void {
    this.listeners.push(fn)
  }
  emit(what: 'data' | 'view' | 'selection'): void {
    for (const fn of this.listeners) fn(what)
  }

  private build(ds: Dataset): { dl: DisplayList; error?: string } {
    try {
      return { dl: buildDisplayList(ds, projector(ds.crs, this.crs)) }
    } catch (err) {
      // Reprojection impossible : on affiche les coordonnées brutes plutôt que rien.
      return { dl: buildDisplayList(ds, null), error: 'Reprojection impossible : ' + String((err as Error).message ?? err) }
    }
  }

  add(ds: Dataset, plan?: PlanResult): Item {
    if (!this.crs && ds.crs) this.crs = this.projectCrsFor(ds)
    const { dl, error } = this.build(ds)
    const item: Item = { ds, dl, vis: layerVisibility(dl, ds), plan, error }
    this.items.push(item)
    this.emit('data')
    return item
  }

  /** Un jeu en longitude/latitude impose un système projeté en mètres (fuseau UTM local). */
  private projectCrsFor(ds: Dataset): string {
    const def = ds.crs ? getCrs(ds.crs) : undefined
    if (!def?.geographic || !ds.crs) return ds.crs as string
    const e = rawExtent(ds)
    const p = toLonLat(ds.crs, (e[0] + e[2]) / 2, (e[1] + e[3]) / 2)
    return p ? utmFor(p[0], p[1]) : (ds.crs as string)
  }

  replace(item: Item, ds: Dataset, plan?: PlanResult): void {
    item.ds = ds
    item.plan = plan
    this.rebuild(item)
  }

  rebuild(item: Item): void {
    const { dl, error } = this.build(item.ds)
    item.dl = dl
    item.error = error
    item.vis = layerVisibility(dl, item.ds)
    if (this.selection?.item === item) this.selection = null
    this.emit('data')
  }

  refreshVisibility(item: Item): void {
    item.vis = layerVisibility(item.dl, item.ds)
    this.emit('view')
  }

  remove(item: Item): void {
    this.items = this.items.filter((i) => i !== item)
    if (this.selection?.item === item) this.selection = null
    if (!this.items.length) this.crs = null
    this.emit('data')
  }

  /** Change le système du projet : tout est reprojeté. */
  setCrs(code: string | null): void {
    this.crs = code
    for (const item of this.items) {
      const { dl, error } = this.build(item.ds)
      item.dl = dl
      item.error = error
      item.vis = layerVisibility(dl, item.ds)
    }
    this.selection = null
    this.emit('data')
  }

  /** Déclare le système d'un jeu de données. */
  setDatasetCrs(item: Item, code: string | null, source: Dataset['crsSource']): void {
    item.ds.crs = code
    item.ds.crsSource = code ? source : 'none'
    if (!this.crs && code) this.crs = this.projectCrsFor(item.ds)
    this.rebuild(item)
  }

  select(sel: Selection | null): void {
    this.selection = sel
    this.emit('selection')
  }

  /** Emprise des jeux visibles, dans le système du projet. */
  extent(): Extent | null {
    let e: Extent | null = null
    for (const item of this.items) {
      if (!item.ds.visible) continue
      const x = item.dl.extent
      if (x[0] === x[2] && x[1] === x[3] && !item.dl.counts.points && !item.dl.counts.texts) continue
      e = e ? [Math.min(e[0], x[0]), Math.min(e[1], x[1]), Math.max(e[2], x[2]), Math.max(e[3], x[3])] : [...x]
    }
    return e
  }
}
