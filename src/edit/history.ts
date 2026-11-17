/**
 * Annuler / rétablir. Chaque étape mémorise l'état des jeux de données touchés avant et
 * après la modification (copies superficielles : les entités sont immuables).
 */
import type { Item, Project } from '../core/project'
import type { Block, Entity, Layer } from '../core/types'

interface State {
  entities: Entity[]
  blocks: Map<string, Block>
  layers: Map<string, Layer>
}

interface Part {
  item: Item
  before: State
  after: State
}

interface Step {
  label: string
  parts: Part[]
}

function capture(item: Item): State {
  const ds = item.ds
  return { entities: ds.entities.slice(), blocks: new Map(ds.blocks), layers: new Map([...ds.layers].map(([k, l]) => [k, { ...l }])) }
}

function restore(item: Item, s: State): void {
  item.ds.entities = s.entities.slice()
  item.ds.blocks = new Map(s.blocks)
  item.ds.layers = new Map([...s.layers].map(([k, l]) => [k, { ...l }]))
}

export class History {
  private done: Step[] = []
  private undone: Step[] = []
  limit = 200

  constructor(private project: Project) {}

  /** Exécute une modification sur un ou plusieurs jeux et l'enregistre comme une seule étape. */
  record(label: string, items: Item[], mutate: () => void): void {
    const unique = [...new Set(items)]
    const before = unique.map((item) => ({ item, before: capture(item) }))
    mutate()
    const parts = before.map((p) => ({ ...p, after: capture(p.item) }))
    this.done.push({ label, parts })
    if (this.done.length > this.limit) this.done.shift()
    this.undone = []
    for (const item of unique) this.project.rebuild(item)
  }

  get canUndo(): boolean {
    return this.done.length > 0
  }

  get canRedo(): boolean {
    return this.undone.length > 0
  }

  /** Annule la dernière étape. Renvoie son libellé, ou null. */
  undo(): string | null {
    const step = this.done.pop()
    if (!step) return null
    for (const p of step.parts) {
      if (!this.project.items.includes(p.item)) continue
      restore(p.item, p.before)
      this.project.rebuild(p.item)
    }
    this.undone.push(step)
    return step.label
  }

  redo(): string | null {
    const step = this.undone.pop()
    if (!step) return null
    for (const p of step.parts) {
      if (!this.project.items.includes(p.item)) continue
      restore(p.item, p.after)
      this.project.rebuild(p.item)
    }
    this.done.push(step)
    return step.label
  }

  clear(): void {
    this.done = []
    this.undone = []
  }
}
