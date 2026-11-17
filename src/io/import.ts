/**
 * Import universel et registre des capacités.
 *
 * Chaque format passe par une capacité déclarée dans le registre : c'est la même
 * liste qui pilote l'ouverture des fichiers et qui est présentée dans l'écran
 * « Extensions ». Ajouter un format, c'est ajouter une entrée ici.
 */
import type { Dataset } from '../core/types'
import { dwgToDxf, dwgVersion } from './dwg'
import { DWG_VERSIONS, parseDxf } from './dxf-reader'
import { parseGeoJSON, parseGpx, parseKml, parseKmz, parseShapeZip, parseShapefile } from './gis'

export interface Capability {
  id: string
  name: string
  category: 'Lecture' | 'Écriture' | 'Calcul' | 'Affichage' | 'Automatisation' | 'Acquisition'
  formats: string
  /** Composant utilisé et sa licence. */
  component: string
  license: string
  /** intégré : disponible ; prévu : identifié, pas encore branché. */
  status: 'intégré' | 'prévu'
  runs: 'navigateur' | 'worker isolé' | 'serveur (optionnel)'
  description: string
}

export const CAPABILITIES: Capability[] = [
  { id: 'dwg', name: 'Lecture DWG', category: 'Lecture', formats: '.dwg (R14 à 2018)', component: 'LibreDWG compilé en WebAssembly', license: 'GPL-3.0 (composant séparé)', status: 'intégré', runs: 'worker isolé', description: 'Conversion DWG → DXF dans un worker indépendant, puis lecture par le lecteur DXF du projet.' },
  { id: 'dxf', name: 'Lecture DXF', category: 'Lecture', formats: '.dxf (ASCII)', component: 'Lecteur DXF du projet', license: 'code du projet', status: 'intégré', runs: 'navigateur', description: 'Calques, blocs et attributs, polylignes à arcs, splines, hachures, textes, cotes.' },
  { id: 'points', name: 'Fichiers de points', category: 'Lecture', formats: '.txt .csv .xyz .asc .pts', component: 'Analyseur du projet', license: 'code du projet', status: 'intégré', runs: 'navigateur', description: 'Reconnaissance du séparateur et de l’ordre des colonnes, contrôle qualité.' },
  { id: 'geojson', name: 'GeoJSON', category: 'Lecture', formats: '.geojson .json', component: 'natif', license: 'code du projet', status: 'intégré', runs: 'navigateur', description: 'Géométries et table attributaire.' },
  { id: 'shp', name: 'Shapefile', category: 'Lecture', formats: '.shp + .dbf + .prj, ou .zip', component: 'shpjs', license: 'MIT', status: 'intégré', runs: 'navigateur', description: 'Lu sans reprojection ; système repris du fichier .prj.' },
  { id: 'kml', name: 'KML / KMZ / GPX', category: 'Lecture', formats: '.kml .kmz .gpx', component: '@tmcw/togeojson', license: 'BSD-2-Clause', status: 'intégré', runs: 'navigateur', description: 'Google Earth et traces GPS.' },
  { id: 'crs', name: 'Systèmes de coordonnées', category: 'Calcul', formats: 'UTM, Lambert, CC, systèmes nationaux', component: 'proj4js', license: 'MIT', status: 'intégré', runs: 'navigateur', description: 'Reprojection à la volée et détection automatique du système d’un fichier.' },
  { id: 'mnt', name: 'MNT et courbes de niveau', category: 'Calcul', formats: 'points cotés', component: 'delaunator + code du projet', license: 'ISC', status: 'intégré', runs: 'navigateur', description: 'Triangulation de Delaunay, courbes maîtresses et intermédiaires.' },
  { id: 'plan', name: 'Génération de plan', category: 'Calcul', formats: 'points + codes terrain', component: 'code du projet', license: 'code du projet', status: 'intégré', runs: 'navigateur', description: 'Symboles, lignes par codes, parcelle bornée, côtés, superficie, tableau de coordonnées.' },
  { id: 'pdf', name: 'Impression PDF à l’échelle', category: 'Écriture', formats: 'A4 à A0', component: 'jsPDF', license: 'MIT', status: 'intégré', runs: 'navigateur', description: 'PDF vectoriel, mise en page avec cartouche, croisillons, légende.' },
  { id: 'dxf-out', name: 'Export DXF', category: 'Écriture', formats: '.dxf (AutoCAD 2007+)', component: '@tarikjabiri/dxf', license: 'MIT', status: 'intégré', runs: 'navigateur', description: 'Calques, blocs, attributs et altitudes conservés.' },
  { id: 'gis-out', name: 'Export SIG', category: 'Écriture', formats: '.geojson .kml .csv', component: 'code du projet', license: 'code du projet', status: 'intégré', runs: 'navigateur', description: 'Reprojection en WGS 84, attributs conservés.' },
  { id: 'gdal', name: 'Formats SIG étendus', category: 'Lecture', formats: 'GeoPackage, MapInfo TAB/MIF, GML, DGN v7, FlatGeobuf', component: 'GDAL compilé en WebAssembly (gdal3.js)', license: 'MIT / LGPL', status: 'prévu', runs: 'worker isolé', description: 'Convertisseur de secours chargé à la demande.' },
  { id: 'dwg-out', name: 'Export DWG', category: 'Écriture', formats: '.dwg', component: 'ACadSharp (MIT) ou ODA Drawings SDK', license: 'MIT ou commerciale', status: 'prévu', runs: 'serveur (optionnel)', description: 'Aucune brique fiable n’écrit le DWG dans le navigateur aujourd’hui : conversion DXF → DWG par un service.' },
  { id: 'landxml', name: 'LandXML', category: 'Lecture', formats: '.xml', component: 'à écrire', license: 'code du projet', status: 'prévu', runs: 'navigateur', description: 'Échange de surfaces et de points avec Covadis, Civil 3D, Mensura.' },
  { id: 'carnets', name: 'Carnets de terrain', category: 'Lecture', formats: 'Leica GSI, Trimble JXL, RW5, SDR', component: 'à écrire', license: 'code du projet', status: 'prévu', runs: 'navigateur', description: 'Import direct des observations des stations totales et récepteurs GNSS.' },
  { id: 'projets', name: 'Profils, cubatures, division', category: 'Calcul', formats: 'MNT des points cotés', component: 'Calculs du projet (exacts, facette par facette)', license: 'code du projet', status: 'intégré', runs: 'navigateur', description: 'Profil en long et profils en travers avec guitare, cubatures sur plateforme, division de parcelle à surface imposée, transformation 2D → 3D.' },
  { id: 'scripts', name: 'Scripts de commandes', category: 'Automatisation', formats: '.scr, .txt', component: 'Moteur de commandes du projet', license: 'code du projet', status: 'intégré', runs: 'navigateur', description: 'Enchaînement de saisies de la ligne de commande, à la manière des scripts AutoCAD et de la CAO programmable (JellyCAD).' },
  { id: 'occt', name: 'Noyau 3D (solides, STEP, IGES)', category: 'Calcul', formats: '.step .stp .iges .igs .brep', component: 'Open CASCADE Technology compilé en WebAssembly', license: 'LGPL-2.1 (module séparé, remplaçable)', status: 'prévu', runs: 'worker isolé', description: 'Volumes d’ouvrages et de bâtiments, booléens, échanges avec les logiciels de CAO mécanique et BIM ; chargé à la demande (4 à 9 Mo).' },
  { id: 'instruments', name: 'Pilotes d’instruments', category: 'Acquisition', formats: 'stations totales, GNSS (NMEA)', component: 'Web Serial / Web Bluetooth', license: 'code du projet', status: 'prévu', runs: 'navigateur', description: 'Connexion directe aux appareils, sur le modèle pilote et simulateur des cadres de pilotage de machines.' },
  { id: 'raster', name: 'Rasters et nuages de points', category: 'Affichage', formats: 'GeoTIFF/COG, LAS/LAZ/COPC', component: 'geotiff.js, copc.js', license: 'MIT', status: 'prévu', runs: 'navigateur', description: 'Orthophotos de drone et nuages de points, lus par morceaux.' },
  { id: 'ia', name: 'Instructions en langage naturel', category: 'Calcul', formats: 'texte', component: 'règles (aujourd’hui) ; modèle de langage (prévu)', license: 'code du projet', status: 'intégré', runs: 'navigateur', description: 'Échelle, format, type de plan et équidistance compris à partir d’une phrase. Le calcul reste déterministe.' },
]

