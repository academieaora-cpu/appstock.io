/**
 * Zone de dessin : affichage, navigation et entrées souris, sur le modèle d'AutoCAD.
 *
 * - molette : zoom autour du curseur ; clic molette, Espace + glisser ou un doigt : déplacer ;
 * - clic : désigner un objet ou donner un point à la commande en cours ;
 * - glisser sur le vide : fenêtre de sélection (vers la droite : objets entièrement dedans ;
 *   vers la gauche : objets touchés) ;
 * - clic droit : Entrée (terminer la commande ou la répéter).
 *
 * La scène est tracée dans une image tampon ; pendant un déplacement, c'est cette image
 * qui est recalée, puis la scène est retracée : l'affichage reste fluide sur un gros plan.
 */
import type { Editor } from '../edit/editor'
import type { Snap } from '../edit/query'
import type { Project } from '../core/project'
import type { Extent } from '../core/types'
import { TILE_SOURCES, drawBasemap } from './basemap'
import { CanvasPainter, drawDisplayList, type View } from './painter'

type Mode = 'pending' | 'pan' | 'window' | 'grip' | 'gripclick'

export class MapView {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private scene: HTMLCanvasElement
  private sceneCtx: CanvasRenderingContext2D
  private sceneView: View | null = null
  view: View = { cx: 0, cy: 0, scale: 1, ox: 0, oy: 0 }
  dark = true
  basemap = 'aucun'
  /** Espace enfoncée : glisser déplace la vue. */
  spaceDown = false
  /** Dessins supplémentaires en surcouche (cadre de mise en page…). */
  overlays: ((c: CanvasRenderingContext2D, mv: MapView) => void)[] = []
  private dirty = true
  private frame = 0
  private lastRenderMs = 0
  private idleTimer = 0
  private pointers = new Map<number, { x: number; y: number }>()
  private drag: { x: number; y: number; mode: Mode; moved: boolean } | null = null
  private pinch: { d: number; cx: number; cy: number } | null = null
  private hover: [number, number] | null = null
  private windowRect: [number, number, number, number] | null = null
  onCursor: (x: number, y: number, snap: Snap | null) => void = () => {}
  onViewChange: () => void = () => {}

  constructor(
    private container: HTMLElement,
    private project: Project,
    private editor: Editor,
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
    editor.pickTol = () => (7 * this.dpr) / this.view.scale
    editor.requestDraw = () => this.schedule()
    project.on(() => {
      this.dirty = true
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

  schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.draw()
    })
  }

  toWorld(px: number, py: number): [number, number] {
    return [this.view.cx + (px - this.view.ox) / this.view.scale, this.view.cy - (py - this.view.oy) / this.view.scale]
  }

  toScreen = (x: number, y: number): [number, number] => [this.view.ox + (x - this.view.cx) * this.view.scale, this.view.oy - (y - this.view.cy) * this.view.scale]

  viewport(): Extent {
    const a = this.toWorld(0, this.canvas.height)
    const b = this.toWorld(this.canvas.width, 0)
    return [a[0], a[1], b[0], b[1]]
  }

  zoomBy(factor: number, px = this.canvas.width / 2, py = this.canvas.height / 2): void {
    const w = this.toWorld(px, py)
    this.view.scale = Math.max(1e-9, Math.min(1e9, this.view.scale * factor))
    this.view.cx = w[0] - (px - this.view.ox) / this.view.scale
    this.view.cy = w[1] + (py - this.view.oy) / this.view.scale
    this.schedule()
    this.onViewChange()
  }

