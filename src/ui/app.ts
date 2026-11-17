/**
 * Écran principal, organisé comme AutoCAD et Covadis : barre de menus, ruban d'outils,
 * zone de dessin, panneaux (fichiers et calques ; propriétés et manuel), ligne de
 * commande et barre d'état.
 */
import { ping } from '../cloud/ping'
import { crsLabel, detectCrs, getCrs, searchCrs, toLonLat, type CrsDef } from '../core/crs'
import { colorToCss, polylineLength, rawExtent } from '../core/geom'
import { Project, type Item } from '../core/project'
import { FOREGROUND, ensureLayer, type Color, type Entity } from '../core/types'
import { ADVANCED_COMMANDS } from '../edit/advanced'
import { GEOMETRY_COMMANDS } from '../edit/commands'
import { Editor, type CommandDef } from '../edit/editor'
import { closedRing, ringAreaAbs, vertices } from '../edit/ops'
import { isEditable } from '../edit/query'
import { download, exportDxf, exportGeoJSON, exportKml, exportPointsCsv, type ExportResult } from '../io/export'
import { CAPABILITIES, importFiles } from '../io/import'
import { TILE_SOURCES } from '../render/basemap'
import { MapView } from '../render/mapview'
import { formatArea } from '../topo/sheet'
import { authGate, openAccountDialog, openAdminPanel, type Session } from './account'
import { openAssistant, type AssistantResult } from './assistant'
import { defaultDoc, docHooks, frameOutline, frameOverlay, openDocumentWizard, type DocSettings } from './document'
import { clear, field, h, modal, select, toast } from './dom'
import { icon } from './icons'
import { MENU_ORDER, renderManual } from './manual'
import { openPrintDialog } from './print'
import { findAutosave, makeAutosave, openProjectsDialog, openSnapshot, type ProjectHost } from './projects'

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

const COLORS: [string, Color][] = [
  ['DuCalque', -1],
  ['Blanc / noir', FOREGROUND],
  ['Rouge', 0xff0000],
  ['Jaune', 0xffff00],
  ['Vert', 0x00c000],
  ['Cyan', 0x00ffff],
  ['Bleu', 0x0000ff],
  ['Magenta', 0xff00ff],
  ['Orange', 0xff8000],
  ['Gris', 0x808080],
]

