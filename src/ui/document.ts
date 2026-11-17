/**
 * Le document en cours : quel plan produire, sur quel format, à quelle échelle, avec quels
 * renseignements. Un assistant le demande dès l'ouverture d'un fichier ; le titre est
 * rédigé automatiquement selon le type de plan, et le cadre de la feuille est affiché dans
 * le dessin pour caler le plan avant l'impression.
 */
import { crsLabel } from '../core/crs'
import type { Project } from '../core/project'
import type { Extent } from '../core/types'
import { closedRing } from '../edit/ops'
import { toProjectFn } from '../edit/query'
import { computeParcel, type Parcel } from '../topo/generate'
import type { MapView } from '../render/mapview'
import { CanvasPainter } from '../render/painter'
import { EMPTY_INFO, PAPERS, SCALES, drawSheet, fitInfo, paperSize, sheetGeometry, type SheetContent, type SheetInfo, type SheetSpec, type TemplateName } from '../topo/sheet'
import { checkbox, field, h, modal, save, select, store } from './dom'

export interface DocMeta {
  date: string
  demandeur: string
  proprietaire: string
  tf: string
  bloc: string
  lots: string
}

export interface DocSettings extends SheetSpec {
  type: string
  meta: DocMeta
  /** Afficher le cadre de la feuille dans le dessin. */
  showFrame: boolean
}

interface DocType {
  id: string
  label: string
  desc: string
  template: TemplateName
  scale: number
  fields: (keyof DocMeta)[]
  title: (m: DocMeta) => string
  beneficiaire: (m: DocMeta) => string
}

const or = (s: string, d = '…') => s.trim() || d

export const DOC_TYPES: DocType[] = [
  {
    id: 'croquis',
    label: 'Croquis de terrain',
    desc: 'Relevé rapide sur le terrain : formes, cotes, observations. Échelle indicative.',
    template: 'cartouche',
    scale: 500,
    fields: ['date', 'proprietaire'],
    title: (m) => `CROQUIS DE TERRAIN\nLevé du ${or(m.date)}`,
    beneficiaire: (m) => m.proprietaire,
  },
  {
    id: 'bornage',
    label: 'Plan de bornage',
    desc: 'Plan joint au procès-verbal de bornage : bornes, côtés, superficie, tableau des coordonnées.',
    template: 'cameroun',
    scale: 500,
    fields: ['date', 'tf', 'demandeur', 'proprietaire', 'bloc', 'lots'],
    title: (m) => `Plan joint au PV de bornage du T.F n° ${or(m.tf)}\nétabli le ${or(m.date)} à la demande de ${or(m.demandeur)}\nau profit de`,
    beneficiaire: (m) => m.proprietaire,
  },
  {
    id: 'morcellement',
    label: 'Plan de morcellement',
    desc: 'Division d’un titre foncier en lots : plan joint au PV de bornage de morcellement.',
    template: 'cameroun',
    scale: 500,
    fields: ['date', 'tf', 'demandeur', 'proprietaire', 'bloc', 'lots'],
    title: (m) => `Plan joint au PV de bornage de morcellement du T.F n° ${or(m.tf)}\nétabli le ${or(m.date)} à la demande de ${or(m.demandeur)}\nau profit de`,
    beneficiaire: (m) => m.proprietaire,
  },
  {
    id: 'etat_lieux',
    label: 'Plan d’état des lieux',
    desc: 'Parcelle du domaine national exploitée et mise en valeur (dossier d’immatriculation).',
    template: 'cameroun',
    scale: 500,
    fields: ['date', 'proprietaire'],
    title: () => `Plan topo État des Lieux d’une parcelle du Domaine National\nexploitée et mise en valeur par`,
    beneficiaire: (m) => (m.proprietaire ? `${m.proprietaire}${m.date ? ' le ' + m.date : ''}` : ''),
  },
  {
    id: 'topo',
    label: 'Plan topographique',
    desc: 'Levé de l’existant : limites apparentes, bâtiments, voirie, réseaux visibles.',
    template: 'cameroun',
    scale: 500,
    fields: ['date', 'demandeur'],
    title: (m) => `Plan topographique\nétabli le ${or(m.date)} à la demande de`,
    beneficiaire: (m) => m.demandeur,
  },
  {
    id: 'topo_alti',
    label: 'Plan topographique et altimétrique',
    desc: 'Plan topographique avec points cotés, courbes de niveau et MNT.',
    template: 'cameroun',
    scale: 500,
    fields: ['date', 'demandeur'],
    title: (m) => `Plan topographique et altimétrique\nétabli le ${or(m.date)} à la demande de`,
    beneficiaire: (m) => m.demandeur,
  },
  {
    id: 'implantation',
    label: 'Plan d’implantation',
    desc: 'Implantation d’un ouvrage : axes, points à implanter, cotes de rattachement.',
    template: 'cartouche',
    scale: 200,
    fields: ['date', 'demandeur'],
    title: (m) => `PLAN D’IMPLANTATION\nétabli le ${or(m.date)}`,
    beneficiaire: (m) => (m.demandeur ? 'Maître d’ouvrage : ' + m.demandeur : ''),
  },
  {
    id: 'situation',
    label: 'Plan de situation',
    desc: 'Localisation du terrain par rapport aux voies et repères connus.',
    template: 'cartouche',
    scale: 5000,
    fields: ['date', 'proprietaire'],
    title: () => 'PLAN DE SITUATION',
    beneficiaire: (m) => m.proprietaire,
  },
  {
    id: 'libre',
    label: 'Dessin libre / consultation',
    desc: 'Ouvrir, consulter et modifier le dessin sans préparer de plan pour l’instant.',
    template: 'aucun',
    scale: 500,
    fields: [],
    title: () => '',
    beneficiaire: () => '',
  },
]

