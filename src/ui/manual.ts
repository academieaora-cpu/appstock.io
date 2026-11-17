/**
 * Manuel intégré, ancré dans le panneau de droite. Les fiches des commandes sont générées
 * à partir du registre : où trouver la commande, ce qu'elle fait, les étapes, et un
 * bouton pour la lancer directement.
 */
import type { CommandDef, Editor } from '../edit/editor'
import { h } from './dom'

export const MENU_ORDER = ['Fichier', 'Édition', 'Affichage', 'Dessin', 'Cotation', 'Modification', 'Topo Calculs', 'Topo 2D', 'Topo 3D', 'Édition plan', 'Outils', 'Aide']

interface Guide {
  id: string
  title: string
  body: (string | [string, string[]])[]
}

const GUIDES: Guide[] = [
  {
    id: 'demarrer',
    title: 'Bien démarrer',
    body: [
      'La fenêtre est organisée comme AutoCAD et Covadis : la barre de menus en haut, le ruban d’outils en dessous, la zone de dessin au centre, la ligne de commande et la barre d’état en bas.',
      ['Trois façons de lancer une commande', ['cliquer son bouton dans le ruban ;', 'la choisir dans la barre de menus ;', 'taper son nom ou son raccourci (L pour Ligne, PL pour Polyligne…) puis Entrée : il suffit de commencer à taper n’importe où.']],
      ['Pendant une commande', ['lisez la ligne de commande : elle dit ce qui est attendu (un point, une valeur, une option) ;', 'les options entre crochets se choisissent en tapant leur lettre majuscule (C pour Clore, U pour annUler) ;', 'Entrée, Espace ou clic droit valident ou terminent ; Échap annule.']],
      ['Pour commencer un plan', ['ouvrez un fichier (DWG, DXF, SHP…) ou dessinez directement ;', 'répondez à l’assistant « Nouveau plan » : type de document, format, échelle, renseignements ;', 'dessinez et habillez, puis Édition plan › Mise en page et PDF.']],
    ],
  },
  {
    id: 'navigation',
    title: 'Se déplacer et sélectionner',
    body: [
      ['Navigation', ['molette : zoom avant ou arrière autour du curseur ;', 'clic molette maintenu, ou Espace + glisser : déplacer la vue ;', 'sur écran tactile : un doigt pour déplacer, deux doigts pour zoomer ;', 'ZE (zoom étendu) ou bouton « Tout voir » : cadrer tout le dessin.']],
      ['Sélection', ['clic sur un objet : il s’ajoute à la sélection ; Maj + clic : il en est retiré ;', 'glisser de gauche à droite (cadre bleu) : sélectionne les objets entièrement à l’intérieur ;', 'glisser de droite à gauche (cadre vert pointillé) : sélectionne tout ce que le cadre touche ;', 'Échap : vide la sélection ; Ctrl+A : tout sélectionner ; Suppr : effacer.']],
      ['Poignées', ['un objet sélectionné montre des carrés bleus (ses sommets) ;', 'cliquez une poignée, déplacez, cliquez à nouveau : le sommet est déplacé (accrochage actif) ;', 'pour un texte, un bloc ou un cercle, la poignée déplace l’objet entier.']],
    ],
  },
  {
    id: 'saisie',
    title: 'Saisir des points : accrochages et coordonnées',
    body: [
      ['Accrochage aux objets (F3)', ['activé, le curseur se colle aux points remarquables : extrémité (carré), milieu (triangle), centre (cercle), intersection (croix), perpendiculaire, nœud et point d’insertion ;', 'le nom du point accroché s’affiche à côté du curseur.']],
      ['Mode ortho (F8)', ['contraint le tracé à l’horizontale ou à la verticale du point précédent.']],
      ['Coordonnées au clavier', ['783640.50,427210.25 : point absolu (X,Y) ;', '@12,-3.5 : relatif au point précédent (ΔX, ΔY) ;', '@25<45 : polaire, 25 m à 45° (sens trigonométrique depuis l’est) ;', '@25<150g : polaire en gisement, 25 m au gisement 150 grades (depuis le nord, sens horaire) ;', '12.5 seul : 12,5 m dans la direction du curseur depuis le point précédent.']],
    ],
  },
  {
    id: 'assistant',
    title: 'Produire un plan automatiquement',
    body: [
      'Topo 2D › Charger un semis de points ouvre l’assistant : il lit un fichier TXT, CSV ou XYZ, reconnaît les colonnes, contrôle les données, interprète les codes terrain et dessine le plan.',
      ['Mots-clés compris dans la phrase de l’assistant', ['« 1/500 », « 1/1000 »… : échelle ;', '« A4 », « A3 »… et « paysage » ou « portrait » : format ;', '« courbes tous les 0,50 m » ou « altimétrique » : courbes de niveau ;', '« parcellaire » ou « bornage » : parcelle, côtés, superficie, tableau ;', '« sans numéros », « sans altitudes », « descriptions », « triangulation », « tableau », « légende ».']],
      'Exemple : « plan topographique et altimétrique au 1/500, format A3 paysage, courbes tous les 0,50 m, avec le tableau des coordonnées ».',
      'L’assistant affiche ce qu’il a compris avant de dessiner. Les calculs (surfaces, triangulation, courbes) sont faits par des algorithmes vérifiables, jamais devinés.',
    ],
  },
  {
    id: 'plan',
    title: 'Préparer, caler et imprimer le plan',
    body: [
      ['Nouveau plan (Édition plan › Nouveau plan)', ['choisissez le type : croquis de terrain, plan de bornage, de morcellement, d’état des lieux, topographique, altimétrique, d’implantation, de situation ;', 'choisissez le format (A4 à A0), l’orientation et l’échelle ;', 'renseignez date, demandeur, propriétaire, T.F., lieu, géomètre : le titre est rédigé automatiquement selon le modèle.']],
      ['Caler le cadre', ['après validation, la feuille apparaît en pointillés dans le dessin (cadre orange = zone imprimée) ;', 'commande CADRE : cliquez le nouveau centre pour déplacer le cadre sur la partie à imprimer.']],
      ['Imprimer', ['Édition plan › Mise en page et PDF : aperçu en direct, tous les renseignements modifiables ;', 'le PDF est vectoriel et à l’échelle exacte : imprimez à 100 %, sans « ajuster à la page » ;', 'plusieurs formats d’un coup (A4 et A3 par exemple).']],
    ],
  },
  {
    id: 'calques',
    title: 'Calques et fichier actif',
    body: [
      'Le panneau de gauche liste les fichiers ouverts et les calques du fichier actif.',
      ['Fichier actif', ['les nouveaux objets vont dans le fichier actif (étoile) ; cliquez « Rendre actif » sur un autre fichier pour y dessiner ;', 'un fichier dans un autre système de coordonnées que le projet s’affiche, mais ne se modifie pas : les objets dessinés vont alors dans « Dessin ».']],
      ['Calques', ['le calque courant (liste du ruban) reçoit les objets dessinés avec Ligne, Polyligne, Cercle… ;', 'les outils topographiques utilisent leurs propres calques (TOPOJIS, COTATIONS, SOMMETS, COURBES…), comme Covadis ;', 'cases à cocher : afficher ou masquer ; « + Calque » : créer un calque.']],
    ],
  },
  {
    id: 'projets',
    title: 'Projets, compte et sauvegarde',
    body: [
      ['Votre travail est protégé', ['enregistrement automatique sur l’appareil à chaque modification : à la réouverture, « Reprendre mon travail » ;', 'Fichier › Projets : enregistrer sous un nom, télécharger un fichier .geoprojet, ou enregistrer en ligne dans votre compte pour le retrouver sur un autre appareil.']],
      ['Compte', ['créez un compte avec votre adresse électronique depuis l’écran d’accueil ;', 'Mon compte (en haut à droite) : profil, mot de passe, code administrateur ;', 'les administrateurs voient la liste des comptes, leur activité et leurs projets.']],
    ],
  },
  {
    id: 'raccourcis',
    title: 'Raccourcis clavier',
    body: [
      ['Touches', ['Entrée, Espace ou clic droit : valider, terminer, ou répéter la dernière commande ;', 'Échap : annuler la commande ou vider la sélection ;', 'Ctrl+Z / Ctrl+Y : annuler / rétablir ;', 'Suppr : effacer la sélection ; Ctrl+A : tout sélectionner ;', 'F1 : ce manuel ; F3 : accrochage ; F8 : ortho ;', 'tapez directement un nom de commande, n’importe où, pour la lancer.']],
    ],
  },
  {
    id: 'formats',
    title: 'Formats pris en charge',
    body: [
      ['Ouverture', ['DWG (AutoCAD R14 à 2018), DXF ;', 'Shapefile (.shp + .dbf + .prj, ou .zip), GeoJSON, KML, KMZ, GPX ;', 'fichiers de points TXT, CSV, XYZ, ASC.']],
      ['Enregistrement', ['DXF (calques, blocs, attributs, points TCPOINT compatibles Covadis) ; GeoJSON, KML, CSV ; PDF à l’échelle ; projet .geoprojet.', 'Le DWG n’est pas encore écrit : ouvrez le DXF dans AutoCAD ou Covadis et enregistrez-le en DWG.']],
    ],
  },
]

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