  private renderScene(): void {
    const t0 = performance.now()
    const c = this.sceneCtx
    const w = this.scene.width
    const h = this.scene.height
    c.setTransform(1, 0, 0, 1, 0, 0)
    const source = TILE_SOURCES.find((s) => s.id === this.basemap)
    const withMap = !!source && !!this.project.crs
    c.fillStyle = this.dark && !withMap ? '#20252c' : '#ffffff'
    c.fillRect(0, 0, w, h)
    let mapDrawn = false
    if (withMap && source) {
      mapDrawn = drawBasemap(c, this.view, w, h, this.project.crs as string, source, () => {
        this.dirty = true
        this.schedule()
      })
      if (mapDrawn) {
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
        foreground: light ? [20, 20, 20] : [235, 235, 235],
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
    const sv0 = this.sceneView
    const same = sv0 && sv0.cx === this.view.cx && sv0.cy === this.view.cy && sv0.scale === this.view.scale
    if (this.dirty || !sv0 || (!same && this.lastRenderMs < 28)) {
      this.renderScene()
      this.dirty = false
    } else if (!same) {
      clearTimeout(this.idleTimer)
      this.idleTimer = window.setTimeout(() => {
        this.dirty = true
        this.schedule()
      }, 90)
    }
    const c = this.ctx
    const sv = this.sceneView as View
    c.setTransform(1, 0, 0, 1, 0, 0)
    if (sv.cx === this.view.cx && sv.cy === this.view.cy && sv.scale === this.view.scale) c.drawImage(this.scene, 0, 0)
    else {
      c.fillStyle = this.dark ? '#20252c' : '#ffffff'
      c.fillRect(0, 0, this.canvas.width, this.canvas.height)
      const r = this.view.scale / sv.scale
      c.setTransform(r, 0, 0, r, this.view.ox + (sv.cx - this.view.cx) * this.view.scale - sv.ox * r, this.view.oy - (sv.cy - this.view.cy) * this.view.scale - sv.oy * r)
      c.drawImage(this.scene, 0, 0)
      c.setTransform(1, 0, 0, 1, 0, 0)
    }
    const dark = this.dark && !(TILE_SOURCES.some((s) => s.id === this.basemap) && this.project.crs)
    for (const o of this.overlays) o(c, this)
    this.editor.draw(c, this.toScreen, this.dpr, dark)
    if (this.windowRect) {
      const [x0, y0, x1, y1] = this.windowRect
      const crossing = x1 < x0
      c.save()
      c.fillStyle = crossing ? 'rgba(60,200,90,0.15)' : 'rgba(60,130,255,0.15)'
      c.strokeStyle = crossing ? '#3cc85a' : '#3c82ff'
      c.lineWidth = 1 * this.dpr
      if (crossing) c.setLineDash([6 * this.dpr, 4 * this.dpr])
      c.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
      c.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
      c.restore()
    }
    // Réticule
    if (this.hover && !this.drag?.moved) {
      const [hx, hy] = this.hover
      const dpr = this.dpr
      const arm = 22 * dpr
      c.save()
      c.strokeStyle = dark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)'
      c.lineWidth = 1
      c.beginPath()
      c.moveTo(hx - arm, hy + 0.5)
      c.lineTo(hx + arm, hy + 0.5)
      c.moveTo(hx + 0.5, hy - arm)
      c.lineTo(hx + 0.5, hy + arm)
      c.stroke()
      if (!this.editor.busy || this.editor.promptText.startsWith('Sélectionnez')) {
        const b = 5 * dpr
        c.strokeRect(hx - b + 0.5, hy - b + 0.5, 2 * b, 2 * b)
      }
      c.restore()
    }
  }

  // --- Entrées ------------------------------------------------------------------------

  private bind(): void {
    const cv = this.canvas
    const pos = (e: PointerEvent | WheelEvent | MouseEvent): [number, number] => {
      const r = cv.getBoundingClientRect()
      return [(e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr]
    }
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const [px, py] = pos(e)
        this.zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)), px, py)
      },
      { passive: false },
    )
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.editor.onEnter()
    })
    cv.addEventListener('pointerdown', (e) => {
      cv.focus({ preventScroll: true })
      if (e.button === 2) return
      cv.setPointerCapture(e.pointerId)
      const [px, py] = pos(e)
      this.pointers.set(e.pointerId, { x: px, y: py })
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()]
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
        if (this.drag) this.drag.mode = 'pan'
        return
      }
      const w = this.toWorld(px, py)
      let mode: Mode = 'pending'
      if (e.button === 1 || this.spaceDown) mode = 'pan'
      else if (this.editor.gripActive) mode = 'gripclick'
      else {
        const g = this.editor.gripAt(w)
        if (g) {
          this.editor.startGrip(g)
          mode = 'grip'
        }
      }
      this.drag = { x: px, y: py, mode, moved: false }
    })
    cv.addEventListener('pointermove', (e) => {
      const [px, py] = pos(e)
      this.hover = [px, py]
      const prev = this.pointers.get(e.pointerId)
      if (prev && this.pointers.size === 2 && this.pinch) {
        this.pointers.set(e.pointerId, { x: px, y: py })
        const [a, b] = [...this.pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        this.view.cx -= (cx - this.pinch.cx) / this.view.scale
        this.view.cy += (cy - this.pinch.cy) / this.view.scale
        if (this.pinch.d > 0 && d > 0) this.zoomBy(d / this.pinch.d, cx, cy)
        this.pinch = { d, cx, cy }
        return
      }
      const d = this.drag
      if (d && prev) {
        if (!d.moved && Math.hypot(px - d.x, py - d.y) > 4 * this.dpr) {
          d.moved = true
          if (d.mode === 'pending') {
            // Pendant une commande qui attend un point, ou au doigt : glisser déplace la vue.
            const wantsPoint = this.editor.busy && !this.editor.promptText.startsWith('Sélectionnez')
            d.mode = wantsPoint || e.pointerType === 'touch' ? 'pan' : 'window'
          }
        }
        if (d.moved && d.mode === 'pan') {
          this.view.cx -= (px - prev.x) / this.view.scale
          this.view.cy += (py - prev.y) / this.view.scale
          this.onViewChange()
        }
        if (d.mode === 'window') this.windowRect = [d.x, d.y, px, py]
        this.pointers.set(e.pointerId, { x: px, y: py })
      }
      const w = this.toWorld(px, py)
      const snap = this.editor.onMove(w)
      const cur = this.editor.cursor ?? w
      this.onCursor(cur[0], cur[1], snap)
      this.schedule()
    })
    cv.addEventListener('pointerleave', () => {
      this.hover = null
      this.schedule()
    })
    const up = (e: PointerEvent) => {
      const [px, py] = pos(e)
      const d = this.drag
      this.pointers.delete(e.pointerId)
      if (this.pointers.size < 2) this.pinch = null
      if (this.pointers.size > 0) return
      this.drag = null
      if (!d || e.type === 'pointercancel') {
        this.windowRect = null
        this.schedule()
        return
      }
      const w = this.toWorld(px, py)
      if (d.mode === 'window' && this.windowRect) {
        const a = this.toWorld(d.x, d.y)
        this.editor.onWindow([Math.min(a[0], w[0]), Math.min(a[1], w[1]), Math.max(a[0], w[0]), Math.max(a[1], w[1])], px < d.x)
        this.windowRect = null
      } else if (d.mode === 'grip') {
        if (d.moved) this.editor.endGrip()
      } else if (d.mode === 'gripclick') {
        this.editor.endGrip()
      } else if (d.mode === 'pending' && !d.moved) {
        this.editor.onMove(w)
        this.editor.onClick(w, e.shiftKey)
      }
      this.schedule()
    }
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', up)
  }
}