const CABINET_KEY = 'appstock.cabinet'
type Cabinet = Pick<SheetInfo, 'pays' | 'devise' | 'ville' | 'enteteGauche' | 'geometre' | 'region' | 'departement' | 'arrondissement' | 'mentions'>

const today = () => new Date().toLocaleDateString('fr-FR')

export function defaultDoc(project: Project): DocSettings {
  const cab = store<Partial<Cabinet>>(CABINET_KEY, {})
  return {
    type: 'libre',
    paper: 'A4',
    landscape: false,
    scale: 500,
    template: 'aucun',
    info: { ...EMPTY_INFO, ...cab, systeme: project.crs ? 'Projection ' + crsLabel(project.crs).replace(/^WGS 84 \/ /, '') : '' },
    meta: { date: today(), demandeur: '', proprietaire: '', tf: '', bloc: '', lots: '' },
    center: null,
    showFrame: false,
    showGrid: true,
    showNorth: true,
    showTable: true,
    showLegend: true,
    showArea: true,
    monochrome: false,
    unit: 1,
  }
}

/** Rédige le titre, le bénéficiaire et la référence à partir du type et des renseignements. */
export function applyType(doc: DocSettings): void {
  const t = DOC_TYPES.find((x) => x.id === doc.type)
  if (!t) return
  doc.info.titre = t.title(doc.meta)
  doc.info.beneficiaire = t.beneficiaire(doc.meta)
  doc.info.date = doc.meta.date
  const ref = [doc.meta.tf && t.fields.includes('tf') ? `T.F n° ${doc.meta.tf}` : '', doc.meta.bloc ? `Bloc ${doc.meta.bloc}` : '', doc.meta.lots ? `Lots : ${doc.meta.lots}` : ''].filter(Boolean).join('   ')
  doc.info.reference = ref
}

function rememberCabinet(info: SheetInfo): void {
  const cab: Cabinet = { pays: info.pays, devise: info.devise, ville: info.ville, enteteGauche: info.enteteGauche, geometre: info.geometre, region: info.region, departement: info.departement, arrondissement: info.arrondissement, mentions: info.mentions }
  save(CABINET_KEY, cab)
}

