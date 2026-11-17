/**
 * Vue interactive : déplacement, zoom, sélection, mesures avec accrochage.
 *
 * La scène est tracée dans une image tampon ; pendant un déplacement, c'est cette
 * image qui est recalée instantanément, puis la scène est retracée dès que possible.
 * L'interface reste fluide même sur un dessin lourd ou un appareil modeste.
 */
import { distToSegment2, pointInRing, polylineLength, ringArea } from '../core/geom'
import type { Item, Project, Selection } from '../core/project'
import type { Extent } from '../core/types'
import { TILE_SOURCES, drawBasemap } from './basemap'
import { CanvasPainter, drawDisplayList, type View } from './painter'

export type Tool = 'select' | 'distance' | 'area'

export interface Snap {
  x: number
  y: number
  kind: 'sommet' | 'point' | 'libre'
}

export class MapView {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private scene: HTMLCanvasElement
  private sceneCtx: CanvasRenderingContext2D
  private sceneView: View | null = null
  view: View = { cx: 0, cy: 0, scale: 1, ox: 0, oy: 0 }
  dark = false
  basemap = 'aucun'
  tool: Tool = 'select'
  snapEnabled = true
  /** Points de la mesure en cours (coordonnées du projet). */
  measure: number[] = []
  measureDone = false
  private cursor: Snap | null = null
  private dirty = true
  private frame = 0
  private lastRenderMs = 0
  private idleTimer = 0
  private highlight: { item: Item; polys: number[]; points: number[]; texts: number[]; fills: number[] } | null = null
  private pointers = new Map<number, { x: number; y: number }>()
  private dragStart: { x: number; y: number; moved: boolean } | null = null
  private pinch: { d: number; cx: number; cy: number } | null = null
  onCursor: (x: number, y: number, snap: Snap | null) => void = () => {}
  onMeasure: () => void = () => {}
  onViewChange: () => void = () => {}

  constructor(
    private container: HTMLElement,
    private project: Project,
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'map-canvas'
    this.canvas.tabIndex = 0
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.scene = document.createElement('canvas')
    this.sceneCtx = this.scene.getContext('2d')!
    new ResizeObserver(() => this.resize()).observe(container)
    this.resize()
    this.bind()
    project.on((what) => {
      if (what === 'selection') this.updateHighlight()
      else this.highlight = null
      if (what !== 'selection') this.dirty = true
      this.schedule()
    })
  }

  get dpr(): number {
    return Math.min(window.devicePixelRatio || 1, 2.5)
  }

  private resize(): void {
    const r = this.container.getBoundingClientRect()
    const w = Math.max(50, Math.round(r.width * this.dpr))
    const h = Math.max(50, Math.round(r.height * this.dpr))
    if (this.canvas.width === w && this.canvas.height === h) return
    this.canvas.width = w
    this.canvas.height = h
    this.canvas.style.width = r.width + 'px'
    this.canvas.style.height = r.height + 'px'
    this.scene.width = w
    this.scene.height = h
    this.view.ox = w / 2
    this.view.oy = h / 2
    this.sceneView = null
    this.dirty = true
    this.schedule()
  }

  /** Cadre la vue sur une emprise (par défaut : tout le projet). */
  fit(extent: Extent | null = this.project.extent()): void {
    if (!extent) return
    const w = Math.max(extent[2] - extent[0], 1e-9)
    const h = Math.max(extent[3] - extent[1], 1e-9)
    this.view.cx = (extent[0] + extent[2]) / 2
    this.view.cy = (extent[1] + extent[3]) / 2
    this.view.scale = Math.min(this.canvas.width / w, this.canvas.height / h) * 0.9
    if (!Number.isFinite(this.view.scale) || this.view.scale <= 0) this.view.scale = 1
    this.invalidate()
  }

  invalidate(): void {
    this.dirty = true
    this.schedule()
    this.onViewChange()
  }

