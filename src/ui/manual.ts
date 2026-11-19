/**
 * Manuel intégré, ancré dans le panneau de droite. Les fiches des commandes sont générées
 * à partir du registre : où trouver la commande, ce qu'elle fait, les étapes, et un
 * bouton pour la lancer directement.
 */
import type { CommandDef, Editor } from '../edit/editor'
import { h } from './dom'

export const MENU_ORDER = ['Fichier', 'Édition', 'Affichage', 'Dessin', 'Cotation', 'Modification', 'Topo Calculs', 'Topo 2D', 'Topo 3D', 'Projets', 'Édition plan', 'Outils', 'Aide']

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
      'Topo 2D › Charger un semis de points ouvre l’assistant : il lit un fichier TXT, CSV ou XYZ, reconnaît les colonnes, puis vous fait valider chaque étape avant de dessiner.',
      ['Les étapes à valider', ['Nettoyage : chaque point suspect (doublon, coordonnée nulle, point isolé très loin, altitude 0 ou aberrante) est listé avec une action proposée — garder, exclure, ou garder sans altitude. Vous décidez, puis « Valider le nettoyage ». Le fichier source n’est jamais modifié.', 'Codes : chaque code du fichier est attribué à un objet (borne, bâtiment, clôture, route, arbre…), à « point simple » ou à « ne pas dessiner ». Rien n’est dessiné avant « Valider l’attribution des codes ».', 'Parcelle : les bornes sont reliées dans un ordre que vous choisissez. Un contour qui se croise est refusé (sa superficie serait fausse). Proposition par défaut : contour sans croisement, B.1 la borne la plus au nord puis sens horaire ; vos propres numéros B.x sont respectés s’ils donnent un contour valide ; ordre saisi à la main possible.', 'Les coordonnées sont reprises telles quelles, avec le nombre de décimales du fichier (tableau des coordonnées compris).']],
      ['Mots-clés compris dans la phrase de l’assistant', ['« 1/500 », « 1/1000 »… : échelle ;', '« A4 », « A3 »… et « paysage » ou « portrait » : format ;', '« courbes tous les 0,50 m » ou « altimétrique » : courbes de niveau ;', '« parcellaire » ou « bornage » : parcelle, côtés, superficie, tableau ;', '« sans numéros », « sans altitudes », « descriptions », « triangulation », « tableau », « légende ».']],
      'Exemple : « plan topographique et altimétrique au 1/500, format A3 paysage, courbes tous les 0,50 m, avec le tableau des coordonnées ».',
      'L’assistant affiche ce qu’il a compris avant de dessiner. Les calculs (surfaces, triangulation, courbes) sont faits par des algorithmes vérifiables, jamais devinés.',
    ],
  },
  {
    id: 'plan',
    title: 'Préparer, caler et imprimer le plan',
    body: [
      ['Nouveau plan (Édition plan › Nouveau plan)', ['choisissez le type : croquis de terrain, plan de bornage, de morcellement, d’état des lieux, topographique, altimétrique, d’implantation, de situation ;', 'choisissez le format (A4 à A0), l’orientation et l’échelle ;', 'renseignez date, demandeur, propriétaire, T.F., lieu, géomètre : le titre est rédigé automatiquement selon le modèle ;', 'Région, Département, Arrondissement : listes déroulantes liées (choisir l’arrondissement remplit les deux autres) ; « Autre » permet une saisie libre ;', '« Remplir avec un exemple » donne un plan de bornage type à modifier.']],
      ['Tableau des coordonnées', ['sélectionnez dans le dessin la parcelle, ou les bornes et points un à un, puis ouvrez Nouveau plan ou Mise en page : le tableau est rempli avec cette sélection (matricules des points topo, numéros de bornes écrits à côté des sommets) ;', 'sans sélection, ce sont les sommets de la plus grande parcelle fermée ;', 'la commande TC dessine aussi ce tableau dans le dessin à partir de la sélection.']],
      ['Mise en page cadastrale (modèle Cameroun)', ['bandeau du haut : titre à gauche, longue flèche du nord au milieu, plan de situation sur la moitié droite avec sa légende et l’étiquette « Emplacement » reliée au terrain ;', 'superficie et tableau des coordonnées (MAT, X, Y) placés comme sur le modèle, déplacés automatiquement s’ils cacheraient la parcelle ;', 'cases à cocher au-dessus de l’aperçu : Nord, Plan de situation, Emplacement, Superficie, Tableau, Légende, Croisillons, Cadre extérieur, Noir et blanc.']],
      ['Plan de situation', ['encart généré automatiquement autour du terrain, contour en rouge, à l’échelle choisie (1/10 000 par défaut) ;', 'fond OpenStreetMap sans clé ; fond Google Maps avec une clé API Google (API « Maps Static ») ;', 'il faut que le système de coordonnées du projet soit connu et que l’appareil soit connecté.']],
      ['Caler le cadre', ['après validation, la feuille apparaît en pointillés dans le dessin (cadre orange = zone imprimée) ;', 'commande CADRE : cliquez le nouveau centre pour déplacer le cadre sur la partie à imprimer.']],
      ['Imprimer', ['Édition plan › Mise en page et PDF : aperçu en direct, tous les renseignements modifiables ;', 'le PDF est vectoriel et à l’échelle exacte : imprimez à 100 %, sans « ajuster à la page » ;', 'plusieurs formats d’un coup (A4 et A3 par exemple).']],
    ],
  },
  {
    id: 'modifier',
    title: 'Retoucher un dessin : ajuster, prolonger, raccorder',
    body: [
      ['Ajuster (AJ)', ['Entrée tout de suite : tous les objets visibles servent d’arêtes de coupe ; ou désignez d’abord les arêtes puis Entrée ;', 'cliquez chaque morceau à supprimer : il disparaît jusqu’aux intersections qui l’encadrent ;', 'fonctionne sur lignes, polylignes (y compris leurs arcs), arcs et cercles ; un cercle coupé devient un arc.']],
      ['Prolonger (PRO)', ['même principe : cliquez près de l’extrémité à allonger, elle rejoint la première limite rencontrée.']],
      ['Raccord (RA)', ['rayon 0 : les deux lignes sont coupées ou prolongées jusqu’à leur intersection (angle vif, pratique pour fermer un angle de bâtiment) ;', 'rayon positif : un arc tangent remplace l’angle (bordure de trottoir, virage) ;', 'option P : arrondit tous les angles d’une polyligne.']],
    ],
  },
  {
    id: 'projets-terrain',
    title: 'Projets : profils, cubatures, division de parcelle',
    body: [
      'Ces outils travaillent sur le modèle de terrain (MNT) construit à partir des points cotés visibles : points topographiques avec altitude, polylignes 3D. Rien n’est calculé hors de la zone couverte par les points : les parties hors MNT sont signalées, jamais inventées.',
      ['Profil en long (PFL)', ['dessinez l’axe (polyligne) dans le sens de parcours, puis lancez la commande ;', 'pas 0 : la guitare montre les sommets de l’axe et chaque cassure du terrain ; pas 10 : un point tous les 10 m en plus des sommets ;', 'exagération verticale 10 : échelle des hauteurs dix fois celle des longueurs (V 1/50 pour un plan au 1/500).']],
      ['Profils en travers (PFT)', ['l’axe est tabulé au pas demandé et à chaque sommet ;', 'chaque profil est vu dans le sens de l’axe, gauche à gauche, avec son trait repéré P1, P2… sur le plan.']],
      ['Cubatures (CUB)', ['tapez l’altitude de la plateforme, puis T (tout le MNT) ou O (un contour fermé) ;', 'déblai = terrain au-dessus de la plateforme, remblai = au-dessous ; calcul exact facette par facette.']],
      ['Division de parcelle (DIV)', ['surface exacte à détacher, par une ligne parallèle à une direction (P) ou pivotant autour d’une borne (O) ;', 'la parcelle d’origine est conservée ; les deux nouvelles parcelles et leurs surfaces sont dessinées sur DIVISION et SURFACES.']],
      ['Autres outils', ['Talus (TAL) : hachures entre la crête et le pied ;', 'Carroyage (CAR) : quadrillage de coordonnées dans le dessin ;', 'Implantation (IMP) : gisements, distances et lectures depuis une station, tableau et carnet CSV ;', 'Transformation 2D → 3D (2D3D) : met des polylignes à l’altitude du terrain.']],
    ],
  },
  {
    id: 'precision',
    title: 'Précision du MNT et des courbes de niveau',
    body: [
      'Le modèle de terrain est une triangulation de Delaunay aux calculs exacts, contrainte par les lignes de rupture, avec interpolation linéaire sur chaque triangle : la méthode des MNT de Covadis et de Civil 3D. Les courbes sont l’intersection exacte des triangles et des plans horizontaux.',
      ['Pour des courbes justes', ['levez les ruptures en 3D (sommet et pied de talus, bords de route, fossés, caniveaux) et cochez « Rupture » pour leurs codes : aucun triangle ne les traverse ;', 'décochez « MNT » pour les codes de points qui ne sont pas au sol ;', 'laissez « Lisser les courbes » décoché pour un tracé strictement exact ; coché, la courbe passe par les sommets exacts et l’écart entre eux est indiqué.']],
      ['Contrôle automatique', ['après chaque calcul, le rapport donne le nombre de sommets vérifiés, l’écart maximal au MNT (de l’ordre de 10⁻¹¹ m, la limite du calcul) et le nombre de croisements (toujours 0) ;', 'les conflits sont signalés : deux altitudes au même endroit, ruptures qui se croisent ou passent sur un point.']],
      ['Habillage des courbes', ['emprise : toute l’enveloppe des points (comme Covadis), ou sans les grands triangles de bordure ;', 'couleurs en dégradé selon la cote (vert en bas, brun en haut) ou maîtresses rouges / intermédiaires orange ;', 'cotes posées le long des courbes, trait interrompu sous chaque cote ; option pour coter aussi les intermédiaires ;', 'option : interrompre les courbes sur les faces de murs (pente de plus de 300 %).']],
      ['Positionnement', ['Outils › Système de coordonnées : réglez votre pays de travail (Cameroun par défaut) ;', 'chaque système proposé indique la ville la plus proche où tomberaient vos points : vérifiez avant de valider ;', 'les anciens systèmes camerounais (Manoca 1962, Douala 1948) sont disponibles ; leur passage au WGS 84 est de précision métrique.']],
      'Entre deux points levés, aucun logiciel ne connaît le terrain : la justesse du plan dépend de la densité des points et des ruptures levées.',
    ],
  },
  {
    id: 'scripts',
    title: 'Automatiser avec un script',
    body: [
      'Outils › Exécuter un script enchaîne des saisies écrites à l’avance, une par ligne, exactement comme au clavier (le principe des fichiers .scr d’AutoCAD et des logiciels de CAO programmable).',
      ['Écrire un script', ['une ligne = une saisie : nom ou raccourci de commande, coordonnées (783640,427200 · @20,0 · @25<150g), valeur ou option ;', 'ligne vide = Entrée (termine une polyligne, valide une valeur par défaut) ;', 'à « Choix des objets », T = tous les objets, D = le dernier objet dessiné ;', 'une ligne qui commence par « ; » est un commentaire.']],
      'Chaque objet créé peut ensuite être annulé avec Ctrl+Z. Un script préparé ailleurs (tableur, collègue) doit être relu avant d’être exécuté : le géomètre reste responsable du plan.',
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