/**
 * Parcelle d'un dessin fait à la main : la plus grande surface fermée visible, avec les
 * numéros de bornes écrits près de ses sommets (calque SOMMETS), sinon B.1, B.2…
 */
export function inferParcel(project: Project): Parcel | null {
  let best: { ring: number[]; area: number; item: (typeof project.items)[number] } | null = null
  for (const item of project.items) {
    if (!item.ds.visible) continue
    for (const e of item.ds.entities) {
      if (e.t !== 'pline' && e.t !== 'polygon') continue
      if (item.ds.layers.get(e.layer)?.visible === false || /^(TABLEAUX|MNT|COURBES)/.test(e.layer)) continue
      const ring = closedRing(e)
      if (!ring || ring.length < 6) continue
      let a = 0
      for (let i = 0, n = ring.length / 2; i < n; i++) {
        const j = (i + 1) % n
        a += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1]
      }
      if (!best || Math.abs(a) > best.area) best = { ring, area: Math.abs(a), item }
    }
  }
  if (!best) return null
  const toP = toProjectFn(project, best.item)
  const labels = best.item.ds.entities.filter((e) => e.t === 'text' && e.layer === 'SOMMETS')
  const vertices = []
  for (let i = 0; i < best.ring.length / 2; i++) {
    const x = best.ring[i * 2]
    const y = best.ring[i * 2 + 1]
    let label = 'B.' + (i + 1)
    let d = Infinity
    for (const t of labels) {
      if (t.t !== 'text') continue
      const dd = Math.hypot(t.x - x, t.y - y)
      if (dd < d && dd < t.h * 4) {
        d = dd
        label = t.text
      }
    }
    const p = toP(x, y)
    vertices.push({ label, x: p[0], y: p[1] })
  }
  return computeParcel(vertices)
}

export function sheetContent(project: Project): SheetContent | null {
  const extent = project.extent()
  if (!extent) return null
  const items = project.items.filter((i) => i.ds.visible)
  const plan = items.find((i) => i.plan)?.plan
  return { layers: items.map((i) => ({ dl: i.dl, visible: i.vis })), extent, parcel: plan?.parcel ?? inferParcel(project), legend: plan?.legend ?? [] }
}

const META_LABELS: Record<keyof DocMeta, string> = {
  date: 'Date du levé',
  demandeur: 'Demandeur',
  proprietaire: 'Propriétaire / bénéficiaire',
  tf: 'Titre foncier n°',
  bloc: 'Bloc',
  lots: 'Lots',
}

