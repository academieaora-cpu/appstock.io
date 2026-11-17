/**
 * Moteur d'édition, sur le modèle d'AutoCAD : une commande active à la fois, qui demande
 * des points, des valeurs ou des objets ; les réponses viennent de la souris (avec
 * accrochage et mode ortho) ou de la ligne de commande (coordonnées, options).
 *
 * Les commandes sont des fonctions asynchrones : `await ed.point(...)`, `await ed.number(...)`.
 * Échap rejette la demande en cours avec `Cancelled`, ce qui termine la commande proprement.
 */
import type { Item, Project } from '../core/project'
import { ensureLayer, newDataset, type Block, type Color, type Entity } from '../core/types'
import { History } from './history'
import { grips, moveGrip, type Pt } from './ops'
import { ALL_SNAPS, entitiesInRect, findSnap, isEditable, pickEntity, selectionGeometry, type Selection, type Snap, type SnapModes } from './query'

export class Cancelled extends Error {
  constructor() {
    super('Commande annulée')
  }
}

/** Géométrie provisoire dessinée pendant une commande (coordonnées du projet). */
export interface Ghost {
  lines: number[][]
  closed?: boolean[]
  texts?: { x: number; y: number; text: string }[]
}

export type Keyword = [key: string, label: string]

export interface PointOptions {
  base?: Pt | null
  keywords?: Keyword[]
  preview?: (cur: Pt) => Ghost | null
  /** Un nombre tapé est renvoyé tel quel (rayon, angle…) au lieu d'une distance directe. */
  acceptNumber?: boolean
  noSnap?: boolean
}

export type PointResult = Pt | string | number | null

export interface CommandDef {
  id: string
  label: string
  aliases: string[]
  /** Menu de la barre de menus. */
  menu: string
  /** Onglet et groupe du ruban, s'il y figure. */
  ribbon?: [tab: string, group: string]
  icon?: string
  /** Ce que fait la commande, en une phrase. */
  tip: string
  /** Mode d'emploi, étape par étape. */
  steps: string[]
  run: (ed: Editor) => Promise<void> | void
}

type Pending =
  | { kind: 'point'; prompt: string; opts: PointOptions; resolve: (v: PointResult) => void; reject: (e: Error) => void }
  | { kind: 'value'; prompt: string; keywords?: Keyword[]; spaces: boolean; parse: (s: string) => { ok: true; value: unknown } | { ok: false; error: string }; resolve: (v: unknown) => void; reject: (e: Error) => void }
  | { kind: 'select'; prompt: string; single: boolean; filter?: (s: Selection) => boolean; resolve: (v: Selection[]) => void; reject: (e: Error) => void }

interface Grip {
  sel: Selection
  index: number
  x: number
  y: number
}

const norm = (s: string) =>
  s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

/** Nombre saisi au clavier (virgule ou point décimal). */
export function parseNumber(s: string): number | null {
  const t = s.trim().replace(/\s/g, '')
  if (!/^[-+]?(\d+([.,]\d*)?|[.,]\d+)([eE][-+]?\d+)?$/.test(t)) return null
  return parseFloat(t.replace(',', '.'))
}

/**
 * Point saisi au clavier :
 * « x,y » absolu ; « @dx,dy » relatif ; « @d<a » polaire (degrés, sens trigonométrique) ;
 * « @d<Gg » polaire en gisement (grades, sens horaire depuis le nord) ; un nombre seul =
 * distance directe vers le curseur depuis le point de base.
 */
