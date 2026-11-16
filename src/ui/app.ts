/**
 * Écran principal : barre d'outils, jeux de données et calques, vue du plan,
 * propriétés, barre d'état.
 */
import { crsLabel, detectCrs, getCrs, searchCrs, toLonLat, type CrsDef } from '../core/crs'
import { colorToCss, polylineLength, rawExtent, ringArea } from '../core/geom'
import { Project, type Item } from '../core/project'
import type { Entity } from '../core/types'
import { download, exportDxf, exportGeoJSON, exportKml, exportPointsCsv, type ExportResult } from '../io/export'
import { CAPABILITIES, importFiles } from '../io/import'
import { TILE_SOURCES } from '../render/basemap'
import { MapView, type Tool } from '../render/mapview'
import { formatArea } from '../topo/sheet'
import { openAssistant } from './assistant'
import { clear, field, h, modal, select, toast } from './dom'
import { openPrintDialog } from './print'

const TYPE_NAMES: Record<Entity['t'], string> = {
  point: 'Point',
  line: 'Ligne',
  pline: 'Polyligne',
  circle: 'Cercle',
  arc: 'Arc',
  ellipse: 'Ellipse',
  spline: 'Spline',
  text: 'Texte',
  insert: 'Bloc',
  polygon: 'Surface',
}