  private schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.draw()
    })
  }

  toWorld(px: number, py: number): [number, number] {
    return [this.view.cx + (px - this.view.ox) / this.view.scale, this.view.cy - (py - this.view.oy) / this.view.scale]
  }

  toScreen(x: number, y: number): [number, number] {
    return [this.view.ox + (x - this.view.cx) * this.view.scale, this.view.oy - (y - this.view.cy) * this.view.scale]
  }

  private viewport(): Extent {
    const a = this.toWorld(0, this.canvas.height)
    const b = this.toWorld(this.canvas.width, 0)
    return [a[0], a[1], b[0], b[1]]
  }

  private renderScene(): void {
    const t0 = performance.now()
    const c = this.sceneCtx
    const w = this.scene.width
    const h = this.scene.height
    c.setTransform(1, 0, 0, 1, 0, 0)
    const source = TILE_SOURCES.find((s) => s.id === this.basemap)
    const withMap = !!source && !!this.project.crs
    c.fillStyle = this.dark && !withMap ? '#1b1f24' : '#ffffff'
    c.fillRect(0, 0, w, h)
    let mapDrawn = false
    if (withMap) {
      mapDrawn = drawBasemap(c, this.view, w, h, this.project.crs as string, source, () => {
        this.dirty = true
        this.schedule()
      })
      if (mapDrawn) {
        // Voile clair : le dessin reste lisible par-dessus la carte.
        c.fillStyle = 'rgba(255,255,255,0.25)'
        c.fillRect(0, 0, w, h)
      }
    }
    const light = !this.dark || withMap
    const painter = new CanvasPainter(c)
    const viewport = this.viewport()
    const dpr = this.dpr
    for (const item of this.project.items) {
      if (!item.ds.visible) continue
      drawDisplayList(painter, item.dl, this.view, {
        foreground: light ? [20, 20, 20] : [240, 240, 240],
        lightBackground: light,
        lineWidth: (lw) => (lw >= 0.3 ? Math.min(4, 1 + lw * 2.2) : 1) * dpr,
        pointRadius: 1.4 * dpr,
        minText: 3.2 * dpr,
        minSize: 0.6,
        maxTexts: 6000,
        viewport,
        layerVisible: item.vis,
      })
    }
    if (mapDrawn && source) {
      c.font = `${10 * dpr}px Arial, sans-serif`
      const tw = c.measureText(source.attribution).width
      c.fillStyle = 'rgba(255,255,255,0.8)'
      c.fillRect(w - tw - 10 * dpr, h - 16 * dpr, tw + 10 * dpr, 16 * dpr)
      c.fillStyle = '#333'
      c.textBaseline = 'alphabetic'
      c.textAlign = 'left'
      c.fillText(source.attribution, w - tw - 5 * dpr, h - 4.5 * dpr)
    }
    this.sceneView = { ...this.view }
    this.lastRenderMs = performance.now() - t0
  }

  private draw(): void {
    const same = this.sceneView && this.sceneView.cx === this.view.cx && this.sceneView.cy === this.view.cy && this.sceneView.scale === this.view.scale
    if (this.dirty || !this.sceneView || (!same && this.lastRenderMs < 28)) {
      this.renderScene()
      this.dirty = false
    } else if (!same) {
      // Scène lourde : on recale l'image existante et on retrace au repos.
      clearTimeout(this.idleTimer)
      this.idleTimer = window.setTimeout(() => {
        this.dirty = true
        this.schedule()
      }, 90)
    }
    const c = this.ctx
    const sv = this.sceneView as View
    c.setTransform(1, 0, 0, 1, 0, 0)
    if (sv.cx === this.view.cx && sv.cy === this.view.cy && sv.scale === this.view.scale) {
      c.drawImage(this.scene, 0, 0)
    } else {
      c.fillStyle = this.dark ? '#1b1f24' : '#ffffff'
      c.fillRect(0, 0, this.canvas.width, this.canvas.height)
      const r = this.view.scale / sv.scale
      c.setTransform(r, 0, 0, r, this.view.ox + (sv.cx - this.view.cx) * this.view.scale - sv.ox * r, this.view.oy - (sv.cy - this.view.cy) * this.view.scale - sv.oy * r)
      c.drawImage(this.scene, 0, 0)
      c.setTransform(1, 0, 0, 1, 0, 0)
    }
    this.drawOverlay()
  }

  // --- Surcouche : sélection, mesure, accrochage ----------------------------

  private updateHighlight(): void {
    const sel = this.project.selection
    if (!sel) {
      this.highlight = null
      return
    }
    const dl = sel.item.dl
    const polys: number[] = []
    const points: number[] = []
    const texts: number[] = []
    const fills: number[] = []
    for (let i = 0; i < dl.polyEnt.length; i++) if (dl.polyEnt[i] === sel.entity) polys.push(i)
    for (let i = 0; i < dl.pointEnt.length; i++) if (dl.pointEnt[i] === sel.entity) points.push(i)
    dl.texts.forEach((t, i) => t.ent === sel.entity && texts.push(i))
    dl.fills.forEach((f, i) => f.ent === sel.entity && fills.push(i))
    this.highlight = { item: sel.item, polys, points, texts, fills }
  }

  private drawOverlay(): void {
    const c = this.ctx
    const dpr = this.dpr
    const hl = this.highlight
    if (hl) {
      const dl = hl.item.dl
      c.lineJoin = 'round'
      c.lineCap = 'round'
      for (const pass of [
        { color: 'rgba(255,255,255,0.9)', width: 6 * dpr },
        { color: '#ff3d9a', width: 3 * dpr },
      ]) {
        c.strokeStyle = pass.color
        c.lineWidth = pass.width
        c.beginPath()
        for (const i of hl.polys) {
          const from = dl.polyStart[i] * 2
          const to = dl.polyStart[i + 1] * 2
          const p = this.toScreen(dl.coords[from], dl.coords[from + 1])
          c.moveTo(p[0], p[1])
          for (let j = from + 2; j < to; j += 2) {
            const q = this.toScreen(dl.coords[j], dl.coords[j + 1])
            c.lineTo(q[0], q[1])
          }
          if (dl.polyClosed[i]) c.closePath()
        }
        for (const i of hl.fills) {
          for (const r of dl.fills[i].rings) {
            const p = this.toScreen(r[0], r[1])
            c.moveTo(p[0], p[1])
            for (let j = 2; j < r.length; j += 2) {
              const q = this.toScreen(r[j], r[j + 1])
              c.lineTo(q[0], q[1])
            }
            c.closePath()
          }
        }
        c.stroke()
      }
      c.fillStyle = '#ff3d9a'
      c.strokeStyle = '#ffffff'
      c.lineWidth = 2 * dpr
      for (const i of hl.points) {
        const p = this.toScreen(dl.points[i * 2], dl.points[i * 2 + 1])
        c.beginPath()
        c.arc(p[0], p[1], 6 * dpr, 0, Math.PI * 2)
        c.fill()
        c.stroke()
      }
      for (const i of hl.texts) {
        const t = dl.texts[i]
        const p = this.toScreen(t.x, t.y)
        c.beginPath()
        c.arc(p[0], p[1], 5 * dpr, 0, Math.PI * 2)
        c.fill()
        c.stroke()
      }
    }
    // Mesure en cours
    if (this.measure.length >= 2) {
      const pts = [...this.measure]
      if (!this.measureDone && this.cursor) pts.push(this.cursor.x, this.cursor.y)
      c.lineWidth = 2 * dpr
      c.strokeStyle = '#0a84ff'
      c.fillStyle = 'rgba(10,132,255,0.15)'
      c.beginPath()
      for (let i = 0; i < pts.length; i += 2) {
        const p = this.toScreen(pts[i], pts[i + 1])
        if (i === 0) c.moveTo(p[0], p[1])
        else c.lineTo(p[0], p[1])
      }
      if (this.tool === 'area' && pts.length >= 6) {
        c.closePath()
        c.fill()
      }
      c.stroke()
      c.fillStyle = '#0a84ff'
      for (let i = 0; i < this.measure.length; i += 2) {
        const p = this.toScreen(this.measure[i], this.measure[i + 1])
        c.beginPath()
        c.arc(p[0], p[1], 3.5 * dpr, 0, Math.PI * 2)
        c.fill()
      }
    }
    // Marque d'accrochage
    if (this.tool !== 'select' && this.cursor && this.cursor.kind !== 'libre') {
      const p = this.toScreen(this.cursor.x, this.cursor.y)
      const r = 7 * dpr
      c.strokeStyle = '#ff9500'
      c.lineWidth = 2 * dpr
      c.strokeRect(p[0] - r, p[1] - r, r * 2, r * 2)
    }
  }

  /** Longueur et surface de la mesure en cours. */
  measureResult(): { length: number; area: number; points: number } {
    const pts = [...this.measure]
    if (!this.measureDone && this.cursor && pts.length) pts.push(this.cursor.x, this.cursor.y)
    return { length: polylineLength(pts, this.tool === 'area' && pts.length >= 6), area: Math.abs(ringArea(pts)), points: pts.length >> 1 }
  }

  setTool(tool: Tool): void {
    this.tool = tool
    this.measure = []
    this.measureDone = false
    this.canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair'
    this.onMeasure()
    this.schedule()
  }

  // --- Sélection et accrochage ----------------------------------------------

  pick(x: number, y: number): Selection | null {
    const tol = (7 * this.dpr) / this.view.scale
    let best: Selection | null = null
    let bestD = Infinity
    for (let k = this.project.items.length - 1; k >= 0; k--) {
      const item = this.project.items[k]
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

  private snapAt(x: number, y: number): Snap {
    if (!this.snapEnabled) return { x, y, kind: 'libre' }
    const tol = (11 * this.dpr) / this.view.scale
    let best: Snap = { x, y, kind: 'libre' }
    let bestD = tol
    for (const item of this.project.items) {
      if (!item.ds.visible) continue
      const dl = item.dl
      if (dl.pointIndex) {
        for (const i of dl.pointIndex.search(x - tol, y - tol, x + tol, y + tol)) {
          if (!item.vis[dl.pointLayer[i]]) continue
          const d = Math.hypot(dl.points[i * 2] - x, dl.points[i * 2 + 1] - y)
          if (d < bestD) [bestD, best] = [d, { x: dl.points[i * 2], y: dl.points[i * 2 + 1], kind: 'point' }]
        }
      }
      if (dl.polyIndex) {
        for (const i of dl.polyIndex.search(x - tol, y - tol, x + tol, y + tol)) {
          if (!item.vis[dl.polyLayer[i]]) continue
          const to = dl.polyStart[i + 1] * 2
          for (let j = dl.polyStart[i] * 2; j < to; j += 2) {
            const d = Math.hypot(dl.coords[j] - x, dl.coords[j + 1] - y)
            if (d < bestD) [bestD, best] = [d, { x: dl.coords[j], y: dl.coords[j + 1], kind: 'sommet' }]
          }
        }
      }
    }
    return best
  }

  // --- Interactions ---------------------------------------------------------

  private bind(): void {
    const cv = this.canvas
    const pos = (e: PointerEvent | WheelEvent | MouseEvent): [number, number] => {
      const r = cv.getBoundingClientRect()
      return [(e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr]
    }
    const zoomAt = (px: number, py: number, factor: number) => {
      const w = this.toWorld(px, py)
      this.view.scale = Math.max(1e-9, Math.min(1e9, this.view.scale * factor))
      this.view.cx = w[0] - (px - this.view.ox) / this.view.scale
      this.view.cy = w[1] + (py - this.view.oy) / this.view.scale
      this.schedule()
      this.onViewChange()
    }
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const [px, py] = pos(e)
        zoomAt(px, py, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)))
      },
      { passive: false },
    )
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId)
      const [px, py] = pos(e)
      this.pointers.set(e.pointerId, { x: px, y: py })
      if (this.pointers.size === 1) this.dragStart = { x: px, y: py, moved: false }
      else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()]
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
        if (this.dragStart) this.dragStart.moved = true
      }
    })
    cv.addEventListener('pointermove', (e) => {
      const [px, py] = pos(e)
      const prev = this.pointers.get(e.pointerId)
      if (prev && this.pointers.size === 2 && this.pinch) {
        this.pointers.set(e.pointerId, { x: px, y: py })
        const [a, b] = [...this.pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        this.view.cx -= (cx - this.pinch.cx) / this.view.scale
        this.view.cy += (cy - this.pinch.cy) / this.view.scale
        if (this.pinch.d > 0 && d > 0) zoomAt(cx, cy, d / this.pinch.d)
        this.pinch = { d, cx, cy }
        return
      }
      if (prev && this.dragStart) {
        if (!this.dragStart.moved && Math.hypot(px - this.dragStart.x, py - this.dragStart.y) > 4 * this.dpr) this.dragStart.moved = true
        if (this.dragStart.moved) {
          this.view.cx -= (px - prev.x) / this.view.scale
          this.view.cy += (py - prev.y) / this.view.scale
          this.onViewChange()
        }
        this.pointers.set(e.pointerId, { x: px, y: py })
      }
      const w = this.toWorld(px, py)
      this.cursor = this.tool === 'select' ? { x: w[0], y: w[1], kind: 'libre' } : this.snapAt(w[0], w[1])
      this.onCursor(this.cursor.x, this.cursor.y, this.cursor)
      if (this.tool !== 'select' && this.measure.length) this.onMeasure()
      this.schedule()
    })
    const up = (e: PointerEvent) => {
      const [px, py] = pos(e)
      const wasDrag = this.dragStart?.moved
      this.pointers.delete(e.pointerId)
      if (this.pointers.size < 2) this.pinch = null
      if (this.pointers.size === 0) {
        this.dragStart = null
        if (!wasDrag && e.type === 'pointerup') this.click(px, py)
      }
    }
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', up)
    cv.addEventListener('dblclick', () => {
      if (this.tool !== 'select' && this.measure.length >= 4) {
        this.measureDone = true
        this.onMeasure()
        this.schedule()
      }
    })
    cv.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.measure = []
        this.measureDone = false
        this.project.select(null)
        this.onMeasure()
        this.schedule()
      }
    })
  }

  private click(px: number, py: number): void {
    const w = this.toWorld(px, py)
    if (this.tool === 'select') {
      this.project.select(this.pick(w[0], w[1]))
      return
    }
    if (this.measureDone) {
      this.measure = []
      this.measureDone = false
    }
    const s = this.snapAt(w[0], w[1])
    const n = this.measure.length
    // Un double-clic produit deux clics au même endroit : on n'ajoute pas le point deux fois.
    if (n >= 2 && this.measure[n - 2] === s.x && this.measure[n - 1] === s.y) return
    this.measure.push(s.x, s.y)
    this.onMeasure()
    this.schedule()
  }
}