export function parsePointInput(text: string, base: Pt | null, cursor: Pt | null): Pt | number | undefined {
  const t = text.trim().replace(/\s+/g, '')
  if (!t) return undefined
  const rel = t.startsWith('@')
  const body = rel ? t.slice(1) : t
  const polar = /^([-+]?[\d.]+)<([-+]?[\d.]+)(g|gr)?$/i.exec(body)
  if (polar && rel && base) {
    const d = parseFloat(polar[1])
    const a = parseFloat(polar[2])
    if (polar[3]) {
      const g = (a * Math.PI) / 200
      return [base[0] + d * Math.sin(g), base[1] + d * Math.cos(g)]
    }
    const r = (a * Math.PI) / 180
    return [base[0] + d * Math.cos(r), base[1] + d * Math.sin(r)]
  }
  const xy = /^([-+]?[\d.]+)[,;]([-+]?[\d.]+)$/.exec(body)
  if (xy) {
    const x = parseFloat(xy[1])
    const y = parseFloat(xy[2])
    if (rel) return base ? [base[0] + x, base[1] + y] : undefined
    return [x, y]
  }
  const n = parseNumber(body)
  if (n !== null && !rel) {
    if (base && cursor) {
      const dx = cursor[0] - base[0]
      const dy = cursor[1] - base[1]
      const l = Math.hypot(dx, dy)
      if (l > 0) return [base[0] + (dx / l) * n, base[1] + (dy / l) * n]
    }
    return n
  }
  return undefined
}

export type EditorEvent = 'prompt' | 'selection' | 'state'

export class Editor {
  readonly history: History
  selection: Selection[] = []
  snapOn = true
  ortho = false
  modes: SnapModes = { ...ALL_SNAPS }
  currentLayer = '0'
  activeItem: Item | null = null
  /** Dénominateur de l'échelle du plan : fixe la taille des textes et symboles dessinés. */
  docScale = 500
  cursor: Pt | null = null
  snap: Snap | null = null
  lastPoint: Pt | null = null
  /** Position du dernier clic de désignation d'objet (côté à ajuster, segment à raccorder…). */
  lastPick: Pt | null = null
  ghost: Ghost | null = null
  lastCommand: string | null = null
  running: string | null = null
  log: string[] = []
  readonly commands = new Map<string, CommandDef>()
  private lookup = new Map<string, CommandDef>()
  private pending: Pending | null = null
  private grip: (Grip & { cur: Pt }) | null = null
  private selGeom: ReturnType<typeof selectionGeometry> | null = null
  private listeners: ((e: EditorEvent) => void)[] = []
  /** Tolérance de désignation en unités du projet (fournie par la vue). */
  pickTol: () => number = () => 1
  requestDraw: () => void = () => {}
  /** Actions de l'interface (dialogues), fournies par l'application. */
  actions: Record<string, (arg?: string) => void> = {}

  constructor(readonly project: Project) {
    this.history = new History(project)
    project.on((what) => {
      if (what === 'data') {
        // Les index d'entités ont pu changer : la sélection n'est plus fiable.
        if (this.selection.length) this.setSelection([])
        this.selGeom = null
        if (this.activeItem && !project.items.includes(this.activeItem)) this.activeItem = null
      }
    })
  }

  on(fn: (e: EditorEvent) => void): void {
    this.listeners.push(fn)
  }

  private emit(e: EditorEvent): void {
    for (const fn of this.listeners) fn(e)
    this.requestDraw()
  }

  register(defs: CommandDef[]): void {
    for (const d of defs) {
      this.commands.set(d.id, d)
      this.lookup.set(norm(d.id), d)
      for (const a of d.aliases) this.lookup.set(norm(a), d)
    }
  }

  find(name: string): CommandDef | undefined {
    return this.commands.get(name) ?? this.lookup.get(norm(name))
  }

  get k(): number {
    return this.docScale / 1000
  }

  get busy(): boolean {
    return this.running !== null
  }

  get promptText(): string {
    return this.pending ? this.pending.prompt : 'Commande :'
  }

  get promptKeywords(): Keyword[] {
    const p = this.pending
    if (!p) return []
    if (p.kind === 'point') return p.opts.keywords ?? []
    if (p.kind === 'value') return p.keywords ?? []
    return []
  }