export interface ImportResult {
  datasets: Dataset[]
  /** Fichiers de points : remis à l'assistant de plan plutôt qu'affichés tels quels. */
  points: { name: string; text: string }[]
  errors: string[]
}

const ext = (name: string) => (/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase()
const base = (name: string) => name.replace(/\.[^.]+$/, '')

/** Ouvre un lot de fichiers (les fichiers d'un même shapefile peuvent être déposés ensemble). */
export async function importFiles(files: File[], onProgress: (msg: string) => void = () => {}): Promise<ImportResult> {
  const result: ImportResult = { datasets: [], points: [], errors: [] }
  const siblings = new Map<string, File>()
  for (const f of files) siblings.set(f.name.toLowerCase(), f)
  for (const file of files) {
    const e = ext(file.name)
    if (['dbf', 'prj', 'cpg', 'shx', 'qpj', 'sbn', 'sbx'].includes(e)) continue
    try {
      onProgress(`Lecture de ${file.name}…`)
      switch (e) {
        case 'dwg': {
          const buffer = await file.arrayBuffer()
          const version = dwgVersion(new Uint8Array(buffer.slice(0, 6)))
          const dxf = await dwgToDxf(buffer)
          const ds = parseDxf(dxf, { name: file.name, format: 'DWG' })
          ds.meta.version = DWG_VERSIONS[version] ?? version
          result.datasets.push(ds)
          break
        }
        case 'dxf':
          result.datasets.push(parseDxf(new Uint8Array(await file.arrayBuffer()), { name: file.name }))
          break
        case 'geojson':
        case 'json':
          result.datasets.push(parseGeoJSON(await file.text(), file.name))
          break
        case 'kml':
          result.datasets.push(parseKml(await file.text(), file.name))
          break
        case 'gpx':
          result.datasets.push(parseGpx(await file.text(), file.name))
          break
        case 'kmz':
          result.datasets.push(parseKmz(new Uint8Array(await file.arrayBuffer()), file.name))
          break
        case 'zip':
          result.datasets.push(...parseShapeZip(new Uint8Array(await file.arrayBuffer()), file.name))
          break
        case 'shp': {
          const b = base(file.name).toLowerCase()
          const bytes = async (x: string) => {
            const f = siblings.get(b + '.' + x)
            return f ? new Uint8Array(await f.arrayBuffer()) : undefined
          }
          const text = async (x: string) => siblings.get(b + '.' + x)?.text()
          result.datasets.push(parseShapefile({ shp: new Uint8Array(await file.arrayBuffer()), dbf: await bytes('dbf'), prj: await text('prj'), cpg: await text('cpg') }, file.name))
          break
        }
        case 'txt':
        case 'csv':
        case 'xyz':
        case 'asc':
        case 'pts':
        case 'pnt':
        case 'dat':
          result.points.push({ name: file.name, text: await file.text() })
          break
        default:
          result.errors.push(`${file.name} : format « .${e} » non pris en charge pour l’instant (voir Extensions pour la liste et ce qui est prévu).`)
      }
    } catch (err) {
      result.errors.push(`${file.name} : ${String((err as Error).message ?? err)}`)
    }
  }
  return result
}