/** Assistant « Que souhaitez-vous produire ? ». */
export function openDocumentWizard(project: Project, doc: DocSettings, onApply: (openPrint: boolean) => void, intro?: string): void {
  const draft: DocSettings = structuredClone(doc)
  if (!draft.info.systeme && project.crs) draft.info.systeme = 'Projection ' + crsLabel(project.crs).replace(/^WGS 84 \/ /, '')
  if (draft.type === 'libre' && !doc.showFrame) draft.type = project.items.some((i) => i.plan?.parcel) ? 'bornage' : 'topo'
  const content = sheetContent(project)
  const body = h('div', { class: 'content' })
  const close = modal('Nouveau plan — que souhaitez-vous produire ?', body, { wide: true })
  const canvas = h('canvas')
  const fitBox = h('div', { class: 'note' })
  const form = h('div')

  const redraw = () => {
    applyType(draft)
    const [w, hh] = paperSize(draft)
    const px = Math.max(1.2, Math.min(3.2, 1100 / Math.max(w, hh)))
    canvas.width = Math.round(w * px)
    canvas.height = Math.round(hh * px)
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(px, 0, 0, px, 0, 0)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, hh)
    if (content) drawSheet(new CanvasPainter(ctx, 'Helvetica, Arial, sans-serif'), draft, content)
    fitBox.replaceChildren()
    if (!content) {
      fitBox.textContent = 'Le dessin est vide pour l’instant : le cadre sera placé au centre de la vue.'
      return
    }
    const fit = fitInfo(draft, content.extent)
    fitBox.className = 'note ' + (fit.fits ? 'ok' : 'warn')
    if (fit.fits) fitBox.append(`Le dessin tient sur un ${draft.paper} au 1/${draft.scale}.`)
    else {
      fitBox.append(`Au 1/${draft.scale}, le dessin dépasse la feuille ${draft.paper}. `)
      if (fit.bestScale) fitBox.append(h('button', { class: 'link', onclick: () => set({ scale: fit.bestScale as number }) }, `Passer au 1/${fit.bestScale}`), ' ')
      if (fit.bestPaper && fit.bestPaper !== draft.paper) fitBox.append(h('button', { class: 'link', onclick: () => set({ paper: fit.bestPaper as string }) }, `Passer en ${fit.bestPaper}`))
    }
  }
  const set = (patch: Partial<DocSettings>) => {
    Object.assign(draft, patch)
    build()
    redraw()
  }
  const input = (value: string, oninput: (v: string) => void, rows = 0) => {
    const el = rows ? h('textarea', { rows, value }) : h('input', { type: 'text', value })
    el.addEventListener('input', () => {
      oninput(el.value)
      redraw()
    })
    return el
  }

  const build = () => {
    const type = DOC_TYPES.find((t) => t.id === draft.type) ?? DOC_TYPES[0]
    const cards = h('div', { class: 'type-grid' })
    for (const t of DOC_TYPES) {
      cards.append(
        h(
          'button',
          {
            class: 'type-card' + (t.id === draft.type ? ' sel' : ''),
            onclick: () => {
              const fresh = draft.type !== t.id
              draft.type = t.id
              if (fresh) {
                draft.template = t.template
                draft.scale = t.scale
              }
              build()
              redraw()
            },
          },
          h('b', null, t.label),
          h('small', null, t.desc),
        ),
      )
    }
    const meta = type.fields.map((f) => field(META_LABELS[f], input(draft.meta[f], (v) => (draft.meta[f] = v))))
    const info = (k: keyof SheetInfo, label: string, rows = 0) => field(label, input(draft.info[k], (v) => (draft.info[k] = v), rows))
    form.replaceChildren(
      intro ? h('div', { class: 'note' }, intro) : '',
      h('h3', null, '1 · Type de document'),
      cards,
      draft.type === 'libre'
        ? h('p', { class: 'muted' }, 'Vous pourrez préparer le plan plus tard depuis Édition plan › Nouveau plan.')
        : h(
            'div',
            null,
            h('h3', null, '2 · Format et échelle'),
            h(
              'div',
              { class: 'row' },
              field('Format', select(Object.keys(PAPERS).map((p) => [p, `${p} (${PAPERS[p][0]} × ${PAPERS[p][1]} mm)`]), draft.paper, (v) => set({ paper: v }))),
              field('Orientation', select([['p', 'Portrait'], ['l', 'Paysage']], draft.landscape ? 'l' : 'p', (v) => set({ landscape: v === 'l' }))),
              field('Échelle', select(SCALES.map((s) => [String(s), '1/' + s]), String(draft.scale), (v) => set({ scale: Number(v) }))),
              field('Modèle', select([['cameroun', 'Plan cadastral (Cameroun)'], ['cartouche', 'Cartouche générique'], ['aucun', 'Sans habillage']], draft.template, (v) => set({ template: v as TemplateName }))),
            ),
            h('h3', null, '3 · Renseignements'),
            h('div', { class: 'row' }, ...meta),
            h('div', { class: 'row' }, info('ville', 'Ville (en-tête)'), info('region', 'Région'), info('departement', 'Département')),
            h('div', { class: 'row' }, info('arrondissement', 'Arrondissement'), info('lieuDit', 'Lieu-dit'), info('geometre', 'Géomètre / cabinet')),
            h('div', { class: 'row' }, info('systeme', 'Système de coordonnées (mention)', 2), info('mentions', 'Autres mentions (bas de page)', 2)),
            draft.template === 'cameroun' ? h('div', { class: 'row' }, info('enteteGauche', 'En-tête gauche (ministère, ordre, cabinet, agrément)', 3)) : '',
            h('h3', null, '4 · Titre (rédigé automatiquement, modifiable ensuite dans la mise en page)'),
            h('pre', { class: 'title-preview' }, (type.title(draft.meta) + '\n' + type.beneficiaire(draft.meta)).trim()),
            h('div', { class: 'row' }, checkbox('Tableau des coordonnées', draft.showTable, (v) => set({ showTable: v })), checkbox('Légende', draft.showLegend, (v) => set({ showLegend: v })), checkbox('Superficie', draft.showArea, (v) => set({ showArea: v })), checkbox('Croisillons', draft.showGrid, (v) => set({ showGrid: v }))),
          ),
    )
  }

  const apply = (openPrint: boolean) => {
    Object.assign(doc, structuredClone(draft))
    applyType(doc)
    doc.showFrame = doc.type !== 'libre'
    rememberCabinet(doc.info)
    close()
    onApply(openPrint)
  }

  body.append(
    h(
      'div',
      { class: 'split' },
      h('div', null, form),
      h(
        'div',
        null,
        h('div', { class: 'preview' }, canvas),
        fitBox,
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'primary', onclick: () => apply(false) }, 'Valider et caler le cadre'),
          h('button', { onclick: () => apply(true) }, 'Valider et ouvrir la mise en page'),
          h('button', { onclick: close }, 'Plus tard'),
        ),
        h('p', { class: 'muted' }, 'Après validation, le cadre de la feuille s’affiche en pointillés dans le dessin. Commande CADRE (Édition plan › Déplacer le cadre) pour le recaler.'),
      ),
    ),
  )
  build()
  redraw()
}