  /** La saisie en cours accepte-t-elle les espaces (texte libre) ? */
  get wantsSpaces(): boolean {
    return this.pending?.kind === 'value' && this.pending.spaces
  }

  message(text: string): void {
    this.log.push(text)
    if (this.log.length > 200) this.log.shift()
    this.emit('prompt')
  }

  // --- Exécution des commandes ------------------------------------------------

  async run(name: string): Promise<void> {
    const def = this.find(name)
    if (!def) {
      this.message(`Commande inconnue : « ${name} ». Tapez AIDE pour la liste des commandes.`)
      return
    }
    if (this.running) this.cancel()
    // Laisse la commande précédente se terminer avant de démarrer la suivante.
    await Promise.resolve()
    this.running = def.label
    this.lastCommand = def.id
    this.message(`Commande : ${def.label}`)
    this.emit('state')
    try {
      await def.run(this)
    } catch (err) {
      if (err instanceof Cancelled) this.message('*Annulé*')
      else this.message('Erreur : ' + String((err as Error).message ?? err))
    } finally {
      if (this.running === def.label) {
        this.running = null
        this.pending = null
        this.ghost = null
      }
      this.emit('state')
      this.emit('prompt')
    }
  }

  cancel(): void {
    const p = this.pending
    this.pending = null
    this.ghost = null
    if (p) p.reject(new Cancelled())
  }

  // --- Demandes ----------------------------------------------------------------

  point(prompt: string, opts: PointOptions = {}): Promise<PointResult> {
    return new Promise((resolve, reject) => {
      this.pending = { kind: 'point', prompt: this.decorate(prompt, opts.keywords), opts, resolve, reject }
      this.emit('prompt')
    })
  }

  /** Point obligatoire : Entrée ou Échap terminent la commande. */
  async getPoint(prompt: string, opts: PointOptions = {}): Promise<Pt> {
    const r = await this.point(prompt, opts)
    if (Array.isArray(r)) return r
    throw new Cancelled()
  }

  number(prompt: string, def?: number, opts: { positive?: boolean } = {}): Promise<number> {
    return this.value(prompt + (def !== undefined ? ` <${fmt(def)}>` : '') + ' :', false, undefined, (s) => {
      if (!s && def !== undefined) return { ok: true, value: def }
      const n = parseNumber(s)
      if (n === null) return { ok: false, error: 'Nombre attendu.' }
      if (opts.positive && !(n > 0)) return { ok: false, error: 'Valeur strictement positive attendue.' }
      return { ok: true, value: n }
    }) as Promise<number>
  }

  text(prompt: string, def = ''): Promise<string> {
    return this.value(prompt + (def ? ` <${def}>` : '') + ' :', true, undefined, (s) => {
      const v = s || def
      return v ? { ok: true, value: v } : { ok: false, error: 'Texte attendu.' }
    }) as Promise<string>
  }

  /** Texte facultatif : Entrée vide renvoie la valeur par défaut, éventuellement vide. */
  optionalText(prompt: string, def = ''): Promise<string> {
    return this.value(prompt + (def ? ` <${def}>` : '') + ' :', true, undefined, (s) => ({ ok: true, value: s || def })) as Promise<string>
  }

  choice(prompt: string, keywords: Keyword[], def: string): Promise<string> {
    return this.value(this.decorate(prompt, keywords).replace(/ :$/, '') + ` <${keywords.find((k) => k[0] === def)?.[1] ?? def}> :`, false, keywords, (s) => {
      if (!s) return { ok: true, value: def }
      const k = this.matchKeyword(s, keywords)
      return k ? { ok: true, value: k } : { ok: false, error: 'Option attendue : ' + keywords.map((x) => x[1]).join(', ') }
    }) as Promise<string>
  }

