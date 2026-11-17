/**
 * Le document en cours : quel plan produire, sur quel format, à quelle échelle, avec quels
 * renseignements. Un assistant le demande dès l'ouverture d'un fichier ; le titre est
 * rédigé automatiquement selon le type de plan, et le cadre de la feuille est affiché dans
 * le dessin pour caler le plan avant l'impression.
 */
import { crsLabel, toLonLat } from '../core/crs'
import type { Project } from '../core/project'
import type { Extent } from '../core/types'
import { closedRing } from '../edit/ops'
import { toProjectFn, type Selection } from '../edit/query'
import { pointsFromSelection } from '../edit/selpoints'
import { computeParcel, type Parcel } from '../topo/generate'
import { crossings } from '../topo/parcel'
import type { MapView } from '../render/mapview'
import { CanvasPainter } from '../render/painter'
import { retrySituations, situationMap, situationReady, type SituationMap, type SituationProvider, type SituationRequest } from '../render/situation'
import { EMPTY_INFO, PAPERS, SCALES, drawSheet, fitInfo, paperSize, sheetGeometry, situationRect, type SheetContent, type SheetInfo, type SheetSpec, type TableRow, type TemplateName } from '../topo/sheet'
import { checkbox, field, h, modal, save, select, store } from './dom'
import { territoryFields } from './territoire'

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
  /** Tableau des coordonnées pris dans la sélection du dessin (sinon : parcelle détectée). */
  tableRows?: TableRow[] | null
  /** La sélection était une parcelle fermée : sa surface est celle du plan. */
  tableIsParcel?: boolean
  /** Fond du plan de situation. */
  situationProvider?: SituationProvider
}

/** Accès à l'éditeur, fourni par l'application (sélection en cours). */
export const docHooks: { selection: () => Selection[] } = { selection: () => [] }

/** Clé Google Maps : saisie par l'utilisateur, sinon variable de déploiement. */
export function googleKey(): string {
  try {
    const k = localStorage.getItem('appstock.googleKey')
    if (k) return k
  } catch {
    /* stockage indisponible */
  }
  return (import.meta.env?.VITE_GOOGLE_MAPS_KEY as string | undefined) ?? ''
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
    showSituation: true,
    situationScale: 10000,
    situationProvider: 'osm',
    situationCaption: 'echelle',
    showEmplacement: true,
    showBorder: true,
    coordDecimals: 3,
    tableRows: null,
  }
}

/** Cases à cocher des éléments de la feuille, placées au-dessus de l'aperçu. */
export function sheetToggles(doc: DocSettings, refresh: () => void): HTMLElement {
  const c = (label: string, value: boolean, set: (v: boolean) => void) =>
    checkbox(label, value, (v) => {
      set(v)
      refresh()
    })
  return h(
    'div',
    { class: 'sheet-toggles' },
    c('Nord', doc.showNorth, (v) => (doc.showNorth = v)),
    c('Plan de situation', doc.showSituation !== false, (v) => (doc.showSituation = v)),
    c('Emplacement', doc.showEmplacement !== false, (v) => (doc.showEmplacement = v)),
    c('Superficie', doc.showArea, (v) => (doc.showArea = v)),
    c('Tableau des coordonnées', doc.showTable, (v) => (doc.showTable = v)),
    c('Légende', doc.showLegend, (v) => (doc.showLegend = v)),
    c('Croisillons', doc.showGrid, (v) => (doc.showGrid = v)),
    c('Cadre extérieur', doc.showBorder !== false, (v) => (doc.showBorder = v)),
    c('Noir et blanc', doc.monochrome, (v) => (doc.monochrome = v)),
  )
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
  // Un contour qui se croise n'a pas de superficie : pas de parcelle plutôt qu'un chiffre faux.
  if (crossings(vertices.map((v) => ({ id: v.label, x: v.x, y: v.y }))).length) return null
  return computeParcel(vertices)
}

export function sheetContent(project: Project, doc?: DocSettings, onSituation?: () => void): SheetContent | null {
  const extent = project.extent()
  if (!extent) return null
  const items = project.items.filter((i) => i.ds.visible)
  const plan = items.find((i) => i.plan)?.plan
  const rows = doc?.tableRows?.length ? doc.tableRows : null
  const parcel = rows && doc?.tableIsParcel ? computeParcel(rows) : (plan?.parcel ?? inferParcel(project))
  const content: SheetContent = { layers: items.map((i) => ({ dl: i.dl, visible: i.vis })), extent, parcel, legend: plan?.legend ?? [], table: rows }
  if (doc && doc.showSituation !== false && doc.template !== 'aucun') {
    const req = situationRequest(project, doc, content)
    if (typeof req === 'string') content.situation = req
    else {
      const r = situationReady(req, onSituation)
      content.situation = r === undefined ? 'Chargement de la carte…' : r instanceof Error ? 'Carte indisponible : ' + r.message : r
    }
  }
  return content
}

