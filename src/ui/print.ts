/**
 * Mise en page et impression PDF : part des réglages du document (type, format, échelle,
 * renseignements, cadre calé dans le dessin) et les modifie en direct, avec aperçu.
 */
import type { Project } from '../core/project'
import type { Extent } from '../core/types'
import { download } from '../io/export'
import { CanvasPainter } from '../render/painter'
import { PdfPainter, createPdf } from '../render/pdf'
import { PAPERS, SCALES, drawSheet, fitInfo, paperSize, type SheetContent, type SheetInfo, type SheetSpec, type TemplateName } from '../topo/sheet'
import { checkbox, field, h, modal, select, toast } from './dom'
import { sheetContent, type DocSettings } from './document'

export function renderPdf(spec: SheetSpec, c: SheetContent, title: string): Blob {
  const [w, hgt] = paperSize(spec)
  const doc = createPdf(w, hgt, title)
  drawSheet(new PdfPainter(doc), spec, c)
  return doc.output('blob')
}

export function openPrintDialog(project: Project, viewExtent: Extent, doc: DocSettings, onChange: () => void): void {
  const base = sheetContent(project)
  if (!base) {
    toast('Ouvrez un fichier ou dessinez avant d’imprimer.', 'erreur')
    return
  }
  if (doc.template === 'aucun' && doc.type === 'libre' && !doc.showFrame) doc.template = project.items.some((i) => i.plan) ? 'cameroun' : 'aucun'
  let frameMode: 'cadre' | 'tout' | 'vue' = doc.center ? 'cadre' : 'tout'
  const info = doc.info
  const name = (project.items.find((i) => i.plan) ?? project.items[0]).ds.name.replace(/\.[^.]+$/, '')

  const spec = (): SheetSpec => ({
    ...doc,
    center: frameMode === 'cadre' ? doc.center : frameMode === 'vue' ? [(viewExtent[0] + viewExtent[2]) / 2, (viewExtent[1] + viewExtent[3]) / 2] : null,
  })

  const canvas = h('canvas')
  const fitNote = h('div', { class: 'note' })
  const redraw = () => {
    const s = spec()
    const [w, hgt] = paperSize(s)
    const px = Math.max(1.2, Math.min(4, 1500 / Math.max(w, hgt)))
    canvas.width = Math.round(w * px)
    canvas.height = Math.round(hgt * px)
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(px, 0, 0, px, 0, 0)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, hgt)
    drawSheet(new CanvasPainter(ctx, 'Helvetica, Arial, sans-serif'), s, base)
    const fit = fitInfo(s, frameMode === 'vue' ? viewExtent : base.extent)
    fitNote.className = 'note ' + (fit.fits || frameMode !== 'tout' ? 'ok' : 'warn')
    fitNote.replaceChildren()
    const size = `${Math.round(fit.needW)} × ${Math.round(fit.needH)} mm`
    if (frameMode === 'cadre') fitNote.append('Impression du cadre calé dans le dessin (commande CADRE pour le déplacer).')
    else if (fit.fits) fitNote.append(`Le dessin occupe ${size} au 1/${s.scale} : il tient dans la zone utile (${Math.round(fit.availW)} × ${Math.round(fit.availH)} mm).`)
    else {
      fitNote.append(`Au 1/${s.scale}, le dessin occupe ${size} et dépasse la zone utile (${Math.round(fit.availW)} × ${Math.round(fit.availH)} mm). Il n’est pas déformé : il est coupé au cadre. `)
      if (fit.bestScale) fitNote.append(h('button', { class: 'link', onclick: () => set({ scale: fit.bestScale as number }) }, `Passer au 1/${fit.bestScale}`), ' ')
      if (fit.bestPaper && fit.bestPaper !== s.paper) fitNote.append(h('button', { class: 'link', onclick: () => set({ paper: fit.bestPaper as string }) }, `Passer en ${fit.bestPaper}`))
    }
    onChange()
  }
  const set = (patch: Partial<DocSettings>) => {
    Object.assign(doc, patch)
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
        field('Format', select(Object.keys(PAPERS).map((p) => [p, `${p} (${PAPERS[p][0]} × ${PAPERS[p][1]} mm)`]), doc.paper, (v) => set({ paper: v }))),
        field('Orientation', select([['p', 'Portrait'], ['l', 'Paysage']], doc.landscape ? 'l' : 'p', (v) => set({ landscape: v === 'l' }))),
      ),
      h(
        'div',
        { class: 'row' },
        field('Échelle', select(SCALES.map((s) => [String(s), '1/' + s]), String(doc.scale), (v) => set({ scale: Number(v) }))),
        field(
          'Cadrage',
          select(
            [...(doc.center ? ([['cadre', 'Cadre calé dans le dessin']] as [string, string][]) : []), ['tout', 'Tout le dessin'], ['vue', 'Vue affichée à l’écran']],
            frameMode,
            (v) => {
              frameMode = v as typeof frameMode
              redraw()
            },
          ),
        ),
      ),
      h(
        'div',
        { class: 'row' },
        field('Modèle', select([['cameroun', 'Plan cadastral (Cameroun)'], ['cartouche', 'Cartouche générique'], ['aucun', 'Dessin seul (sans habillage)']], doc.template, (v) => set({ template: v as TemplateName }))),
        field('Unité du dessin', select([['1', 'mètre'], ['0.01', 'centimètre'], ['0.001', 'millimètre']], String(doc.unit), (v) => set({ unit: Number(v) }))),
      ),
      doc.template === 'aucun'
        ? h('p', { class: 'muted' }, 'Le dessin est imprimé tel quel, à l’échelle, centré sur la feuille — adapté aux DWG qui contiennent déjà leur cartouche.')
        : h(
            'div',
            null,
            h('div', { class: 'row' }, checkbox('Croisillons', doc.showGrid, (v) => set({ showGrid: v })), checkbox('Nord', doc.showNorth, (v) => set({ showNorth: v })), checkbox('Légende', doc.showLegend, (v) => set({ showLegend: v }))),
            h('div', { class: 'row' }, checkbox('Tableau des coordonnées', doc.showTable, (v) => set({ showTable: v })), checkbox('Superficie', doc.showArea, (v) => set({ showArea: v })), checkbox('Noir et blanc', doc.monochrome, (v) => set({ monochrome: v }))),
            h('h3', null, 'Renseignements du plan'),
            text('titre', 'Titre du plan', 3),
            text('beneficiaire', 'Bénéficiaire / client (en gras)'),
            h('div', { class: 'row' }, text('ville', 'Ville (en-tête)'), text('date', 'Date')),
            h('div', { class: 'row' }, text('region', 'Région'), text('departement', 'Département')),
            h('div', { class: 'row' }, text('arrondissement', 'Arrondissement'), text('lieuDit', 'Lieu-dit')),
            h('div', { class: 'row' }, text('geometre', 'Géomètre / cabinet'), text('reference', 'Référence (T.F., bloc, lots)')),
            text('systeme', 'Système de coordonnées (mention)', 2),
            text('mentions', 'Autres mentions (bas de page)', 2),
            doc.template === 'cameroun' ? h('div', null, text('enteteGauche', 'En-tête gauche (ministère, ordre, cabinet)', 3), h('div', { class: 'row' }, text('pays', 'Pays'), text('devise', 'Devise'))) : null,
          ),
    )
  }
  rebuildForm()

  const exportOne = (s: SheetSpec) => {
    const blob = renderPdf(s, base, name)
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
                  const fit = fitInfo(s, frameMode === 'vue' ? viewExtent : base.extent)
                  if (!fit.fits && fit.bestScale && frameMode === 'tout') s.scale = fit.bestScale
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