export function startApp(root: HTMLElement): void {
  const project = new Project()
  const ed = new Editor(project)
  let doc: DocSettings = defaultDoc(project)
  let session: Session = { email: '', role: 'user', guest: true }
  let docAsked = false

  // --- Structure -----------------------------------------------------------------
  const menubar = h('header', { class: 'menubar' })
  const ribbon = h('div', { class: 'ribbon' })
  const left = h('aside', { class: 'side left' })
  const right = h('aside', { class: 'side right' })
  const stage = h('div', { class: 'stage' })
  const cmdLog = h('div', { class: 'cmd-log' })
  const cmdPrompt = h('span', { class: 'cmd-prompt' })
  const cmdInput = h('input', { class: 'cmd-input', type: 'text', autocomplete: 'off', spellcheck: false, 'aria-label': 'Ligne de commande' })
  const cmdline = h('div', { class: 'cmdline' }, cmdLog, h('div', { class: 'cmd-row' }, cmdPrompt, cmdInput))
  const status = h('footer', { class: 'statusbar' })
  root.append(h('div', { class: 'shell' }, menubar, ribbon, h('div', { class: 'main' }, left, stage, right), cmdline, status))

  const view = new MapView(stage, project, ed)
  view.overlays.push(frameOverlay(() => doc, project))
  const hint = h('div', { class: 'drop-hint' })
  const busy = h('div', { class: 'busy', hidden: true })
  stage.append(hint, busy)

  // --- Reprise du travail ------------------------------------------------------------
  const host: ProjectHost = {
    project,
    name: '',
    getView: () => ({ cx: view.view.cx, cy: view.view.cy, scale: view.view.scale / view.dpr }),
    setView: (v) => {
      if (v && Number.isFinite(v.cx + v.cy + v.scale) && v.scale > 0) {
        view.view.cx = v.cx
        view.view.cy = v.cy
        view.view.scale = v.scale * view.dpr
        view.invalidate()
      } else view.fit()
    },
    getDoc: () => doc,
    setDoc: (d) => {
      doc = { ...defaultDoc(project), ...(d as DocSettings) }
      docAsked = true
      docChanged()
    },
  }
  const autosave = makeAutosave(host)
  const docChanged = () => {
    ed.docScale = doc.scale
    updateStatus()
    view.schedule()
    autosave()
    if (rightTab === 'props') renderRight()
  }

  // --- Fichiers -------------------------------------------------------------------------
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => {
    if (fileInput.files?.length) void open([...fileInput.files])
    fileInput.value = ''
  } })
  root.append(fileInput)

  function askDocument(intro?: string): void {
    docAsked = true
    openDocumentWizard(project, doc, (openPrint) => {
      docChanged()
      if (doc.showFrame) toast('Le cadre de la feuille est affiché en pointillés. Commande CADRE pour le déplacer.', 'ok')
      if (openPrint) printDialog()
    }, intro)
  }

  async function open(files: File[]): Promise<void> {
    const saved = files.find((f) => f.name.toLowerCase().endsWith('.geoprojet'))
    if (saved) {
      try {
        openSnapshot(host, new Uint8Array(await saved.arrayBuffer()))
        toast(`Projet « ${host.name} » rouvert.`, 'ok')
      } catch (err) {
        toast(String((err as Error).message ?? err), 'erreur')
      }
      return
    }
    busy.hidden = false
    busy.textContent = 'Lecture en cours…'
    const first = project.items.length === 0
    try {
      const res = await importFiles(files, (m) => (busy.textContent = m))
      for (const ds of res.datasets) {
        if (!ds.crs) {
          const c = detectCrs(rawExtent(ds))
          if (c.length && c[0].distanceKm < 3000) {
            ds.crs = c[0].def.code
            ds.crsSource = 'detected'
          }
        }
        const item = project.add(ds)
        if (ds.kind === 'cad' && isEditable(project, item)) ed.activeItem = item
      }
      for (const e of res.errors) toast(e, 'erreur', 9000)
      renderLeft()
      refreshLayerSelect()
      if (res.datasets.length) {
        if (first) {
          view.fit()
          if (!host.name) host.name = res.datasets[0].name.replace(/\.[^.]+$/, '')
        }
        ed.message(`${res.datasets.length} fichier(s) ouvert(s) : ${res.datasets.map((d) => `${d.name} (${d.entities.length} objets)`).join(', ')}`)
        if (!docAsked) askDocument(`Fichier ouvert : ${res.datasets[0].name}. Que souhaitez-vous produire à partir de ce fichier ?`)
      }
      if (res.points.length) openAssistant(project, res.points[0], afterPlan)
    } finally {
      busy.hidden = true
    }
  }

  function afterPlan(r: AssistantResult): void {
    if (!host.name) host.name = r.item.ds.name
    ed.activeItem = r.item
    renderLeft()
    doc.scale = r.scale
    if (r.paper) doc.paper = r.paper
    if (r.landscape !== undefined) doc.landscape = r.landscape
    if (r.showTable !== undefined) doc.showTable = r.showTable
    if (r.showLegend !== undefined) doc.showLegend = r.showLegend
    doc.type = r.plan.parcel ? 'bornage' : r.plan.tin ? 'topo_alti' : 'topo'
    doc.template = 'cameroun'
    view.fit()
    renderRight()
    askDocument('Plan dessiné. Complétez les renseignements qui figureront sur la feuille.')
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

  const viewExtent = () => view.viewport()
  const printDialog = () => openPrintDialog(project, viewExtent(), doc, docChanged)

  // --- Commandes de l'interface -------------------------------------------------------------
  const ui = (def: Omit<CommandDef, 'steps'> & { steps?: string[] }): CommandDef => ({ steps: [def.tip], ...def })
  const UI_COMMANDS: CommandDef[] = [
    ui({ id: 'OUVRIR', label: 'Ouvrir un fichier…', aliases: ['OUV', 'OPEN'], menu: 'Fichier', ribbon: ['Mise en page', 'Fichier'], icon: 'open', tip: 'Ouvre un DWG, DXF, Shapefile, GeoJSON, KML, GPX, un fichier de points ou un projet .geoprojet. Vous pouvez aussi glisser les fichiers sur la zone de dessin.', run: () => fileInput.click() }),
    ui({ id: 'NOUVEAU', label: 'Nouveau dessin (vider)', aliases: ['NEW'], menu: 'Fichier', icon: 'doc', tip: 'Ferme tous les fichiers et repart d’un dessin vide (le travail en cours reste récupérable via Projets s’il a été enregistré).', run: () => {
      if (project.items.length && !confirm('Fermer tous les fichiers et repartir d’un dessin vide ?')) return
      for (const i of [...project.items]) project.remove(i)
      ed.history.clear()
      doc = defaultDoc(project)
      docAsked = false
      host.name = ''
      docChanged()
    } }),
    ui({ id: 'PROJETS', label: 'Projets (enregistrer, rouvrir)…', aliases: ['PROJ', 'ENREG'], menu: 'Fichier', ribbon: ['Mise en page', 'Fichier'], icon: 'projects', tip: 'Enregistre le travail sur l’appareil, dans un fichier .geoprojet ou en ligne dans votre compte, et rouvre un projet.', run: () => openProjectsDialog(host) }),
    ui({ id: 'EXPORTER', label: 'Exporter (DXF, GeoJSON, KML, CSV)…', aliases: ['EXP', 'EXPORT'], menu: 'Fichier', ribbon: ['Mise en page', 'Fichier'], icon: 'export', tip: 'Enregistre le dessin en DXF (AutoCAD, Covadis), GeoJSON, KML ou CSV de points.', run: () => openExport() }),
    ui({ id: 'SEMIS', label: 'Charger un semis de points / plan automatique…', aliases: ['ASSISTANT', 'CHARGPNT'], menu: 'Topo 2D', ribbon: ['Topographie', 'Points'], icon: 'assistant', tip: 'Lit un fichier de points (TXT, CSV, XYZ), contrôle les données, interprète les codes terrain et dessine le plan automatiquement.', steps: ['Choisissez le fichier de points (ou le levé d’exemple).', 'Vérifiez les colonnes reconnues, les anomalies et les codes.', 'Réglez les options du semis (décimales, 2D/3D, symboles, décalage) et du plan, ou décrivez-le en une phrase.', 'Cliquez « Analyser et générer mon plan ».'], run: () => openAssistant(project, null, afterPlan) }),
    ui({ id: 'NOUVEAUPLAN', label: 'Nouveau plan (type, format, renseignements)…', aliases: ['DOCUMENT', 'PLAN'], menu: 'Édition plan', ribbon: ['Mise en page', 'Plan'], icon: 'doc', tip: 'Choisit le type de document (bornage, état des lieux, croquis…), le format, l’échelle et les renseignements ; le titre est rédigé automatiquement.', steps: ['Choisissez le type de document.', 'Choisissez le format, l’orientation et l’échelle.', 'Renseignez date, demandeur, propriétaire, T.F., lieu, géomètre.', 'Validez : le cadre de la feuille apparaît dans le dessin.'], run: () => askDocument() }),
    ui({ id: 'CADRE', label: 'Déplacer le cadre de la feuille', aliases: ['CF'], menu: 'Édition plan', ribbon: ['Mise en page', 'Plan'], icon: 'frame', tip: 'Cale la feuille sur la partie du dessin à imprimer.', steps: ['Le cadre de la feuille suit le curseur.', 'Cliquez le nouveau centre.'], async run(e) {
      doc.showFrame = true
      const extent = project.extent() ?? view.viewport()
      const p = await e.getPoint('Cliquez le nouveau centre de la feuille', { noSnap: true, preview: (c) => {
        const o = frameOutline(doc, extent, c)
        return { lines: [o.paper, o.frame], closed: [true, true] }
      } })
      doc.center = p
      docChanged()
    } }),
    ui({ id: 'MEP', label: 'Mise en page et PDF…', aliases: ['IMPRIMER', 'PDF', 'TRACER'], menu: 'Édition plan', ribbon: ['Mise en page', 'Impression'], icon: 'print', tip: 'Aperçu de la feuille, renseignements, et PDF vectoriel à l’échelle (A4 à A0, plusieurs formats d’un coup).', run: () => printDialog() }),
    ui({ id: 'ZE', label: 'Zoom étendu (tout voir)', aliases: ['ZOOMETENDU', 'TOUT'], menu: 'Affichage', ribbon: ['Affichage', 'Navigation'], icon: 'zoom', tip: 'Cadre la vue sur tout le dessin.', run: () => view.fit() }),
    ui({ id: 'ZF', label: 'Zoom fenêtre', aliases: ['ZOOMFENETRE'], menu: 'Affichage', ribbon: ['Affichage', 'Navigation'], icon: 'zoomwin', tip: 'Agrandit la zone définie par deux coins.', steps: ['Cliquez un coin.', 'Cliquez le coin opposé.'], async run(e) {
      const a = await e.getPoint('Premier coin', { noSnap: true })
      const b = await e.getPoint('Coin opposé', { noSnap: true, preview: (c) => ({ lines: [[a[0], a[1], c[0], a[1], c[0], c[1], a[0], c[1]]], closed: [true] }) })
      view.fit([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])])
    } }),
    ui({ id: 'SCR', label: 'Système de coordonnées du projet…', aliases: ['CRS', 'PROJECTION'], menu: 'Outils', ribbon: ['Affichage', 'Carte'], icon: 'crs', tip: 'Choisit le système de coordonnées commun ; tous les fichiers y sont reprojetés à l’affichage.', run: () => openCrs(null) }),
    ui({ id: 'SCRIPT', label: 'Exécuter un script…', aliases: ['SCRIPTS', 'SCR2', 'MACRO'], menu: 'Outils', ribbon: ['Projets', 'Automatisation'], icon: 'script', tip: 'Enchaîne des saisies de la ligne de commande écrites à l’avance (une par ligne, comme un fichier .scr d’AutoCAD) : dessiner, coter ou habiller automatiquement.', steps: ['Collez ou chargez le script (fichier .scr ou .txt).', 'Une ligne = une saisie : nom de commande, coordonnées, valeur ou option ; ligne vide = Entrée ; « ; » = commentaire.', 'Cliquez Exécuter : chaque saisie apparaît dans la ligne de commande ; Ctrl+Z annule ensuite chaque objet créé.'], run: () => openScript() }),
    ui({ id: 'EXTENSIONS', label: 'Extensions et capacités…', aliases: ['EXT'], menu: 'Outils', icon: 'layers', tip: 'Registre des formats et fonctions intégrés et prévus.', run: () => openExtensions() }),
    ui({ id: 'COMPTE', label: 'Mon compte…', aliases: ['ACCOUNT'], menu: 'Outils', icon: 'user', tip: 'Profil, mot de passe, code administrateur, déconnexion.', run: () => openAccount() }),
    ui({ id: 'ADMIN', label: 'Administration (utilisateurs)…', aliases: ['ADMINISTRATION'], menu: 'Outils', icon: 'user', tip: 'Réservé aux administrateurs : comptes, activité, projets.', run: () => (session.role === 'admin' ? openAdminPanel() : toast('Réservé aux administrateurs.', 'erreur')) }),
    ui({ id: 'AIDE', label: 'Manuel d’utilisation', aliases: ['HELP', '?'], menu: 'Aide', ribbon: ['Affichage', 'Panneaux'], icon: 'help', tip: 'Affiche ce manuel dans le panneau de droite (F1).', run: () => showManual() }),
  ]
  ed.register([...GEOMETRY_COMMANDS, ...ADVANCED_COMMANDS, ...UI_COMMANDS])
  ed.actions.notify = (m?: string) => m && toast(m, 'ok', 9000)
  docHooks.selection = () => ed.selection
  ed.actions.downloadText = (arg?: string) => {
    if (!arg) return
    const { name, content } = JSON.parse(arg) as { name: string; content: string }
    download({ name, mime: 'text/csv;charset=utf-8', data: '\ufeff' + content })
  }

  // --- Barre de menus --------------------------------------------------------------------------
  let openMenu: HTMLElement | null = null
  const closeMenus = () => {
    openMenu?.classList.remove('open')
    openMenu = null
  }
  document.addEventListener('pointerdown', (e) => {
    if (openMenu && !openMenu.contains(e.target as Node)) closeMenus()
  })
  const userBtn = h('button', { class: 'user-btn' })
  function buildMenus(): void {
    clear(menubar)
    menubar.append(h('div', { class: 'brand' }, 'AppStock Géo'))
    for (const m of MENU_ORDER) {
      const cmds = [...ed.commands.values()].filter((c) => c.menu === m && (c.id !== 'ADMIN' || session.role === 'admin'))
      if (!cmds.length) continue
      const list = h('div', { class: 'menu-list' })
      for (const c of cmds) {
        list.append(h('button', { class: 'menu-item', onclick: () => {
          closeMenus()
          void ed.run(c.id)
        } }, icon(c.icon), h('span', null, c.label), h('kbd', null, c.aliases[0] ?? '')))
      }
      if (m === 'Affichage') {
        list.append(h('div', { class: 'menu-sep' }), h('button', { class: 'menu-item', onclick: () => {
          closeMenus()
          toggleDark()
        } }, icon('map'), h('span', null, 'Fond clair / sombre'), h('kbd', null, '')))
      }
      if (m === 'Aide') {
        list.append(h('button', { class: 'menu-item', onclick: () => {
          closeMenus()
          showManual('raccourcis')
        } }, icon('help'), h('span', null, 'Raccourcis clavier'), h('kbd', null, 'F1')))
      }
      const wrap = h('div', { class: 'menu' })
      wrap.append(h('button', { class: 'menu-title', onclick: () => {
        if (openMenu === wrap) return closeMenus()
        closeMenus()
        wrap.classList.add('open')
        openMenu = wrap
      }, onpointerenter: () => {
        if (openMenu && openMenu !== wrap) {
          closeMenus()
          wrap.classList.add('open')
          openMenu = wrap
        }
      } }, m), list)
      menubar.append(wrap)
    }
    menubar.append(h('span', { class: 'grow' }), userBtn)
  }

  // --- Ruban ------------------------------------------------------------------------------------
  const RIBBON_TABS = ['Début', 'Topographie', 'Projets', 'Mise en page', 'Affichage']
  const GROUPS: Record<string, string[]> = {
    Début: ['Dessin', 'Modification', 'Annotation', 'Calques'],
    Topographie: ['Points', 'Calculs', 'Habillage', 'Terrain'],
    Projets: ['Terrain', 'Volumes', 'Parcelles', 'Automatisation'],
    'Mise en page': ['Plan', 'Impression', 'Fichier'],
    Affichage: ['Navigation', 'Carte', 'Panneaux'],
  }
  let tab = 'Début'
  const layerSelect = h('select', { class: 'layer-select', title: 'Calque courant' })
  layerSelect.addEventListener('change', () => {
    ed.currentLayer = layerSelect.value
    renderLeft()
  })
  const snapBtn = h('button', { class: 'toggle', title: 'Accrochage aux objets (F3)', onclick: () => toggleSnap() }, 'ACCROCHAGE')
  const orthoBtn = h('button', { class: 'toggle', title: 'Mode ortho (F8)', onclick: () => toggleOrtho() }, 'ORTHO')
  const basemapSelect = select([['aucun', 'Sans fond de carte'], ...TILE_SOURCES.map((s): [string, string] => [s.id, s.label])], 'aucun', (v) => {
    view.basemap = v
    if (v !== 'aucun' && !project.crs) toast('Le fond de carte s’affiche quand le système de coordonnées du projet est connu.', 'info')
    view.invalidate()
  })

  function targetCandidate(): Item | null {
    if (ed.activeItem && project.items.includes(ed.activeItem) && isEditable(project, ed.activeItem)) return ed.activeItem
    return project.items.find((i) => i.ds.meta.dessin === 1 && isEditable(project, i)) ?? null
  }

  function refreshLayerSelect(): void {
    const item = targetCandidate()
    const names = item ? [...item.ds.layers.keys()] : ['0']
    if (!names.includes(ed.currentLayer)) names.push(ed.currentLayer)
    layerSelect.replaceChildren(...names.map((n) => h('option', { value: n }, n)))
    layerSelect.value = ed.currentLayer
  }

  function buildRibbon(): void {
    clear(ribbon)
    const tabs = h('div', { class: 'ribbon-tabs' })
    for (const t of RIBBON_TABS) tabs.append(h('button', { class: 'ribbon-tab' + (t === tab ? ' active' : ''), onclick: () => {
      tab = t
      buildRibbon()
    } }, t))
    const panel = h('div', { class: 'ribbon-panel' })
    for (const g of GROUPS[tab]) {
      const btns = h('div', { class: 'rgroup-btns' })
      for (const c of ed.commands.values()) {
        if (c.ribbon?.[0] !== tab || c.ribbon[1] !== g) continue
        btns.append(h('button', { class: 'rbtn', title: `${c.label} — ${c.tip} (${c.aliases[0] ?? c.id})`, onclick: () => void ed.run(c.id) }, icon(c.icon), h('span', null, c.label.replace(/ \(.*\)$/, '').replace(/…$/, ''))))
      }
      if (tab === 'Début' && g === 'Calques') {
        refreshLayerSelect()
        btns.append(h('div', { class: 'rcol' }, layerSelect, h('button', { class: 'rsmall', onclick: () => newLayer() }, '+ Calque')))
      }
      if (tab === 'Affichage' && g === 'Carte') btns.append(h('div', { class: 'rcol' }, basemapSelect, h('button', { class: 'rsmall', onclick: toggleDark }, 'Fond clair / sombre')))
      if (tab === 'Affichage' && g === 'Panneaux') btns.append(h('div', { class: 'rcol' }, h('button', { class: 'rsmall', onclick: () => left.classList.toggle('hidden') }, 'Fichiers et calques'), h('button', { class: 'rsmall', onclick: () => right.classList.toggle('hidden') }, 'Propriétés et manuel')))
      if (!btns.childElementCount) continue
      panel.append(h('div', { class: 'rgroup' }, btns, h('div', { class: 'rgroup-title' }, g)))
    }
    ribbon.append(tabs, panel)
  }

  // --- Panneau gauche : fichiers et calques ---------------------------------------------------
  function renderLeft(): void {
    clear(left)
    left.append(h('div', { class: 'panel-title' }, 'Fichiers et calques'))
    if (!project.items.length) left.append(h('p', { class: 'muted pad' }, 'Aucun fichier. Dessinez directement, ou Fichier › Ouvrir.'))
    const target = targetCandidate()
    for (const item of project.items) {
      const ds = item.ds
      const editable = isEditable(project, item)
      const active = item === target
      const layers = h('ul', { class: 'layers' })
      for (const layer of ds.layers.values()) {
        if (!item.dl.layerNames.includes(layer.name) && ds.layers.size > 1 && !(active && layer.name === ed.currentLayer)) continue
        const c = h('input', { type: 'checkbox', checked: layer.visible, title: 'Afficher / masquer', onchange: () => {
          layer.visible = c.checked
          project.refreshVisibility(item)
        } })
        const color = h('input', { type: 'color', class: 'swatch-input', value: colorToCss(layer.color, '#ffffff'), title: 'Couleur du calque', disabled: !editable, onchange: () => {
          ed.history.record('Couleur de calque', [item], () => {
            const l = item.ds.layers.get(layer.name)
            if (l) l.color = parseInt(color.value.slice(1), 16)
          })
        } })
        const isCur = active && layer.name === ed.currentLayer
        layers.append(h('li', { class: isCur ? 'current' : '' }, c, color, h('button', { class: 'layer-name', title: active ? 'Rendre ce calque courant' : layer.name, onclick: () => {
          if (!editable) return
          ed.activeItem = item
          ed.currentLayer = layer.name
          refreshLayerSelect()
          renderLeft()
        } }, layer.name), isCur ? h('span', { class: 'badge ok' }, 'courant') : ''))
      }
      const vis = h('input', { type: 'checkbox', checked: ds.visible, title: 'Afficher', onchange: () => {
        ds.visible = vis.checked
        project.emit('view')
      } })
      const unsupported = Object.entries(ds.unsupported)
      const crsBadge = ds.crsSource === 'detected' ? h('span', { class: 'badge warn' }, 'à confirmer') : ds.crs ? h('span', { class: 'badge ok' }, ds.crsSource === 'file' ? 'du fichier' : 'défini') : h('span', { class: 'badge warn' }, 'non défini')
      left.append(
        h(
          'div',
          { class: 'card' + (active ? ' active' : '') },
          h('header', null, vis, h('span', { class: 'name', title: ds.name }, (active ? '★ ' : '') + ds.name), h('span', { class: 'badge' }, ds.format + (ds.meta.version ? ' ' + ds.meta.version : '')), h('button', { class: 'icon', title: 'Cadrer', onclick: () => view.fit(item.dl.extent) }, '⌖'), h('button', { class: 'icon', title: 'Fermer ce fichier', onclick: () => project.remove(item) }, '✕')),
          h(
            'div',
            { class: 'body' },
            h('div', null, h('button', { class: 'link', onclick: () => openCrs(item) }, crsLabel(ds.crs)), ' ', crsBadge),
            h('small', null, `${ds.entities.length} objets · ${item.dl.counts.texts} textes`),
            editable ? (active ? h('small', { class: 'ok-text' }, ' · fichier actif (reçoit le dessin)') : h('button', { class: 'link small', onclick: () => {
              ed.activeItem = item
              if (!item.ds.layers.has(ed.currentLayer)) ed.currentLayer = '0'
              refreshLayerSelect()
              renderLeft()
            } }, ' · rendre actif')) : h('small', { class: 'muted' }, ' · consultation (autre système)'),
            item.error ? h('div', { class: 'note err' }, item.error) : null,
            unsupported.length ? h('div', { class: 'note warn' }, 'Non interprété : ' + unsupported.map(([k, n]) => `${n} × ${k}`).join(', ')) : null,
            layers,
          ),
        ),
      )
    }
    hint.hidden = project.items.length > 0
  }

  function newLayer(): void {
    const item = ed.target()
    const name = h('input', { type: 'text', placeholder: 'Nom du calque, ex. LIMITES' })
    const color = h('input', { type: 'color', value: '#ff0000' })
    const body = h('div', { class: 'content' }, h('div', { class: 'row' }, field('Nom', name), field('Couleur', color)))
    const close = modal('Nouveau calque', body)
    const create = () => {
      const n = name.value.trim()
      if (!n) return toast('Donnez un nom au calque.', 'erreur')
      ed.history.record('Nouveau calque', [item], () => {
        const l = ensureLayer(item.ds, n)
        l.color = parseInt(color.value.slice(1), 16)
      })
      ed.currentLayer = n
      refreshLayerSelect()
      renderLeft()
      close()
    }
    name.addEventListener('keydown', (e) => e.key === 'Enter' && create())
    body.append(h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: create }, 'Créer et rendre courant')))
    name.focus()
  }

  hint.append(
    h(
      'div',
      null,
      h('h2', null, 'Bienvenue'),
      h('p', null, 'Dessinez directement avec les outils du ruban, ou déposez un fichier ici : DWG, DXF, Shapefile, GeoJSON, KML, GPX, fichier de points.'),
      h('div', { class: 'actions center' }, h('button', { class: 'primary', onclick: () => fileInput.click() }, 'Ouvrir un fichier'), h('button', { onclick: () => openAssistant(project, null, afterPlan) }, 'Plan depuis des points'), h('button', { onclick: () => {
        hint.hidden = true
        void ed.run('POLYGONE')
      } }, 'Dessiner une parcelle')),
      h('p', { class: 'muted' }, 'Nouveau ? Le manuel est dans le panneau de droite (F1).'),
    ),
  )

  // --- Panneau droit : propriétés et manuel ---------------------------------------------------
  let rightTab: 'props' | 'manual' = 'props'
  const rightBody = h('div', { class: 'right-body' })
  function showManual(focus?: string): void {
    right.classList.remove('hidden')
    rightTab = 'manual'
    renderRight(focus)
  }
  function renderRight(focus?: string): void {
    clear(right)
    right.append(
      h('div', { class: 'tabs' }, h('button', { class: rightTab === 'props' ? 'active' : '', onclick: () => {
        rightTab = 'props'
        renderRight()
      } }, 'Propriétés'), h('button', { class: rightTab === 'manual' ? 'active' : '', onclick: () => showManual() }, 'Manuel')),
      rightBody,
    )
    clear(rightBody)
    if (rightTab === 'manual') {
      renderManual(rightBody, ed, focus)
      return
    }
    renderProps()
  }

  function kv(rows: [string, string | Node][]): HTMLElement {
    return h('table', { class: 'kv' }, h('tbody', null, ...rows.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v)))))
  }

  function renderProps(): void {
    const sel = ed.selection
    if (!sel.length) {
      rightBody.append(h('p', { class: 'muted' }, 'Sélectionnez un objet (clic, ou fenêtre en glissant) pour voir et modifier ses propriétés.'))
      const plan = project.items.find((i) => i.plan)?.plan
      if (plan) {
        rightBody.append(h('h3', null, 'Compte rendu du plan généré'))
        for (const r of plan.report) rightBody.append(h('div', { class: 'note ' + (r.level === 'ok' ? 'ok' : r.level === 'alerte' ? 'warn' : '') }, r.message))
        if (plan.parcel) rightBody.append(kv([['Superficie', `${plan.parcel.area.toFixed(2)} m² (${formatArea(plan.parcel.area)})`], ['Périmètre', plan.parcel.perimeter.toFixed(2) + ' m']]))
      }
      rightBody.append(h('h3', null, 'Document'), kv([['Type', doc.type === 'libre' ? 'Dessin libre' : doc.info.titre.split('\n')[0] || doc.type], ['Feuille', `${doc.paper} ${doc.landscape ? 'paysage' : 'portrait'}`], ['Échelle', '1/' + doc.scale]]), h('div', { class: 'actions' }, h('button', { onclick: () => askDocument() }, 'Nouveau plan…'), h('button', { class: 'primary', onclick: printDialog }, 'Mise en page / PDF')))
      return
    }
    const editableAll = sel.every((s) => isEditable(project, s.item))
    if (sel.length > 1) {
      const counts = new Map<string, number>()
      for (const s of sel) counts.set(TYPE_NAMES[ed.entity(s).t], (counts.get(TYPE_NAMES[ed.entity(s).t]) ?? 0) + 1)
      rightBody.append(h('h3', null, `${sel.length} objets sélectionnés`), kv([...counts].map(([k, n]) => [k, String(n)])))
    } else {
      const s = sel[0]
      const e = ed.entity(s)
      const rows: [string, string | Node][] = [['Type', TYPE_NAMES[e.t]], ['Fichier', s.item.ds.name]]
      const v = vertices(e)
      const ring = closedRing(e)
      if (v) rows.push([v.closed ? 'Périmètre' : 'Longueur', polylineLength(v.pts, v.closed).toFixed(3) + ' m'], ['Sommets', String(v.pts.length / 2)])
      if (ring) rows.push(['Surface', `${ringAreaAbs(ring).toFixed(2)} m² (${formatArea(ringAreaAbs(ring))})`])
      if (e.t === 'circle' || e.t === 'arc') rows.push(['Centre', `${e.cx.toFixed(3)} ; ${e.cy.toFixed(3)}`], ['Rayon', e.r.toFixed(3)])
      if (e.t === 'point' || e.t === 'insert' || e.t === 'text') rows.push(['X', e.x.toFixed(3)], ['Y', e.y.toFixed(3)])
      if ((e.t === 'point' || e.t === 'insert') && e.z !== undefined) rows.push(['Z', e.z.toFixed(3)])
      if (e.t === 'insert') rows.push(['Bloc', e.block])
      if (e.t === 'pline' && e.elev !== undefined) rows.push(['Altitude', e.elev.toFixed(2)])
      rightBody.append(h('h3', null, 'Objet sélectionné'), kv(rows))
      if (e.t === 'text' && editableAll) {
        const t = h('input', { type: 'text', value: e.text })
        const hh = h('input', { type: 'number', step: 0.1, value: e.h.toFixed(3) })
        rightBody.append(h('div', { class: 'row' }, field('Texte', t), field('Hauteur', hh)), h('button', { onclick: () => {
          const height = parseFloat(hh.value)
          ed.modify('Modifier le texte', new Map([[s.item, { replace: new Map([[s.entity, { ...e, text: t.value, h: height > 0 ? height : e.h }]]) }]]))
        } }, 'Appliquer'))
      }
      if (e.props && Object.keys(e.props).length) rightBody.append(h('h3', null, 'Attributs'), kv(Object.entries(e.props).map(([k, val]): [string, string] => [k, String(val ?? '')])))
    }
    if (editableAll) {
      const items = new Set(sel.map((s) => s.item))
      const layerNames = [...new Set([...items].flatMap((i) => [...i.ds.layers.keys()]))]
      const first = ed.entity(sel[0])
      const layerSel = select(layerNames.map((n): [string, string] => [n, n]), first.layer, (val) => applyAll((x) => ({ ...x, layer: val }), 'Changer de calque'))
      const colorSel = select(COLORS.map(([l, c]): [string, string] => [String(c), l]), String(COLORS.some(([, c]) => c === first.color) ? first.color : -1), (val) => applyAll((x) => ({ ...x, color: Number(val) }), 'Changer de couleur'))
      rightBody.append(h('h3', null, 'Modifier'), h('div', { class: 'row' }, field('Calque', layerSel), field('Couleur', colorSel)), h('div', { class: 'actions' }, h('button', { onclick: () => void ed.run('DEPLACER') }, 'Déplacer'), h('button', { onclick: () => void ed.run('COPIER') }, 'Copier'), h('button', { onclick: () => void ed.run('EFFACER') }, 'Effacer')))
    } else rightBody.append(h('div', { class: 'note' }, 'Fichier en consultation (autre système de coordonnées que le projet) : non modifiable ici.'))
  }

  function applyAll(fn: (e: Entity) => Entity, label: string): void {
    const changes = new Map<Item, { replace: Map<number, Entity> }>()
    for (const s of ed.selection) {
      let c = changes.get(s.item)
      if (!c) changes.set(s.item, (c = { replace: new Map() }))
      c.replace.set(s.entity, fn(ed.entity(s)))
    }
    ed.modify(label, changes)
  }

  // --- Ligne de commande ------------------------------------------------------------------------
  const history: string[] = []
  let historyIndex = -1
  function renderCmd(): void {
    const lines = ed.log.slice(-3)
    cmdLog.replaceChildren(...lines.map((l) => h('div', null, l)))
    cmdPrompt.replaceChildren(ed.promptText.replace(/ \[[^\]]*\]/, ''))
    for (const [key, label] of ed.promptKeywords) cmdPrompt.append(' ', h('button', { class: 'kw', onclick: () => {
      ed.onText(key)
      cmdInput.focus()
    } }, label))
  }
  cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || (e.key === ' ' && !ed.wantsSpaces)) {
      e.preventDefault()
      const v = cmdInput.value
      if (v.trim()) {
        history.push(v)
        historyIndex = history.length
      }
      cmdInput.value = ''
      ed.onText(v)
      if (!ed.busy) view.canvas.focus({ preventScroll: true })
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (cmdInput.value) cmdInput.value = ''
      else ed.onEscape()
    } else if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault()
      historyIndex = Math.max(0, historyIndex - 1)
      cmdInput.value = history[historyIndex] ?? ''
    } else if (e.key === 'ArrowDown' && history.length) {
      e.preventDefault()
      historyIndex = Math.min(history.length, historyIndex + 1)
      cmdInput.value = history[historyIndex] ?? ''
    }
  })

  // --- Clavier global ------------------------------------------------------------------------------
  let spacePanned = false
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]') || document.querySelector('.auth-screen')) return
    const t = e.target as HTMLElement
    if (t === cmdInput) return
    const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
    if (typing) return
    const ctrl = e.ctrlKey || e.metaKey
    if (e.key === 'Escape') {
      ed.onEscape()
      closeMenus()
    } else if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      ed.undo()
    } else if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      ed.redo()
    } else if (ctrl && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      void ed.run('TOUTSEL')
    } else if (e.key === 'Delete' && ed.selection.length) {
      void ed.run('EFFACER')
    } else if (e.key === 'F1') {
      e.preventDefault()
      showManual()
    } else if (e.key === 'F3') {
      e.preventDefault()
      toggleSnap()
    } else if (e.key === 'F8') {
      e.preventDefault()
      toggleOrtho()
    } else if (e.key === ' ') {
      e.preventDefault()
      if (!view.spaceDown) {
        view.spaceDown = true
        spacePanned = false
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      ed.onEnter()
    } else if (e.key.length === 1 && !ctrl && !e.altKey) {
      // Comme dans AutoCAD : taper n'importe où écrit dans la ligne de commande.
      cmdInput.focus()
    }
  })
  document.addEventListener('keyup', (e) => {
    if (e.key !== ' ' || !view.spaceDown) return
    view.spaceDown = false
    if (!spacePanned && !document.querySelector('dialog[open]')) ed.onEnter()
  })
  view.onViewChange = () => {
    if (view.spaceDown) spacePanned = true
    updateStatus()
  }

  // --- Barre d'état ---------------------------------------------------------------------------------
  const coord = h('span', { class: 'mono' }, 'X —  Y —')
  const lonlat = h('span', { class: 'mono muted' })
  const scaleBtn = h('button', { class: 'link', title: 'Type de plan, format et échelle', onclick: () => askDocument() })
  const crsButton = h('button', { class: 'link', onclick: () => openCrs(null) })
  const screenScale = h('span', { class: 'mono muted' })
  status.append(coord, lonlat, snapBtn, orthoBtn, h('span', { class: 'grow' }), screenScale, h('span', null, 'Plan : ', scaleBtn), h('span', null, 'Système : ', crsButton), h('span', { class: 'muted' }, 'Fichiers traités sur votre appareil'))
  view.onCursor = (x, y) => {
    coord.textContent = `X ${x.toFixed(3)}   Y ${y.toFixed(3)}`
    const ll = toLonLat(project.crs, x, y)
    lonlat.textContent = ll ? `${ll[1].toFixed(6)}° ${ll[1] >= 0 ? 'N' : 'S'}  ${ll[0].toFixed(6)}° ${ll[0] >= 0 ? 'E' : 'O'}` : ''
  }
  function updateStatus(): void {
    const pxPerM = view.view.scale / view.dpr
    const denom = 96 / 0.0254 / pxPerM
    screenScale.textContent = Number.isFinite(denom) && project.items.length ? 'écran ≈ 1/' + (denom >= 100 ? Math.round(denom / 10) * 10 : Math.round(denom)) : ''
    scaleBtn.textContent = `${doc.paper} · 1/${doc.scale}`
    crsButton.textContent = crsLabel(project.crs)
    snapBtn.classList.toggle('on', ed.snapOn)
    orthoBtn.classList.toggle('on', ed.ortho)
  }
  function toggleSnap(): void {
    ed.snapOn = !ed.snapOn
    ed.message(ed.snapOn ? '<Accrochage activé>' : '<Accrochage désactivé>')
    updateStatus()
  }
  function toggleOrtho(): void {
    ed.ortho = !ed.ortho
    ed.message(ed.ortho ? '<Ortho activé>' : '<Ortho désactivé>')
    updateStatus()
  }
  function toggleDark(): void {
    view.dark = !view.dark
    document.documentElement.dataset.canvas = view.dark ? 'dark' : 'light'
    view.invalidate()
  }

  // --- Événements ---------------------------------------------------------------------------------------
  ed.on((what) => {
    if (what === 'prompt' || what === 'state') renderCmd()
    if (what === 'selection' && rightTab === 'props') renderRight()
  })
  project.on((what) => {
    if (what === 'data' || what === 'view') {
      renderLeft()
      refreshLayerSelect()
      autosave()
    }
    if (rightTab === 'props') renderRight()
    updateStatus()
  })

  // --- Compte ---------------------------------------------------------------------------------------------
  function refreshUser(): void {
    userBtn.replaceChildren(icon('user'), h('span', null, session.guest ? 'Invité' : session.email + (session.role === 'admin' ? ' · admin' : '')))
    userBtn.onclick = () => openAccount()
  }
  function openAccount(): void {
    openAccountDialog(session, signOut, (role) => {
      session.role = role
      refreshUser()
      buildMenus()
    })
  }
  async function signOut(): Promise<void> {
    try {
      sessionStorage.removeItem('appstock.guest')
    } catch {
      /* rien */
    }
    if (!session.guest) {
      try {
        await (await import('../cloud/cloud')).signOut()
      } catch {
        /* hors ligne */
      }
    }
    location.reload()
  }

  // --- Dialogue : système de coordonnées ------------------------------------------------------------------
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
    const showDefault = () => {
      if (item && candidates.length) draw(candidates.map((c) => ({ def: c.def, note: `situerait le fichier vers ${Math.abs(c.lat).toFixed(3)}° ${c.lat >= 0 ? 'N' : 'S'}, ${Math.abs(c.lon).toFixed(3)}° ${c.lon >= 0 ? 'E' : 'O'}` })))
      else {
        const def = current ? getCrs(current) : undefined
        draw(def ? [{ def }] : [])
      }
    }
    const search = h('input', { type: 'text', placeholder: 'Rechercher : pays, « UTM 32 », « Lambert », code EPSG…', oninput: () => {
      const q = search.value.trim()
      if (q) draw(searchCrs(q).map((def) => ({ def })))
      else showDefault()
    } })
    info.textContent = item
      ? candidates.length
        ? 'Systèmes compatibles avec les coordonnées du fichier, classés selon votre région. Choisissez, puis vérifiez la position sur le fond de carte.'
        : 'Les coordonnées de ce fichier ne correspondent à aucun système du catalogue : probablement des coordonnées locales.'
      : 'Tous les fichiers sont reprojetés à la volée dans le système du projet. Les fichiers d’origine ne sont pas modifiés.'
    body.append(info, field('Recherche', search), list)
    const close = modal(item ? `Système de coordonnées — ${item.ds.name}` : 'Système de coordonnées du projet', body)
    body.append(h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => {
      if (item) project.setDatasetCrs(item, chosen, 'user')
      else project.setCrs(chosen)
      close()
      view.fit()
    } }, 'Appliquer'), h('button', { onclick: () => {
      if (item) project.setDatasetCrs(item, null, 'none')
      else project.setCrs(null)
      close()
      view.fit()
    } }, 'Coordonnées locales (aucun système)')))
    showDefault()
  }

  // --- Dialogue : export ---------------------------------------------------------------------------------
  function openExport(): void {
    const items = project.items.filter((i) => i.ds.visible)
    if (!items.length) return toast('Rien à exporter : ouvrez un fichier ou dessinez.', 'erreur')
    let format = 'dxf'
    let scope = 'tous'
    let target = project.crs ?? ''
    const notes = h('div')
    const name = () => (scope === 'tous' ? (items.length === 1 ? items[0].ds.name : host.name || 'projet') : items[Number(scope)].ds.name).replace(/\.[^.]+$/, '')
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
      h('div', { class: 'note' }, 'Export DWG : aucune bibliothèque fiable n’écrit ce format dans un navigateur aujourd’hui. Le DXF s’ouvre directement dans AutoCAD et Covadis, où il peut être enregistré en DWG.'),
      notes,
    )
    body.append(h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => {
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
      download(r)
      clear(notes)
      notes.append(h('div', { class: 'note ok' }, `${r.name} téléchargé.`), ...r.notes.map((n) => h('div', { class: 'note' }, n)))
    } }, 'Exporter')))
    modal('Exporter', body)
  }

  function openScript(): void {
    const example = [
      '; Exemple : un rectangle de 20 × 12 m, sa surface et une cote',
      'REC',
      '783640,427200',
      '@20,12',
      'ES',
      'D',
      '',
      'COT',
      '783640,427200',
      '783660,427200',
      '783650,427196',
    ].join('\n')
    const area = h('textarea', { class: 'script-area', rows: 14, spellcheck: false, placeholder: example }) as HTMLTextAreaElement
    try {
      area.value = localStorage.getItem('appstock.script') ?? ''
    } catch {
      /* stockage indisponible */
    }
    const file = h('input', { type: 'file', accept: '.scr,.txt', onchange: async () => {
      const f = file.files?.[0]
      if (f) area.value = await f.text()
    } }) as HTMLInputElement
    let close = () => {}
    const run = h('button', { class: 'primary', onclick: async () => {
      const text = area.value.trim() ? area.value : example
      try {
        localStorage.setItem('appstock.script', area.value)
      } catch {
        /* stockage indisponible */
      }
      close()
      const n = await ed.runScript(text)
      toast(`Script exécuté : ${n} saisie(s) envoyée(s).`, 'ok')
    } }, 'Exécuter')
    close = modal('Exécuter un script', h('div', { class: 'content' },
      h('p', { class: 'muted' }, 'Une ligne par saisie, exactement comme au clavier : nom ou raccourci de commande, coordonnées (x,y · @dx,dy · @d<angle · @d<Gg), valeurs, options (lettre majuscule). Ligne vide = Entrée. À « Choix des objets », tapez T (tout) ou D (dernier objet). Les lignes qui commencent par « ; » sont ignorées.'),
      area,
      h('div', { class: 'row' }, file, h('button', { onclick: () => (area.value = example) }, 'Insérer l’exemple'), run),
    ), { wide: true })
  }

  function openExtensions(): void {
    const list = h('div')
    const draw = (q: string) => {
      clear(list)
      const words = q.toLowerCase().split(/\s+/).filter(Boolean)
      const rows = CAPABILITIES.filter((c) => words.every((w) => (c.name + c.formats + c.component + c.description + c.category + c.status).toLowerCase().includes(w)))
      list.append(h('table', { class: 'grid' }, h('thead', null, h('tr', null, ...['Capacité', 'Formats', 'Composant et licence', 'Où', 'État'].map((c) => h('th', null, c)))), h('tbody', null, ...rows.map((c) => h('tr', null, h('td', null, h('b', null, c.name), h('br'), h('small', null, c.description)), h('td', null, c.formats), h('td', null, c.component, h('br'), h('small', null, c.license)), h('td', null, c.runs), h('td', null, h('span', { class: 'badge ' + (c.status === 'intégré' ? 'ok' : 'warn') }, c.status)))))))
    }
    const search = h('input', { type: 'text', placeholder: 'Rechercher une capacité', oninput: () => draw(search.value) })
    modal('Extensions et capacités', h('div', { class: 'content' }, field('Recherche', search), list), { wide: true })
    draw('')
  }

  // --- Démarrage ---------------------------------------------------------------------------------------------
  // Accès de diagnostic (console du navigateur, tests automatiques).
  ;(window as unknown as { appstock: unknown }).appstock = { project, editor: ed, view }
  document.documentElement.dataset.canvas = 'dark'
  if (window.innerWidth < 900) {
    left.classList.add('hidden')
    right.classList.add('hidden')
  }
  buildMenus()
  buildRibbon()
  renderLeft()
  renderRight()
  renderCmd()
  updateStatus()
  refreshUser()
  ed.message('Prêt. Tapez une commande (L, PL, POL, C, COT, D…) ou cliquez un outil. F1 : manuel.')

  void authGate(root).then((s) => {
    session = s
    refreshUser()
    buildMenus()
    if (!s.guest) ed.message(`Connecté : ${s.email}${s.role === 'admin' ? ' (administrateur)' : ''}`)
    void findAutosave().then((found) => {
      if (!found || project.items.length) return
      const date = new Date(found.savedAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })
      const box = hint.firstElementChild as HTMLElement
      box.prepend(h('div', { class: 'note ok', style: 'margin-bottom:14px;text-align:left' }, h('b', null, 'Travail en cours retrouvé'), h('br'), `Enregistré le ${date} : ${found.files.slice(0, 3).join(', ')}${found.files.length > 3 ? '…' : ''}`, h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => {
        try {
          openSnapshot(host, found.bytes)
          toast('Travail repris là où vous l’aviez laissé.', 'ok')
        } catch (err) {
          toast(String((err as Error).message ?? err), 'erreur')
        }
      } }, 'Reprendre mon travail'))))
    })
  })
  setTimeout(ping, 4000)
}