/** Demande de plan de situation : centre et contour du terrain en longitude, latitude. */
export function situationRequest(project: Project, doc: DocSettings, content: SheetContent): SituationRequest | string {
  if (!project.crs) return 'Système de coordonnées inconnu : choisissez-le (Outils › Système)'
  const pts = content.table?.length ? content.table : content.parcel?.vertices
  let cx: number
  let cy: number
  if (pts?.length) {
    cx = pts.reduce((a, p) => a + p.x, 0) / pts.length
    cy = pts.reduce((a, p) => a + p.y, 0) / pts.length
  } else if (doc.center) [cx, cy] = doc.center
  else {
    cx = (content.extent[0] + content.extent[2]) / 2
    cy = (content.extent[1] + content.extent[3]) / 2
  }
  const ll = toLonLat(project.crs, cx, cy)
  if (!ll) return 'Position géographique impossible à calculer'
  const ring = pts && pts.length >= 3 ? (pts.map((p) => toLonLat(project.crs, p.x, p.y)).filter(Boolean) as [number, number][]) : null
  const g = sheetGeometry(doc, content.extent)
  const sr = situationRect(g)
  if (!sr) return 'Pas de plan de situation pour ce modèle'
  const { image } = sr
  const provider = doc.situationProvider ?? 'osm'
  return { lon: ll[0], lat: ll[1], ring, widthMm: image.w, heightMm: image.h, scale: doc.situationScale ?? 10000, provider, googleKey: provider === 'google' ? googleKey() : undefined }
}

/** Attend le plan de situation (avant un PDF). */
export async function ensureSituation(project: Project, doc: DocSettings): Promise<SituationMap | null> {
  const content = sheetContent(project, doc)
  if (!content || doc.showSituation === false || doc.template === 'aucun') return null
  const req = situationRequest(project, doc, content)
  if (typeof req === 'string') return null
  try {
    return await situationMap(req)
  } catch {
    return null
  }
}

/** Remplit le tableau des coordonnées avec la sélection du dessin ; renvoie le nombre de points. */
export function useSelectionForTable(project: Project, doc: DocSettings, sel: Selection[] = docHooks.selection()): number {
  if (!sel.length) return 0
  const { rows, parcel } = pointsFromSelection(project, sel)
  if (!rows.length) return 0
  doc.tableRows = rows
  doc.tableIsParcel = parcel
  return rows.length
}

/** Réglages communs (assistant et mise en page) : tableau des coordonnées. */
export function tableSection(project: Project, doc: DocSettings, refresh: () => void): HTMLElement {
  const box = h('div', { class: 'note' })
  const decimals = field('Décimales des coordonnées', select([['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], String(doc.coordDecimals ?? 3), (v) => {
    doc.coordDecimals = Number(v)
    refresh()
  }), 'Par défaut, celles du fichier de points.')
  const draw = () => {
    const n = doc.tableRows?.length ?? 0
    const selCount = docHooks.selection().length
    box.replaceChildren(
      h('b', null, 'Tableau des coordonnées : '),
      n ? `${n} point(s) pris dans la sélection du dessin${doc.tableIsParcel ? ' (parcelle fermée : sa surface est reportée)' : ''}.` : 'sommets de la parcelle détectée automatiquement (la plus grande surface fermée).',
      h('br'),
      h('button', {
        class: 'link',
        disabled: !selCount,
        title: selCount ? '' : 'Sélectionnez d’abord les bornes, les points ou la parcelle dans le dessin',
        onclick: () => {
          useSelectionForTable(project, doc)
          draw()
          refresh()
        },
      }, selCount ? `Prendre la sélection du dessin (${selCount} objet(s))` : 'Sélectionnez d’abord les bornes ou la parcelle dans le dessin'),
      n ? ' · ' : '',
      n
        ? h('button', {
            class: 'link',
            onclick: () => {
              doc.tableRows = null
              doc.tableIsParcel = false
              draw()
              refresh()
            },
          }, 'Revenir à la parcelle détectée')
        : '',
    )
  }
  draw()
  return h('div', null, box, decimals)
}

/** Réglages communs : encart du plan de situation. */
export function situationSection(doc: DocSettings, refresh: () => void): HTMLElement {
  const key = h('input', { type: 'password', placeholder: 'Clé API Google Maps (Maps Static)', value: googleKey(), autocomplete: 'off' }) as HTMLInputElement
  key.addEventListener('change', () => {
    try {
      localStorage.setItem('appstock.googleKey', key.value.trim())
    } catch {
      /* stockage indisponible */
    }
    retrySituations()
    refresh()
  })
  const provider = doc.situationProvider ?? 'osm'
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'row situation-row' },
      checkbox('Plan de situation', doc.showSituation !== false, (v) => {
        doc.showSituation = v
        refresh()
      }),
      field('Échelle du plan de situation', select([2000, 5000, 10000, 20000, 25000, 50000, 100000].map((s) => [String(s), '1/' + s.toLocaleString('fr-FR')]), String(doc.situationScale ?? 10000), (v) => {
        doc.situationScale = Number(v)
        refresh()
      })),
      field('Fond de carte', select([['osm', 'OpenStreetMap (sans clé)'], ['google', 'Google Maps (clé API)']], provider, (v) => {
        doc.situationProvider = v as SituationProvider
        refresh()
      })),
      field('Légende', select([['echelle', 'Avec l’échelle'], ['sans', '« Sans Echelle »']], doc.situationCaption ?? 'echelle', (v) => {
        doc.situationCaption = v as 'echelle' | 'sans'
        refresh()
      })),
    ),
    provider === 'google'
      ? h('div', null, field('Clé Google Maps', key, 'Créée dans la console Google Cloud (API « Maps Static »), limitée à l’adresse de la plateforme. Gardée sur cet appareil uniquement.'))
      : h('p', { class: 'muted' }, 'Carte générée automatiquement autour du terrain, contour en rouge. Google Maps est disponible avec une clé API.'),
    h('button', {
      class: 'link',
      onclick: () => {
        retrySituations()
        refresh()
      },
    }, 'Actualiser la carte'),
  )
}

