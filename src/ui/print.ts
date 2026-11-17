/**
 * Mise en page et impression PDF : format A4 à A0, échelle exacte, habillage
 * (cartouche, croisillons, nord, légende, tableau de coordonnées), aperçu en direct.
 */
import { crsLabel } from '../core/crs'
import type { Project } from '../core/project'
import type { Extent } from '../core/types'
import { download } from '../io/export'
import { CanvasPainter } from '../render/painter'
import { PdfPainter, createPdf } from '../render/pdf'
import { EMPTY_INFO, PAPERS, SCALES, drawSheet, fitInfo, paperSize, type SheetContent, type SheetInfo, type SheetSpec, type TemplateName } from '../topo/sheet'
import { checkbox, field, h, modal, save, select, store, toast } from './dom'

const INFO_KEY = 'appstock.sheet.info'
const SPEC_KEY = 'appstock.sheet.spec'

interface SavedSpec {
  paper: string
  landscape: boolean
  scale: number
  template: TemplateName
  showGrid: boolean
  showNorth: boolean
  showTable: boolean
  showLegend: boolean
  showArea: boolean
  monochrome: boolean
  unit: number
}

const DEFAULT_SPEC: SavedSpec = { paper: 'A4', landscape: false, scale: 500, template: 'cameroun', showGrid: true, showNorth: true, showTable: true, showLegend: true, showArea: true, monochrome: false, unit: 1 }

function content(project: Project): SheetContent | null {
  const extent = project.extent()
  if (!extent) return null
  const items = project.items.filter((i) => i.ds.visible)
  const plan = items.find((i) => i.plan)?.plan
  return { layers: items.map((i) => ({ dl: i.dl, visible: i.vis })), extent, parcel: plan?.parcel ?? null, legend: plan?.legend ?? [] }
}

export function renderPdf(spec: SheetSpec, c: SheetContent, title: string): Blob {
  const [w, hgt] = paperSize(spec)
  const doc = createPdf(w, hgt, title)
  drawSheet(new PdfPainter(doc), spec, c)
  return doc.output('blob')
}