function where(c: CommandDef): string {
  const parts = [`Menu ${c.menu} › ${c.label}`]
  if (c.ribbon) parts.push(`ruban ${c.ribbon[0]} › ${c.ribbon[1]}`)
  return parts.join(' · ')
}

/** Construit le manuel dans `host`. `focus` : identifiant de section ou de commande à afficher. */
export function renderManual(host: HTMLElement, ed: Editor, focus?: string): void {
  const search = h('input', { type: 'search', placeholder: 'Rechercher : polygone, cote, gisement, imprimer…' })
  const list = h('div', { class: 'manual-list' })
  const commandsByMenu = new Map<string, CommandDef[]>()
  for (const c of ed.commands.values()) {
    const a = commandsByMenu.get(c.menu)
    if (a) a.push(c)
    else commandsByMenu.set(c.menu, [c])
  }
  const blocks: { el: HTMLElement; text: string; id: string }[] = []
  for (const g of GUIDES) {
    const el = h('details', { class: 'manual-guide', open: focus === g.id || (!focus && g.id === 'demarrer') }, h('summary', null, g.title))
    let text = g.title
    for (const b of g.body) {
      if (typeof b === 'string') {
        el.append(h('p', null, b))
        text += ' ' + b
      } else {
        el.append(h('p', null, h('b', null, b[0])), h('ul', null, ...b[1].map((li) => h('li', null, li))))
        text += ' ' + b[0] + ' ' + b[1].join(' ')
      }
    }
    blocks.push({ el, text: norm(text), id: g.id })
  }
  for (const menu of MENU_ORDER) {
    const cmds = commandsByMenu.get(menu)
    if (!cmds?.length) continue
    const head = h('h3', null, 'Menu ' + menu)
    blocks.push({ el: head, text: '', id: 'menu:' + menu })
    for (const c of cmds) {
      const el = h(
        'details',
        { class: 'manual-cmd', open: focus === c.id },
        h('summary', null, c.label, ' ', ...c.aliases.slice(0, 2).map((a) => h('kbd', null, a))),
        h('p', null, c.tip),
        h('p', { class: 'muted' }, 'Où : ', where(c), ' · ou tapez ', h('kbd', null, c.aliases[0] ?? c.id)),
        h('ol', null, ...c.steps.map((s) => h('li', null, s))),
        h('button', { onclick: () => void ed.run(c.id) }, 'Lancer « ' + c.label + ' »'),
      )
      blocks.push({ el, text: norm([c.label, c.id, ...c.aliases, c.tip, c.menu, ...c.steps].join(' ')), id: c.id })
    }
  }
  const filter = () => {
    const q = norm(search.value.trim())
    for (const b of blocks) {
      if (b.id.startsWith('menu:')) continue
      const show = !q || q.split(/\s+/).every((w) => b.text.includes(w))
      b.el.hidden = !show
      if (q && show && b.el instanceof HTMLDetailsElement && b.el.classList.contains('manual-cmd')) b.el.open = true
    }
    for (const b of blocks) {
      if (!b.id.startsWith('menu:')) continue
      let next = b.el.nextElementSibling
      let any = false
      while (next && next.tagName !== 'H3') {
        if (!(next as HTMLElement).hidden) any = true
        next = next.nextElementSibling
      }
      b.el.hidden = !any
    }
  }
  search.addEventListener('input', filter)
  for (const b of blocks) list.append(b.el)
  host.replaceChildren(h('div', { class: 'manual' }, search, list))
  if (focus) {
    const target = blocks.find((b) => b.id === focus)
    if (target) setTimeout(() => target.el.scrollIntoView({ block: 'start' }), 30)
  }
}