/** Exemple de renseignements, à modifier : un plan de bornage à Yaoundé. */
export function fillExample(doc: DocSettings): void {
  doc.type = 'bornage'
  doc.template = 'cameroun'
  Object.assign(doc.info, {
    ville: 'YAOUNDE',
    region: 'Centre',
    departement: 'Mfoundi',
    arrondissement: 'Yaoundé IVe',
    lieuDit: 'Mimboman',
    enteteGauche: 'ORDRE NATIONAL DES GEOMETRES\nDU CAMEROUN\nCabinet EXEMPLE - Géomètre Expert\nAgrément n° 000/EXEMPLE',
    geometre: 'Cabinet EXEMPLE, Géomètre Expert',
    mentions: 'Mappe de repérage\nFeuille 1/20000\nccp n°.........',
  })
  Object.assign(doc.meta, { tf: '0000/MFOUNDI', demandeur: 'M. EXEMPLE Paul', proprietaire: 'Mme EXEMPLE Marie', bloc: '1', lots: '6 et 7' })
  doc.showSituation = true
  doc.showNorth = true
  doc.showTable = true
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
  // Une sélection faite avant d'ouvrir l'assistant remplit le tableau des coordonnées.
  const fromSel = !draft.tableRows?.length ? useSelectionForTable(project, draft) : 0
  const body = h('div', { class: 'content' })
  const close = modal('Nouveau plan — que souhaitez-vous produire ?', body, { wide: true })
  const canvas = h('canvas')
  const fitBox = h('div', { class: 'note' })
  const form = h('div')

  let pending = false
  const redraw = () => {
    applyType(draft)
    const content = sheetContent(project, draft, () => {
      if (pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        redraw()
      })
    })
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

  const togglesHost = h('div')
  const build = () => {
    togglesHost.replaceChildren(sheetToggles(draft, redraw))
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
      fromSel ? h('div', { class: 'note ok' }, `Tableau des coordonnées rempli avec votre sélection (${fromSel} point(s)).`) : '',
      h('div', { class: 'actions' }, h('button', {
        onclick: () => {
          fillExample(draft)
          build()
          redraw()
        },
      }, 'Remplir avec un exemple (à modifier)')),
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
            territoryFields(draft.info, redraw),
            h('div', { class: 'row' }, info('ville', 'Ville (en-tête)'), info('lieuDit', 'Lieu-dit / quartier'), info('geometre', 'Géomètre / cabinet')),
            h('div', { class: 'row' }, info('systeme', 'Système de coordonnées (mention)', 2), info('mentions', 'Autres mentions (bas de page)', 2)),
            draft.template === 'cameroun' ? h('div', { class: 'row' }, info('enteteGauche', 'En-tête gauche (ministère, ordre, cabinet, agrément)', 3)) : '',
            h('h3', null, '4 · Titre (rédigé automatiquement, modifiable ensuite dans la mise en page)'),
            h('pre', { class: 'title-preview' }, (type.title(draft.meta) + '\n' + type.beneficiaire(draft.meta)).trim()),
            h('h3', null, 'Tableau des coordonnées'),
            tableSection(project, draft, redraw),
            h('h3', null, '5 · Plan de situation'),
            situationSection(draft, () => {
              build()
              redraw()
            }),
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
        togglesHost,
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
