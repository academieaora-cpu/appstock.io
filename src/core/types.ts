/**
 * Modèle de données unifié CAO + SIG.
 *
 * Un projet contient des jeux de données (un par fichier ouvert). Chaque jeu garde
 * ses entités dans son système de coordonnées d'origine : rien n'est dégradé à
 * l'import. La reprojection vers le système du projet se fait à l'affichage et
 * à l'export.
 *
 * Les entités CAO (arc, bloc, texte, hachure…) et les entités SIG (point, ligne,
 * polygone + attributs) cohabitent dans le même modèle : une entité CAO peut porter
 * des attributs, une entité SIG a un calque et une couleur.
 */

/** Couleur 0xRRGGBB, ou valeurs spéciales ci-dessous. */
export type Color = number
/** Couleur héritée du calque. */
export const BYLAYER = -1
/** Couleur héritée de l'insertion de bloc. */
export const BYBLOCK = -2
/** Couleur « premier plan » (blanc sur fond sombre, noir sur fond clair — ACI 7). */
export const FOREGROUND = -3

export interface Layer {
  name: string
  color: Color
  visible: boolean
  /** Épaisseur en mm (0 = fin). */
  lineweight: number
  ltype?: string
}

export type Props = Record<string, string | number | boolean | null>

interface Base {
  layer: string
  color: Color
  /** Épaisseur en mm ; -1 = du calque. */
  lw?: number
  /** Attributs (table attributaire SIG, attributs de bloc, XDATA…). */
  props?: Props
  /** Identifiant d'entité multi-parties d'origine (pour regrouper à l'export SIG). */
  fid?: number
  /** Identifiant source (handle DXF). */
  handle?: string
}

export interface EPoint extends Base {
  t: 'point'
  x: number
  y: number
  z?: number
}

export interface ELine extends Base {
  t: 'line'
  x1: number
  y1: number
  z1?: number
  x2: number
  y2: number
  z2?: number
}

/** Polyligne 2D/3D avec arcs optionnels (« bulges »). */
export interface EPolyline extends Base {
  t: 'pline'
  /** x0,y0,x1,y1,… */
  pts: Float64Array
  /** Altitude par sommet (polyligne 3D). */
  zs?: Float64Array
  /** Bulge par sommet (tangente du quart de l'angle de l'arc vers le sommet suivant). */
  bulges?: Float64Array
  closed: boolean
  /** Altitude commune (polyligne 2D élevée, courbe de niveau). */
  elev?: number
}

export interface ECircle extends Base {
  t: 'circle'
  cx: number
  cy: number
  r: number
  z?: number
}

export interface EArc extends Base {
  t: 'arc'
  cx: number
  cy: number
  r: number
  /** Angles en radians, sens trigonométrique de a0 vers a1. */
  a0: number
  a1: number
  z?: number
}

export interface EEllipse extends Base {
  t: 'ellipse'
  cx: number
  cy: number
  /** Demi-grand axe (vecteur). */
  mx: number
  my: number
  /** Rapport petit axe / grand axe. */
  ratio: number
  a0: number
  a1: number
}

export interface ESpline extends Base {
  t: 'spline'
  degree: number
  knots: Float64Array
  /** Points de contrôle x,y,… */
  ctrl: Float64Array
  weights?: Float64Array
  /** Points de passage (si pas de points de contrôle). */
  fit?: Float64Array
  closed: boolean
}

export interface EText extends Base {
  t: 'text'
  x: number
  y: number
  z?: number
  /** Hauteur en unités du dessin. */
  h: number
  /** Rotation en radians. */
  rot: number
  text: string
  /** 0 gauche, 1 centre, 2 droite. */
  ha: 0 | 1 | 2
  /** 0 ligne de base, 1 bas, 2 milieu, 3 haut. */
  va: 0 | 1 | 2 | 3
  /** Texte multiligne (MTEXT). */
  multi?: boolean
}

/** Insertion de bloc. */
export interface EInsert extends Base {
  t: 'insert'
  block: string
  x: number
  y: number
  z?: number
  sx: number
  sy: number
  rot: number
  /** Symétrie d'axe (extrusion négative). */
  mirror?: boolean
  cols?: number
  rows?: number
  dx?: number
  dy?: number
  /** Textes d'attributs attachés. */
  attribs?: EText[]
}

/** Surface : polygone SIG, hachure, solide, face 3D. */
export interface EPolygon extends Base {
  t: 'polygon'
  /** Anneaux x,y,… (le premier est extérieur, les suivants des trous). */
  rings: Float64Array[]
  /** Altitudes par anneau. */
  zs?: Float64Array[]
  /** Rempli (hachure solide, polygone SIG) ou simple contour. */
  filled: boolean
  /** Nom du motif de hachure d'origine. */
  pattern?: string
}

export type Entity =
  | EPoint
  | ELine
  | EPolyline
  | ECircle
  | EArc
  | EEllipse
  | ESpline
  | EText
  | EInsert
  | EPolygon

export interface Block {
  name: string
  bx: number
  by: number
  entities: Entity[]
}

/** Transformation affine 2D : x' = a·x + c·y + e ; y' = b·x + d·y + f. */
export type Affine = [a: number, b: number, c: number, d: number, e: number, f: number]

export type Extent = [minX: number, minY: number, maxX: number, maxY: number]

export interface Dataset {
  id: string
  name: string
  /** Format d'origine : DWG, DXF, GeoJSON, Shapefile… */
  format: string
  kind: 'cad' | 'gis'
  /** Code du système de coordonnées (« EPSG:2154 »), ou null si inconnu / local. */
  crs: string | null
  /** D'où vient le CRS : fichier, détection, choix de l'utilisateur. */
  crsSource: 'file' | 'detected' | 'user' | 'none'
  /**
   * Calage appliqué avant projection (unités, translation, rotation) :
   * sert aux plans en coordonnées locales ou en millimètres.
   */
  xform: Affine | null
  layers: Map<string, Layer>
  blocks: Map<string, Block>
  entities: Entity[]
  /** Noms des champs attributaires (SIG). */
  fields: string[]
  visible: boolean
  /** Informations lues dans le fichier (version, unités, compteurs…). */
  meta: Record<string, string | number>
  /** Types d'entités non interprétés, avec leur nombre : rien n'est caché à l'utilisateur. */
  unsupported: Record<string, number>
}

let nextId = 1
export function newDataset(name: string, format: string, kind: 'cad' | 'gis'): Dataset {
  return {
    id: 'ds' + nextId++,
    name,
    format,
    kind,
    crs: null,
    crsSource: 'none',
    xform: null,
    layers: new Map(),
    blocks: new Map(),
    entities: [],
    fields: [],
    visible: true,
    meta: {},
    unsupported: {},
  }
}

export function ensureLayer(ds: Dataset, name: string, color: Color = FOREGROUND): Layer {
  let layer = ds.layers.get(name)
  if (!layer) {
    layer = { name, color, visible: true, lineweight: 0 }
    ds.layers.set(name, layer)
  }
  return layer
}