/** Contour de la feuille et du cadre, en coordonnées du dessin. */
export function frameOutline(doc: DocSettings, extent: Extent, center: [number, number] | null = doc.center): { paper: number[]; frame: number[]; map: number[]; label: [number, number] } {
  const g = sheetGeometry({ ...doc, center }, extent)
  const v = g.view
  const toW = (px: number, py: number): [number, number] => [v.cx + (px - v.ox) / v.scale, v.cy - (py - v.oy) / v.scale]
  const rect = (x: number, y: number, w: number, hh: number) => [...toW(x, y), ...toW(x + w, y), ...toW(x + w, y + hh), ...toW(x, y + hh)]
  return { paper: rect(0, 0, g.w, g.h), frame: rect(g.frame.x, g.frame.y, g.frame.w, g.frame.h), map: rect(g.map.x, g.map.y, g.map.w, g.map.h), label: toW(2, g.h + 4) }
}

/** Surcouche : cadre de la feuille dans le dessin. */
export function frameOverlay(getDoc: () => DocSettings, project: Project): (c: CanvasRenderingContext2D, mv: MapView) => void {
  return (c, mv) => {
    const doc = getDoc()
    if (!doc.showFrame) return
    const extent = project.extent() ?? mv.viewport()
    const o = frameOutline(doc, extent)
    const dpr = mv.dpr
    const path = (pts: number[]) => {
      c.beginPath()
      for (let i = 0; i < pts.length; i += 2) {
        const p = mv.toScreen(pts[i], pts[i + 1])
        if (i === 0) c.moveTo(p[0], p[1])
        else c.lineTo(p[0], p[1])
      }
      c.closePath()
    }
    c.save()
    c.lineWidth = 1.5 * dpr
    c.setLineDash([10 * dpr, 6 * dpr])
    c.strokeStyle = mv.dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)'
    path(o.paper)
    c.stroke()
    c.strokeStyle = '#ff6d00'
    path(o.frame)
    c.stroke()
    c.setLineDash([])
    const l = mv.toScreen(o.label[0], o.label[1])
    c.font = `${12 * dpr}px Arial, sans-serif`
    c.fillStyle = '#ff6d00'
    c.fillText(`Feuille ${doc.paper} ${doc.landscape ? 'paysage' : 'portrait'} · 1/${doc.scale}`, l[0], l[1])
    c.restore()
  }
}