  private value(prompt: string, spaces: boolean, keywords: Keyword[] | undefined, parse: (s: string) => { ok: true; value: unknown } | { ok: false; error: string }): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending = { kind: 'value', prompt, spaces, keywords, parse, resolve, reject }
      this.emit('prompt')
    })
  }

  /**
   * Objets à traiter. Une sélection faite avant la commande est reprise telle quelle (comme
   * dans AutoCAD). `single` : un seul objet, désigné d'un clic.
   */
  async select(prompt: string, opts: { single?: boolean; filter?: (s: Selection) => boolean; editable?: boolean; allowEmpty?: boolean } = {}): Promise<Selection[]> {
    const editable = opts.editable !== false
    const accept = (s: Selection) => (!editable || isEditable(this.project, s.item)) && (!opts.filter || opts.filter(s))
    if (!opts.single && this.selection.length) {
      const pre = this.selection.filter(accept)
      if (pre.length) {
        if (pre.length < this.selection.length) this.message(`${this.selection.length - pre.length} objet(s) ignoré(s) : non modifiables ou non adaptés à cette commande.`)
        return pre
      }
    }
    const sel = await new Promise<Selection[]>((resolve, reject) => {
      this.pending = { kind: 'select', prompt: prompt + (opts.single ? ' :' : ' (puis Entrée) :'), single: !!opts.single, filter: accept, resolve, reject }
      this.emit('prompt')
    })
    if (!sel.length && !opts.allowEmpty) throw new Cancelled()
    return sel
  }

  private decorate(prompt: string, keywords?: Keyword[]): string {
    const kw = keywords?.length ? ` [${keywords.map((k) => k[1]).join('/')}]` : ''
    return prompt + kw + ' :'
  }

  private matchKeyword(s: string, keywords?: Keyword[]): string | null {
    if (!keywords) return null
    const u = norm(s)
    for (const [key] of keywords) if (norm(key) === u) return key
    for (const [key, label] of keywords) if (u.length >= 2 && norm(label).startsWith(u)) return key
    return null
  }

  // --- Dessin cible, calques, validation ----------------------------------------

  /** Jeu de données qui reçoit les nouveaux objets : le fichier actif s'il est modifiable, sinon « Dessin ». */
  target(): Item {
    const p = this.project
    if (this.activeItem && p.items.includes(this.activeItem) && isEditable(p, this.activeItem)) return this.activeItem
    const existing = p.items.find((i) => i.ds.meta.dessin === 1 && isEditable(p, i))
    if (existing) {
      this.activeItem = existing
      return existing
    }
    const ds = newDataset('Dessin', 'Dessin', 'cad')
    ds.crs = p.crs
    ds.crsSource = p.crs ? 'user' : 'none'
    ds.meta.dessin = 1
    ensureLayer(ds, '0')
    const item = p.add(ds)
    this.activeItem = item
    return item
  }

  /** Ajoute des objets (une étape d'annulation). */
  add(label: string, entities: Entity[], opts: { item?: Item; blocks?: Block[]; layers?: [string, Color][] } = {}): void {
    if (!entities.length) return
    const item = opts.item ?? this.target()
    this.history.record(label, [item], () => {
      const ds = item.ds
      for (const b of opts.blocks ?? []) if (!ds.blocks.has(b.name)) ds.blocks.set(b.name, b)
      for (const [name, color] of opts.layers ?? []) if (!ds.layers.has(name)) ensureLayer(ds, name, color)
      for (const e of entities) {
        if (!ds.layers.has(e.layer)) ensureLayer(ds, e.layer)
        ds.entities.push(e)
      }
    })
  }

  /** Remplace, supprime et ajoute des objets dans un ou plusieurs jeux (une étape d'annulation). */
  modify(label: string, changes: Map<Item, { remove?: Set<number>; replace?: Map<number, Entity>; add?: Entity[] }>): void {
    if (!changes.size) return
    this.history.record(label, [...changes.keys()], () => {
      for (const [item, c] of changes) {
        const ds = item.ds
        const next: Entity[] = []
        ds.entities.forEach((e, i) => {
          if (c.remove?.has(i)) return
          next.push(c.replace?.get(i) ?? e)
        })
        for (const e of c.add ?? []) {
          if (!ds.layers.has(e.layer)) ensureLayer(ds, e.layer)
          next.push(e)
        }
        ds.entities = next
      }
    })
  }

  entity(s: Selection): Entity {
    return s.item.ds.entities[s.entity]
  }

  undo(): void {
    if (this.running) this.cancel()
    const label = this.history.undo()
    this.message(label ? `Annulé : ${label}` : 'Rien à annuler.')
  }

  redo(): void {
    const label = this.history.redo()
    this.message(label ? `Rétabli : ${label}` : 'Rien à rétablir.')
  }

  // --- Sélection -------------------------------------------------------------------

  setSelection(sel: Selection[]): void {
    this.selection = sel
    this.selGeom = null
    this.emit('selection')
  }

  private toggle(s: Selection, remove: boolean): void {
    const i = this.selection.findIndex((x) => x.item === s.item && x.entity === s.entity)
    if (i >= 0 && remove) this.setSelection(this.selection.filter((_, k) => k !== i))
    else if (i < 0 && !remove) this.setSelection([...this.selection, s])
  }

  // --- Entrées souris et clavier ------------------------------------------------------

  private get base(): Pt | null {
    const p = this.pending
    if (this.grip) return [this.grip.x, this.grip.y]
    return p?.kind === 'point' ? (p.opts.base ?? null) : null
  }

  onMove(raw: Pt): Snap | null {
    const p = this.pending
    const wantsPoint = (p?.kind === 'point' && !p.opts.noSnap) || !!this.grip
    let snap: Snap = { x: raw[0], y: raw[1], kind: 'libre' }
    if (wantsPoint && this.snapOn) snap = findSnap(this.project, raw[0], raw[1], this.pickTol() * 1.6, this.base, this.modes)
    let cur: Pt = [snap.x, snap.y]
    const base = this.base
    if (wantsPoint && this.ortho && base && snap.kind === 'libre') {
      cur = Math.abs(raw[0] - base[0]) >= Math.abs(raw[1] - base[1]) ? [raw[0], base[1]] : [base[0], raw[1]]
    }
    this.cursor = cur
    this.snap = wantsPoint ? snap : null
    if (this.grip) this.grip.cur = cur
    this.requestDraw()
    return this.snap
  }

  onClick(raw: Pt, shift: boolean): void {
    const p = this.pending
    if (p?.kind === 'point') {
      const pt = this.cursor ?? raw
      this.lastPoint = pt
      this.pending = null
      p.resolve(pt)
      return
    }
    const s = pickEntity(this.project, raw[0], raw[1], this.pickTol())
    if (p?.kind === 'select') {
      if (!s) return
      if (p.filter && !p.filter(s)) {
        this.message('Cet objet ne convient pas à cette commande (ou il appartient à un fichier non modifiable).')
        return
      }
      if (p.single) {
        this.pending = null
        this.lastPick = [raw[0], raw[1]]
        p.resolve([s])
        return
      }
      this.toggle(s, shift)
      return
    }
    if (p) return
    if (!s) {
      if (!shift) this.setSelection([])
      return
    }
    this.toggle(s, shift && this.selection.some((x) => x.item === s.item && x.entity === s.entity))
  }

  onWindow(rect: [number, number, number, number], crossing: boolean): void {
    const p = this.pending
    if (p && p.kind !== 'select') return
    if (p?.kind === 'select' && p.single) return
    const found = entitiesInRect(this.project, rect, crossing).filter((s) => !p || p.kind !== 'select' || !p.filter || p.filter(s))
    const merged = [...this.selection]
    for (const s of found) if (!merged.some((x) => x.item === s.item && x.entity === s.entity)) merged.push(s)
    this.setSelection(merged)
  }

  /** Entrée, Espace ou clic droit. */
  onEnter(): void {
    const p = this.pending
    if (!p) {
      if (this.lastCommand) void this.run(this.lastCommand)
      return
    }
    if (p.kind === 'point') {
      this.pending = null
      p.resolve(null)
    } else if (p.kind === 'select') {
      this.pending = null
      const sel = this.selection.filter((s) => !p.filter || p.filter(s))
      this.setSelection([])
      p.resolve(sel)
    } else this.onText('')
  }

  onEscape(): void {
    if (this.grip) {
      this.grip = null
      this.requestDraw()
      return
    }
    if (this.pending || this.running) {
      this.cancel()
      return
    }
    if (this.selection.length) this.setSelection([])
  }

  /** Texte validé dans la ligne de commande. */
  onText(input: string): void {
    const text = input.trim()
    const p = this.pending
    if (!p) {
      if (!text) {
        this.onEnter()
        return
      }
      void this.run(text.split(/\s+/)[0])
      return
    }
    if (p.kind === 'point') {
      if (!text) {
        this.onEnter()
        return
      }
      const kw = this.matchKeyword(text, p.opts.keywords)
      if (kw) {
        this.pending = null
        p.resolve(kw)
        return
      }
      const r = parsePointInput(text, p.opts.base ?? this.lastPoint, this.cursor)
      if (r === undefined || (typeof r === 'number' && !p.opts.acceptNumber)) {
        this.message('Saisie non comprise. Exemples : 783640.5,427210.2 · @10,0 · @25<45 · @25<150g · ou un clic.')
        return
      }
      this.pending = null
      if (Array.isArray(r)) this.lastPoint = r
      p.resolve(r)
      return
    }
    if (p.kind === 'select') {
      if (!text) {
        this.onEnter()
        return
      }
      // Comme dans AutoCAD : « Tout » ou « Dernier » à l'invite de choix des objets.
      const u = norm(text)
      const item = this.activeItem && this.project.items.includes(this.activeItem) ? this.activeItem : this.project.items.find((i) => isEditable(this.project, i))
      if (!item) return
      const all: Selection[] = []
      item.ds.entities.forEach((e, i) => {
        if (item.ds.layers.get(e.layer)?.visible === false) return
        const s: Selection = { item, entity: i }
        if (!p.filter || p.filter(s)) all.push(s)
      })
      let found: Selection[] | null = null
      if (u === 'T' || u === 'TOUT' || u === 'ALL') found = all
      else if (u === 'D' || u === 'DERNIER' || u === 'L' || u === 'LAST') found = all.length ? [all[all.length - 1]] : []
      if (!found) {
        this.message('Désignez les objets à la souris, ou tapez T (tout) ou D (dernier objet).')
        return
      }
      if (p.single) {
        if (!found.length) return
        this.pending = null
        p.resolve([found[found.length - 1]])
        return
      }
      this.pending = null
      this.setSelection([])
      p.resolve(found)
      return
    }
    const r = p.parse(text)
    if (!r.ok) {
      this.message(r.error)
      return
    }
    this.pending = null
    p.resolve(r.value)
  }

  /**
   * Exécute un script : une saisie par ligne, comme un fichier .scr d'AutoCAD (nom de
   * commande, coordonnées, valeurs, options). Ligne vide = Entrée pendant une commande ;
   * « ; » commence un commentaire. Renvoie le nombre de saisies envoyées.
   */
  async runScript(text: string): Promise<number> {
    const settle = async () => {
      for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0))
    }
    let n = 0
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (line.startsWith(';')) continue
      await settle()
      if (!line && !this.pending) continue
      this.onText(line)
      n++
    }
    await settle()
    return n
  }

  // --- Poignées ----------------------------------------------------------------------

  gripAt(raw: Pt): Grip | null {
    if (this.pending || this.running || !this.selection.length || this.selection.length > 60) return null
    const tol = this.pickTol()
    for (const s of this.selection) {
      if (!isEditable(this.project, s.item)) continue
      const e = this.entity(s)
      if (!e) continue
      const g = grips(e)
      for (let i = 0; i < g.length; i++) if (Math.abs(g[i][0] - raw[0]) <= tol && Math.abs(g[i][1] - raw[1]) <= tol) return { sel: s, index: i, x: g[i][0], y: g[i][1] }
    }
    return null
  }

  startGrip(g: Grip): void {
    this.grip = { ...g, cur: [g.x, g.y] }
    this.message('Étirer : déplacez la poignée puis cliquez (Échap pour annuler).')
  }

  get gripActive(): boolean {
    return !!this.grip
  }

  endGrip(): void {
    const g = this.grip
    this.grip = null
    if (!g) return
    const e = this.entity(g.sel)
    const moved = moveGrip(e, g.index, g.cur[0], g.cur[1])
    this.modify('Poignée', new Map([[g.sel.item, { replace: new Map([[g.sel.entity, moved]]) }]]))
  }

  // --- Surcouche ----------------------------------------------------------------------

  draw(c: CanvasRenderingContext2D, toScreen: (x: number, y: number) => [number, number], dpr: number, dark: boolean): void {
    const accent = dark ? '#4fc3ff' : '#0a6fd6'
    const path = (pts: ArrayLike<number>, closed: boolean) => {
      for (let i = 0; i < pts.length; i += 2) {
        const p = toScreen(pts[i], pts[i + 1])
        if (i === 0) c.moveTo(p[0], p[1])
        else c.lineTo(p[0], p[1])
      }
      if (closed) c.closePath()
    }
    // Sélection
    if (this.selection.length) {
      this.selGeom ??= selectionGeometry(this.selection)
      const g = this.selGeom
      c.save()
      c.setLineDash([6 * dpr, 4 * dpr])
      c.lineWidth = 2 * dpr
      c.strokeStyle = accent
      c.beginPath()
      g.lines.forEach((l, i) => path(l, g.closed[i]))
      c.stroke()
      c.setLineDash([])
      c.fillStyle = accent
      for (let i = 0; i < g.points.length; i += 2) {
        const p = toScreen(g.points[i], g.points[i + 1])
        c.beginPath()
        c.arc(p[0], p[1], 4 * dpr, 0, Math.PI * 2)
        c.fill()
      }
      // Poignées
      if (!this.running && this.selection.length <= 60) {
        c.fillStyle = '#2f7cf6'
        c.strokeStyle = '#ffffff'
        c.lineWidth = 1 * dpr
        const r = 4 * dpr
        for (const s of this.selection) {
          if (!isEditable(this.project, s.item)) continue
          const e = this.entity(s)
          if (!e) continue
          for (const q of grips(e).slice(0, 400)) {
            const p = toScreen(q[0], q[1])
            c.fillRect(p[0] - r, p[1] - r, r * 2, r * 2)
            c.strokeRect(p[0] - r, p[1] - r, r * 2, r * 2)
          }
        }
      }
      c.restore()
    }
    // Aperçu de la commande
    const ghosts: Ghost[] = []
    if (this.ghost) ghosts.push(this.ghost)
    const p = this.pending
    if (p?.kind === 'point' && this.cursor) {
      const g = p.opts.preview?.(this.cursor)
      if (g) ghosts.push(g)
      else if (p.opts.base) ghosts.push({ lines: [[p.opts.base[0], p.opts.base[1], this.cursor[0], this.cursor[1]]] })
    }
    if (this.grip) {
      const e = this.entity(this.grip.sel)
      const moved = e ? moveGrip(e, this.grip.index, this.grip.cur[0], this.grip.cur[1]) : null
      const v = moved && (moved.t === 'line' ? [moved.x1, moved.y1, moved.x2, moved.y2] : moved.t === 'pline' ? Array.from(moved.pts) : moved.t === 'polygon' ? Array.from(moved.rings[0]) : null)
      ghosts.push({ lines: [v ?? [this.grip.x, this.grip.y, this.grip.cur[0], this.grip.cur[1]]], closed: [!!moved && ((moved.t === 'pline' && moved.closed) || moved.t === 'polygon')] })
    }
    if (ghosts.length) {
      c.save()
      c.strokeStyle = dark ? '#ffd54f' : '#d35400'
      c.fillStyle = c.strokeStyle
      c.lineWidth = 1.5 * dpr
      for (const g of ghosts) {
        c.beginPath()
        g.lines.forEach((l, i) => path(l, !!g.closed?.[i]))
        c.stroke()
        c.font = `${12 * dpr}px Arial, sans-serif`
        for (const t of g.texts ?? []) {
          const q = toScreen(t.x, t.y)
          c.fillText(t.text, q[0] + 8 * dpr, q[1] - 8 * dpr)
        }
      }
      c.restore()
    }
    // Marque d'accrochage
    if (this.snap && this.snap.kind !== 'libre') {
      const q = toScreen(this.snap.x, this.snap.y)
      const r = 7 * dpr
      c.save()
      c.strokeStyle = '#ffb300'
      c.lineWidth = 2 * dpr
      c.beginPath()
      switch (this.snap.kind) {
        case 'extrémité':
          c.rect(q[0] - r, q[1] - r, 2 * r, 2 * r)
          break
        case 'milieu':
          c.moveTo(q[0], q[1] - r)
          c.lineTo(q[0] + r, q[1] + r)
          c.lineTo(q[0] - r, q[1] + r)
          c.closePath()
          break
        case 'centre':
        case 'nœud':
          c.arc(q[0], q[1], r, 0, Math.PI * 2)
          if (this.snap.kind === 'nœud') {
            c.moveTo(q[0] - r, q[1] - r)
            c.lineTo(q[0] + r, q[1] + r)
            c.moveTo(q[0] + r, q[1] - r)
            c.lineTo(q[0] - r, q[1] + r)
          }
          break
        case 'intersection':
          c.moveTo(q[0] - r, q[1] - r)
          c.lineTo(q[0] + r, q[1] + r)
          c.moveTo(q[0] + r, q[1] - r)
          c.lineTo(q[0] - r, q[1] + r)
          break
        case 'perpendiculaire':
          c.moveTo(q[0] - r, q[1] - r)
          c.lineTo(q[0] - r, q[1] + r)
          c.lineTo(q[0] + r, q[1] + r)
          c.moveTo(q[0] - r, q[1])
          c.lineTo(q[0], q[1])
          c.lineTo(q[0], q[1] + r)
          break
        case 'proche':
          c.moveTo(q[0] - r, q[1] - r)
          c.lineTo(q[0] + r, q[1] - r)
          c.lineTo(q[0] - r, q[1] + r)
          c.lineTo(q[0] + r, q[1] + r)
          c.closePath()
          break
        case 'insertion':
          c.rect(q[0] - r, q[1] - r, r, r)
          c.rect(q[0], q[1], r, r)
          break
      }
      c.stroke()
      c.font = `${11 * dpr}px Arial, sans-serif`
      const label = this.snap.kind.charAt(0).toUpperCase() + this.snap.kind.slice(1)
      const w = c.measureText(label).width
      c.fillStyle = 'rgba(30,30,30,0.85)'
      c.fillRect(q[0] + 12 * dpr, q[1] + 10 * dpr, w + 8 * dpr, 16 * dpr)
      c.fillStyle = '#ffd54f'
      c.fillText(label, q[0] + 16 * dpr, q[1] + 22 * dpr)
      c.restore()
    }
  }
}

export function fmt(n: number, d = 3): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(d).replace(/0+$/, '').replace(/\.$/, '')
}