export function startApp(root: HTMLElement): void {
  const project = new Project()
  const left = h('aside', { class: 'side left' })
  const right = h('aside', { class: 'side right' })
  const stage = h('div', { class: 'stage' })
  const status = h('footer', { class: 'statusbar' })
  const topbar = h('header', { class: 'topbar' })
  root.append(h('div', { class: 'shell' }, topbar, h('div', { class: 'main' }, left, stage, right), status))

  const view = new MapView(stage, project)
  const hint = h('div', { class: 'drop-hint' })
  stage.append(hint)
  const busy = h('div', { class: 'busy', hidden: true })
  stage.append(busy)

  // --- Ouverture de fichiers -------------------------------------------------
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => {
    if (fileInput.files?.length) void open([...fileInput.files])
    fileInput.value = ''
  } })
  root.append(fileInput)

  const afterPlan = (r: { item: Item; scale: number; paper?: string; landscape?: boolean; showTable?: boolean; showLegend?: boolean }) => {
    view.fit()
    renderRight()
    toast('Plan généré. Vérifiez le compte rendu à droite, puis ouvrez « Mise en page / PDF ».', 'ok')
    lastPlanSpec = { scale: r.scale, ...(r.paper ? { paper: r.paper } : {}), ...(r.landscape !== undefined ? { landscape: r.landscape } : {}), ...(r.showTable !== undefined ? { showTable: r.showTable } : {}), ...(r.showLegend !== undefined ? { showLegend: r.showLegend } : {}) }
  }
  let lastPlanSpec: Record<string, unknown> = {}

  async function open(files: File[]): Promise<void> {
    busy.hidden = false
    busy.textContent = 'Lecture en cours…'
    const first = project.items.length === 0
    try {
      const res = await importFiles(files, (m) => (busy.textContent = m))
      for (const ds of res.datasets) {
        if (!ds.crs) {
          // Fichier sans système déclaré : proposition automatique, à confirmer par l'utilisateur.
          const c = detectCrs(rawExtent(ds))
          if (c.length && c[0].distanceKm < 3000) {
            ds.crs = c[0].def.code
            ds.crsSource = 'detected'
          }
        }
        project.add(ds)
      }
      for (const e of res.errors) toast(e, 'erreur', 9000)
      if (res.datasets.length) {
        if (first) view.fit()
        toast(`${res.datasets.length} fichier(s) ouvert(s) : ${res.datasets.map((d) => `${d.name} (${d.entities.length} entités)`).join(', ')}`, 'ok')
      }
      if (res.points.length) openAssistant(project, res.points[0], afterPlan)
    } finally {
      busy.hidden = true
    }
  }

  stage.addEventListener('dragover', (e) => {
    e.preventDefault()
    stage.classList.add('dragging')
  })
  stage.addEventListener('dragleave', () => stage.classList.remove('dragging'))
  stage.addEventListener('drop', (e) => {
    e.preventDefault()
    stage.classList.remove('dragging')
    if (e.dataTransfer?.files.length) void open([...e.dataTransfer.files])
  })

  // --- Barre d'outils --------------------------------------------------------
  const toolButtons = new Map<Tool, HTMLButtonElement>()
  const setTool = (t: Tool) => {
    view.setTool(t)
    for (const [k, b] of toolButtons) b.classList.toggle('active', k === t)
    renderRight()
  }
  const tool = (t: Tool, label: string, title: string) => {
    const b = h('button', { title, onclick: () => setTool(t) }, label)
    toolButtons.set(t, b)
    return b
  }
  const darkBtn = h('button', { title: 'Fond sombre ou clair', onclick: () => {
    view.dark = !view.dark
    darkBtn.classList.toggle('active', view.dark)
    view.invalidate()
  } }, 'Fond sombre')
  topbar.append(
    h('button', { class: 'mobile-only icon', title: 'Calques', onclick: () => left.classList.toggle('open') }, '☰'),
    h('div', { class: 'brand' }, 'AppStock Géo', h('small', null, 'CAO · SIG · Topographie dans le navigateur')),
    h('button', { class: 'primary', onclick: () => fileInput.click() }, 'Ouvrir'),
    h('button', { onclick: () => openAssistant(project, null, afterPlan), title: 'Du fichier de points au plan' }, 'Assistant plan'),
    h('button', { onclick: () => openPrintDialog(project, viewExtent(), lastPlanSpec) }, 'Mise en page / PDF'),
    h('button', { onclick: openExport }, 'Exporter'),
    h('span', { class: 'sep' }),
    tool('select', 'Sélection', 'Cliquer un objet pour voir ses propriétés'),
    tool('distance', 'Distance', 'Mesurer une distance (double-clic pour terminer)'),
    tool('area', 'Surface', 'Mesurer une surface (double-clic pour terminer)'),
    h('button', { onclick: () => view.fit(), title: 'Cadrer tout le projet' }, 'Tout voir'),
    h('span', { class: 'sep' }),
    select([['aucun', 'Sans fond de carte'], ...TILE_SOURCES.map((s): [string, string] => [s.id, s.label])], 'aucun', (v) => {
      view.basemap = v
      if (v !== 'aucun' && !project.crs) toast('Le fond de carte s’affiche quand le système de coordonnées du projet est connu.', 'info')
      view.invalidate()
    }),
    darkBtn,
    h('span', { class: 'sep' }),
    h('button', { onclick: openExtensions }, 'Extensions'),
    h('button', { class: 'mobile-only icon', title: 'Propriétés', onclick: () => right.classList.toggle('open') }, 'ⓘ'),
  )
  toolButtons.get('select')!.classList.add('active')

  const viewExtent = (): [number, number, number, number] => {
    const a = view.toWorld(0, view.canvas.height)
    const b = view.toWorld(view.canvas.width, 0)
    return [a[0], a[1], b[0], b[1]]
  }

  // --- Panneau gauche : jeux de données et calques -----------------------------
  function renderLeft(): void {
    clear(left)
    left.append(h('h3', { style: 'margin-top:0' }, 'Jeux de données'))
    if (!project.items.length) left.append(h('p', { class: 'muted' }, 'Aucun fichier ouvert.'))
    for (const item of project.items) {
      const ds = item.ds
      const layers = h('ul', { class: 'layers' })
      for (const layer of ds.layers.values()) {
        const count = item.dl.layerNames.includes(layer.name)
        if (!count && ds.layers.size > 1) continue
        const c = h('input', { type: 'checkbox', checked: layer.visible, onchange: () => {
          layer.visible = c.checked
          project.refreshVisibility(item)
        } })
        layers.append(h('li', null, c, h('span', { class: 'swatch', style: `background:${colorToCss(layer.color, '#222')}` }), h('span', { class: 'n', title: layer.name }, layer.name)))
      }
      const vis = h('input', { type: 'checkbox', checked: ds.visible, title: 'Afficher', onchange: () => {
        ds.visible = vis.checked
        project.emit('view')
      } })
      const unsupported = Object.entries(ds.unsupported)
      const crsBadge =
        ds.crsSource === 'detected'
          ? h('span', { class: 'badge warn', title: 'Système proposé automatiquement' }, 'à confirmer')
          : ds.crs
            ? h('span', { class: 'badge ok' }, ds.crsSource === 'file' ? 'du fichier' : 'défini')
            : h('span', { class: 'badge warn' }, 'non défini')
      left.append(
        h(
          'div',
          { class: 'card' },
          h('header', null, vis, h('span', { class: 'name', title: ds.name }, ds.name), h('span', { class: 'badge' }, ds.format + (ds.meta.version ? ' ' + ds.meta.version : '')), h('button', { class: 'icon', title: 'Cadrer', onclick: () => view.fit(item.dl.extent) }, '⌖'), h('button', { class: 'icon', title: 'Fermer ce fichier', onclick: () => project.remove(item) }, '✕')),
          h(
            'div',
            { class: 'body' },
            h('div', null, h('button', { class: 'link', onclick: () => openCrs(item) }, crsLabel(ds.crs)), ' ', crsBadge),
            h('small', null, `${ds.entities.length} entités · ${item.dl.counts.polylines} tracés · ${item.dl.counts.texts} textes`),
            item.error ? h('div', { class: 'note err' }, item.error) : null,
            unsupported.length ? h('div', { class: 'note warn' }, 'Non interprété : ' + unsupported.map(([k, n]) => `${n} × ${k}`).join(', ')) : null,
            layers,
          ),
        ),
      )
    }
    hint.hidden = project.items.length > 0
  }

  hint.append(
    h(
      'div',
      null,
      h('h2', null, 'Déposez vos fichiers ici'),
      h('p', null, 'DWG, DXF, Shapefile, GeoJSON, KML, GPX — ou un fichier de points (TXT, CSV) pour générer un plan.'),
      h('p', { class: 'muted' }, 'Tout est traité sur votre appareil : vos fichiers ne sont envoyés nulle part.'),
      h('div', { class: 'actions', style: 'justify-content:center' }, h('button', { class: 'primary', onclick: () => fileInput.click() }, 'Choisir des fichiers'), h('button', { onclick: () => openAssistant(project, null, afterPlan) }, 'Générer un plan depuis des points')),
    ),
  )

  // --- Panneau droit : propriétés, mesure, compte rendu -------------------------
  function renderRight(): void {
    clear(right)
    if (view.tool !== 'select') {
      const m = view.measureResult()
      right.append(h('h3', { style: 'margin-top:0' }, view.tool === 'distance' ? 'Mesure de distance' : 'Mesure de surface'))
      const rows: [string, string][] = [['Points', String(m.points)], [view.tool === 'area' ? 'Périmètre' : 'Longueur', m.length.toFixed(3) + ' m']]
      if (view.tool === 'area') rows.push(['Surface', m.area.toFixed(2) + ' m² (' + formatArea(m.area) + ')'])
      right.append(kv(rows), h('p', { class: 'muted' }, 'Cliquez pour poser des points (accrochage aux sommets), double-cliquez pour terminer, Échap pour effacer. Mesures dans le plan de projection du projet.'))
    }
    const sel = project.selection
    if (sel) {
      const e = sel.item.ds.entities[sel.entity]
      right.append(h('h3', null, 'Objet sélectionné'))
      const rows: [string, string][] = [['Type', TYPE_NAMES[e.t]], ['Calque', e.layer], ['Fichier', sel.item.ds.name]]
      const dl = sel.item.dl
      let length = 0
      let area = 0
      let closed = false
      for (let i = 0; i < dl.polyEnt.length; i++) {
        if (dl.polyEnt[i] !== sel.entity) continue
        const pts = dl.coords.subarray(dl.polyStart[i] * 2, dl.polyStart[i + 1] * 2)
        length += polylineLength(pts, dl.polyClosed[i] === 1)
        if (dl.polyClosed[i]) {
          area += Math.abs(ringArea(pts))
          closed = true
        }
      }
      if (e.t === 'insert') rows.push(['Bloc', e.block])
      if (e.t === 'text') rows.push(['Texte', e.text], ['Hauteur', e.h.toFixed(3)])
      if (e.t === 'point' || e.t === 'insert' || e.t === 'text') rows.push(['X', e.x.toFixed(3)], ['Y', e.y.toFixed(3)])
      if ((e.t === 'point' || e.t === 'insert') && e.z !== undefined) rows.push(['Z', e.z.toFixed(3)])
      if (e.t === 'circle' || e.t === 'arc') rows.push(['Rayon', e.r.toFixed(3)])
      if (e.t === 'pline' && e.elev !== undefined) rows.push(['Altitude', e.elev.toFixed(2)])
      if (length && e.t !== 'insert' && e.t !== 'text') rows.push([closed ? 'Périmètre' : 'Longueur', length.toFixed(3) + ' m'])
      if (closed && e.t !== 'insert') rows.push(['Surface', area.toFixed(2) + ' m²'])
      right.append(kv(rows))
      if (e.props && Object.keys(e.props).length) right.append(h('h3', null, 'Attributs'), kv(Object.entries(e.props).map(([k, v]): [string, string] => [k, String(v ?? '')])))
    }
    const planItem = project.items.find((i) => i.plan)
    if (planItem?.plan) {
      const p = planItem.plan
      right.append(h('h3', null, 'Compte rendu de génération'))
      for (const r of p.report) right.append(h('div', { class: 'note ' + (r.level === 'ok' ? 'ok' : r.level === 'alerte' ? 'warn' : '') }, r.message))
      if (p.parcel) right.append(h('h3', null, 'Parcelle'), kv([['Superficie', `${p.parcel.area.toFixed(2)} m² (${formatArea(p.parcel.area)})`], ['Périmètre', p.parcel.perimeter.toFixed(2) + ' m'], ['Sommets', String(p.parcel.vertices.length)]]))
      right.append(h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => openPrintDialog(project, viewExtent(), lastPlanSpec) }, 'Mise en page / PDF'), h('button', { onclick: openExport }, 'Exporter DXF…')))
      right.append(h('p', { class: 'muted' }, 'Le géomètre reste responsable du plan : vérifiez les limites, les altitudes et la superficie avant diffusion.'))
    }
    if (!sel && view.tool === 'select' && !planItem) {
      right.append(h('h3', { style: 'margin-top:0' }, 'Propriétés'), h('p', { class: 'muted' }, 'Cliquez un objet du plan pour afficher son calque, ses dimensions et ses attributs.'))
    }
  }

  function kv(rows: [string, string][]): HTMLElement {
    return h('table', { class: 'kv' }, h('tbody', null, ...rows.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v)))))
  }

  // --- Barre d'état -----------------------------------------------------------
  const coord = h('span', { class: 'mono' }, 'X —  Y —')
  const lonlat = h('span', { class: 'mono muted' })
  const scaleLabel = h('span', { class: 'mono' })
  const crsButton = h('button', { class: 'link', onclick: () => openCrs(null) })
  status.append(coord, lonlat, scaleLabel, h('span', { class: 'grow' }), h('span', null, 'Système du projet : ', crsButton), h('span', { class: 'muted' }, 'Fichiers traités localement'))
  view.onCursor = (x, y) => {
    coord.textContent = `X ${x.toFixed(3)}   Y ${y.toFixed(3)}`
    const ll = toLonLat(project.crs, x, y)
    lonlat.textContent = ll ? `${ll[1].toFixed(6)}° ${ll[1] >= 0 ? 'N' : 'S'}  ${ll[0].toFixed(6)}° ${ll[0] >= 0 ? 'E' : 'O'}` : ''
  }
  const updateScale = () => {
    // Échelle approximative à l'écran (96 points par pouce CSS).
    const pxPerM = view.view.scale / view.dpr
    const denom = (96 / 0.0254) / pxPerM
    scaleLabel.textContent = Number.isFinite(denom) && project.items.length ? '≈ 1/' + (denom >= 100 ? Math.round(denom / 10) * 10 : Math.round(denom)) : ''
    crsButton.textContent = crsLabel(project.crs)
  }
  view.onViewChange = updateScale
  view.onMeasure = renderRight

  project.on((what) => {
    if (what === 'data' || what === 'view') renderLeft()
    renderRight()
    updateScale()
  })

  // --- Dialogue : système de coordonnées ---------------------------------------
  function openCrs(item: Item | null): void {
    const body = h('div', { class: 'content' })
    const current = item ? item.ds.crs : project.crs
    let chosen: string | null = current
    const list = h('div')
    const candidates = item ? detectCrs(rawExtent(item.ds)) : []
    const info = h('div', { class: 'note' })
    const draw = (defs: { def: CrsDef; note?: string }[]) => {
      clear(list)
      for (const { def, note } of defs) {
        list.append(h('button', { class: 'cand' + (def.code === chosen ? ' sel' : ''), onclick: () => {
          chosen = def.code
          draw(defs)
        } }, h('span', null, h('b', null, def.name), h('small', null, `${def.code} — ${def.area}${note ? ' — ' + note : ''}`))))
      }
      if (!defs.length) list.append(h('p', { class: 'muted' }, 'Aucun système trouvé.'))
    }
    const search = h('input', { type: 'text', placeholder: 'Rechercher : pays, « UTM 32 », « Lambert », code EPSG…', oninput: () => {
      const q = search.value.trim()
      if (q) draw(searchCrs(q).map((def) => ({ def })))
      else showDefault()
    } })
    const showDefault = () => {
      if (item && candidates.length) {
        draw(candidates.map((c) => ({ def: c.def, note: `situerait le fichier vers ${Math.abs(c.lat).toFixed(3)}° ${c.lat >= 0 ? 'N' : 'S'}, ${Math.abs(c.lon).toFixed(3)}° ${c.lon >= 0 ? 'E' : 'O'}` })))
      } else {
        const def = current ? getCrs(current) : undefined
        draw(def ? [{ def }] : [])
      }
    }
    if (item) {
      info.textContent = candidates.length
        ? 'Systèmes compatibles avec les coordonnées du fichier, classés selon votre région. Choisissez, puis vérifiez la position sur le fond de carte.'
        : 'Les coordonnées de ce fichier ne correspondent à aucun système du catalogue : il s’agit probablement de coordonnées locales.'
    } else info.textContent = 'Tous les fichiers sont reprojetés à la volée dans le système du projet. Les fichiers d’origine ne sont pas modifiés.'
    body.append(info, field('Recherche', search), list)
    const close = modal(item ? `Système de coordonnées — ${item.ds.name}` : 'Système de coordonnées du projet', body)
    body.append(
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'primary', onclick: () => {
          if (item) project.setDatasetCrs(item, chosen, 'user')
          else project.setCrs(chosen)
          close()
          view.fit()
        } }, 'Appliquer'),
        h('button', { onclick: () => {
          if (item) project.setDatasetCrs(item, null, 'none')
          else project.setCrs(null)
          close()
          view.fit()
        } }, 'Coordonnées locales (aucun système)'),
      ),
    )
    showDefault()
  }

  // --- Dialogue : export --------------------------------------------------------
  function openExport(): void {
    const items = project.items.filter((i) => i.ds.visible)
    if (!items.length) {
      toast('Rien à exporter : ouvrez un fichier ou générez un plan.', 'erreur')
      return
    }
    let format = 'dxf'
    let scope = 'tous'
    let target = project.crs ?? ''
    const notes = h('div')
    const name = () => (scope === 'tous' ? (items.length === 1 ? items[0].ds.name : 'projet') : items[Number(scope)].ds.name).replace(/\.[^.]+$/, '')
    const crsOptions: [string, string][] = []
    const seen = new Set<string>()
    for (const c of [project.crs, ...items.map((i) => i.ds.crs)]) {
      if (c && !seen.has(c)) {
        seen.add(c)
        crsOptions.push([c, crsLabel(c)])
      }
    }
    crsOptions.push(['', 'Coordonnées du fichier, sans conversion'])
    const body = h(
      'div',
      { class: 'content' },
      field('Contenu', select([['tous', 'Tous les fichiers affichés'], ...items.map((i, k): [string, string] => [String(k), i.ds.name])], scope, (v) => (scope = v))),
      field('Format', select([['dxf', 'DXF — AutoCAD, Covadis, QGIS, Global Mapper'], ['geojson', 'GeoJSON — SIG web, QGIS'], ['kml', 'KML — Google Earth'], ['csv', 'CSV — tableau des points']], format, (v) => (format = v))),
      field('Système de coordonnées (DXF et CSV)', select(crsOptions, target, (v) => (target = v)), 'GeoJSON et KML sont toujours en longitude/latitude WGS 84.'),
      h('div', { class: 'note' }, 'Export DWG : aucune bibliothèque fiable n’écrit ce format dans un navigateur aujourd’hui. Le DXF s’ouvre directement dans AutoCAD et Covadis (commande OUVRIR), où il peut être enregistré en DWG.'),
      notes,
    )
    body.append(
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'primary', onclick: () => {
          const chosen = scope === 'tous' ? items : [items[Number(scope)]]
          let r: ExportResult
          try {
            if (format === 'dxf') r = exportDxf(chosen, target || null, name())
            else if (format === 'geojson') r = exportGeoJSON(chosen, name())
            else if (format === 'kml') r = exportKml(chosen, name())
            else r = exportPointsCsv(chosen, target || null, name())
          } catch (err) {
            toast('Export impossible : ' + String((err as Error).message ?? err), 'erreur')
            return
          }
          if ((format === 'geojson' || format === 'kml') && chosen.some((i) => !i.ds.crs)) r.notes.unshift('Attention : au moins un fichier n’a pas de système de coordonnées défini ; ses coordonnées ont été exportées telles quelles.')
          download(r)
          clear(notes)
          notes.append(h('div', { class: 'note ok' }, `${r.name} téléchargé.`), ...r.notes.map((n) => h('div', { class: 'note' }, n)))
        } }, 'Exporter'),
      ),
    )
    modal('Exporter', body)
  }

  // --- Dialogue : extensions ------------------------------------------------------
  function openExtensions(): void {
    const list = h('div')
    const draw = (q: string) => {
      clear(list)
      const words = q.toLowerCase().split(/\s+/).filter(Boolean)
      const rows = CAPABILITIES.filter((c) => words.every((w) => (c.name + c.formats + c.component + c.description + c.category + c.status).toLowerCase().includes(w)))
      list.append(
        h(
          'table',
          { class: 'grid' },
          h('thead', null, h('tr', null, ...['Capacité', 'Formats', 'Composant et licence', 'Où', 'État'].map((c) => h('th', null, c)))),
          h('tbody', null, ...rows.map((c) => h('tr', null, h('td', null, h('b', null, c.name), h('br'), h('small', null, c.description)), h('td', null, c.formats), h('td', null, c.component, h('br'), h('small', null, c.license)), h('td', null, c.runs), h('td', null, h('span', { class: 'badge ' + (c.status === 'intégré' ? 'ok' : 'warn') }, c.status))))),
        ),
      )
    }
    const search = h('input', { type: 'text', placeholder: 'Rechercher une capacité : « shapefile », « courbes », « export »…', oninput: () => draw(search.value) })
    const body = h('div', { class: 'content' }, h('p', null, 'Registre des capacités de la plateforme : ce qui est intégré aujourd’hui et ce qui est identifié pour la suite. Chaque composant externe est isolé et remplaçable.'), field('Recherche', search), list)
    draw('')
    modal('Extensions et capacités', body, { wide: true })
  }

  renderLeft()
  renderRight()
  updateScale()
}