/** Ouvre la boîte de dialogue de mise en page. `initial` permet à l'assistant de préremplir. */
export function openPrintDialog(project: Project, viewExtent: Extent, initial: Partial<SavedSpec> = {}): void {
  const base = content(project)
  if (!base) {
    toast('Ouvrez un fichier ou générez un plan avant d’imprimer.', 'erreur')
    return
  }
  const info: SheetInfo = store(INFO_KEY, EMPTY_INFO)
  const saved: SavedSpec = { ...store(SPEC_KEY, DEFAULT_SPEC), ...initial }
  const hasPlan = project.items.some((i) => i.plan)
  if (!hasPlan && initial.template === undefined && !localStorage.getItem(SPEC_KEY)) saved.template = 'aucun'
  if (!info.systeme && project.crs) info.systeme = 'Projection ' + crsLabel(project.crs).replace(/^WGS 84 \/ /, '')
  let frameMode: 'tout' | 'vue' = 'tout'
  const name = (project.items.find((i) => i.plan) ?? project.items[0]).ds.name.replace(/\.[^.]+$/, '')

  const spec = (): SheetSpec => ({ ...saved, info, center: frameMode === 'vue' ? [(viewExtent[0] + viewExtent[2]) / 2, (viewExtent[1] + viewExtent[3]) / 2] : null })
  const data = (): SheetContent => base

  const canvas = h('canvas')
  const fitNote = h('div', { class: 'note' })
  const redraw = () => {
    const s = spec()
    const [w, hgt] = paperSize(s)
    // Aperçu : environ 4 pixels par millimètre pour un A4, moins pour les grands formats.
    const px = Math.max(1.2, Math.min(4, 1500 / Math.max(w, hgt)))
    canvas.width = Math.round(w * px)
    canvas.height = Math.round(hgt * px)
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(px, 0, 0, px, 0, 0)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, hgt)
    drawSheet(new CanvasPainter(ctx, 'Helvetica, Arial, sans-serif'), s, data())
    const fit = fitInfo(s, frameMode === 'vue' ? viewExtent : base.extent)
    fitNote.className = 'note ' + (fit.fits ? 'ok' : 'warn')
    fitNote.replaceChildren()
    const size = `${Math.round(fit.needW)} × ${Math.round(fit.needH)} mm`
    if (fit.fits) fitNote.append(`Le dessin occupe ${size} au 1/${s.scale} : il tient dans la zone utile (${Math.round(fit.availW)} × ${Math.round(fit.availH)} mm).`)
    else {
      fitNote.append(`Au 1/${s.scale}, le dessin occupe ${size} et dépasse la zone utile (${Math.round(fit.availW)} × ${Math.round(fit.availH)} mm). Il n’est pas déformé : il est coupé au cadre. `)
      if (fit.bestScale) fitNote.append(h('button', { class: 'link', onclick: () => set({ scale: fit.bestScale as number }) }, `Passer au 1/${fit.bestScale}`), ' ')
      if (fit.bestPaper && fit.bestPaper !== s.paper) fitNote.append(h('button', { class: 'link', onclick: () => set({ paper: fit.bestPaper as string }) }, `Passer en ${fit.bestPaper}`))
    }
    save(SPEC_KEY, saved)
    save(INFO_KEY, info)
  }
  const set = (patch: Partial<SavedSpec>) => {
    Object.assign(saved, patch)
    rebuildForm()
    redraw()
  }

  const form = h('div')
  const text = (key: keyof SheetInfo, label: string, rows = 0) => {
    const el = rows ? h('textarea', { rows, value: info[key] }) : h('input', { type: 'text', value: info[key] })
    el.addEventListener('input', () => {
      info[key] = el.value
      redraw()
    })
    return field(label, el)
  }
  const rebuildForm = () => {
    form.replaceChildren(
      h('h3', null, 'Feuille'),
      h(
        'div',
        { class: 'row' },
        field('Format', select(Object.keys(PAPERS).map((p) => [p, `${p} (${PAPERS[p][0]} × ${PAPERS[p][1]} mm)`]), saved.paper, (v) => set({ paper: v }))),
        field('Orientation', select([['p', 'Portrait'], ['l', 'Paysage']], saved.landscape ? 'l' : 'p', (v) => set({ landscape: v === 'l' }))),
      ),
      h(
        'div',
        { class: 'row' },
        field('Échelle', select(SCALES.map((s) => [String(s), '1/' + s]), String(saved.scale), (v) => set({ scale: Number(v) }))),
        field('Cadrage', select([['tout', 'Tout le dessin'], ['vue', 'Vue affichée à l’écran']], frameMode, (v) => {
          frameMode = v as 'tout' | 'vue'
          redraw()
        })),
      ),
      h(
        'div',
        { class: 'row' },
        field('Modèle', select([['cameroun', 'Plan cadastral (Cameroun)'], ['cartouche', 'Cartouche générique'], ['aucun', 'Dessin seul (sans habillage)']], saved.template, (v) => set({ template: v as TemplateName }))),
        field('Unité du dessin', select([['1', 'mètre'], ['0.01', 'centimètre'], ['0.001', 'millimètre']], String(saved.unit), (v) => set({ unit: Number(v) }))),
      ),
      saved.template === 'aucun'
        ? h('p', { class: 'muted' }, 'Le dessin est imprimé tel quel, à l’échelle, centré sur la feuille — adapté aux DWG qui contiennent déjà leur cartouche.')
        : h(
            'div',
            null,
            h('div', { class: 'row' }, checkbox('Croisillons', saved.showGrid, (v) => set({ showGrid: v })), checkbox('Nord', saved.showNorth, (v) => set({ showNorth: v })), checkbox('Légende', saved.showLegend, (v) => set({ showLegend: v }))),
            h('div', { class: 'row' }, checkbox('Tableau des coordonnées', saved.showTable, (v) => set({ showTable: v })), checkbox('Superficie', saved.showArea, (v) => set({ showArea: v })), checkbox('Noir et blanc', saved.monochrome, (v) => set({ monochrome: v }))),
            h('h3', null, 'Renseignements du plan'),
            text('titre', 'Titre du plan', 2),
            text('beneficiaire', 'Bénéficiaire / client'),
            h('div', { class: 'row' }, text('ville', 'Ville (en-tête)'), text('date', 'Date')),
            h('div', { class: 'row' }, text('region', 'Région'), text('departement', 'Département')),
            h('div', { class: 'row' }, text('arrondissement', 'Arrondissement'), text('lieuDit', 'Lieu-dit')),
            h('div', { class: 'row' }, text('geometre', 'Géomètre / cabinet'), text('reference', 'Référence (T.F., dossier)')),
            text('systeme', 'Système de coordonnées (mention)', 2),
            text('mentions', 'Autres mentions (bas de page)', 2),
            saved.template === 'cameroun' ? h('div', null, text('enteteGauche', 'En-tête gauche (ministère, ordre, cabinet)', 3), h('div', { class: 'row' }, text('pays', 'Pays'), text('devise', 'Devise'))) : null,
            h('p', { class: 'muted' }, 'Ces renseignements sont mémorisés sur cet appareil pour vos prochains plans.'),
          ),
    )
  }
  rebuildForm()

  const exportOne = (s: SheetSpec) => {
    const blob = renderPdf(s, data(), name)
    download({ name: `${name}_${s.paper}_1-${s.scale}.pdf`, mime: 'application/pdf', data: blob })
  }
  const multi = h('div', { class: 'row' })
  const chosen = new Set<string>(['A4', 'A3'])
  for (const p of Object.keys(PAPERS)) multi.append(checkbox(p, chosen.has(p), (v) => (v ? chosen.add(p) : chosen.delete(p))))

  const body = h(
    'div',
    { class: 'content' },
    h(
      'div',
      { class: 'split' },
      h(
        'div',
        null,
        form,
        fitNote,
        h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => exportOne(spec()) }, 'Télécharger le PDF')),
        h('h3', null, 'Plusieurs formats d’un coup'),
        multi,
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            {
              onclick: () => {
                const done: string[] = []
                for (const p of chosen) {
                  const s = { ...spec(), paper: p }
                  // Même échelle si le dessin tient ; sinon la plus grande échelle normalisée qui tient.
                  const fit = fitInfo(s, frameMode === 'vue' ? viewExtent : base.extent)
                  if (!fit.fits && fit.bestScale) s.scale = fit.bestScale
                  exportOne(s)
                  done.push(`${p} au 1/${s.scale}`)
                }
                if (done.length) toast('PDF générés : ' + done.join(', '), 'ok')
              },
            },
            'Générer les PDF cochés',
          ),
        ),
        h('p', { class: 'muted' }, 'PDF vectoriel à l’échelle exacte : imprimez à 100 %, sans « ajuster à la page ».'),
      ),
      h('div', { class: 'preview' }, canvas),
    ),
  )
  modal('Mise en page et impression PDF', body, { wide: true })
  redraw()
}
