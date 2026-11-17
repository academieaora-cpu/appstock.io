import { describe, expect, it } from 'vitest'
import { Project } from '../src/core/project'
import { ringArea } from '../src/core/geom'
import { GEOMETRY_COMMANDS, dimension } from '../src/edit/commands'
import { Editor, parsePointInput } from '../src/edit/editor'
import { explode, gisement, mirrorAbout, offsetPolyline, pointRayonne, rotationAbout, transformEntity } from '../src/edit/ops'
import { findSnap, ALL_SNAPS } from '../src/edit/query'
import type { Entity } from '../src/core/types'

const tick = () => new Promise((r) => setTimeout(r, 0))

function setup() {
  const project = new Project()
  project.crs = 'EPSG:32632'
  const ed = new Editor(project)
  ed.pickTol = () => 0.5
  ed.register(GEOMETRY_COMMANDS)
  ed.snapOn = false
  return { project, ed }
}

async function click(ed: Editor, x: number, y: number) {
  await tick()
  ed.onMove([x, y])
  ed.onClick([x, y], false)
  await tick()
}

async function type(ed: Editor, text: string) {
  await tick()
  ed.onText(text)
  await tick()
}

describe('saisie au clavier', () => {
  it('comprend les coordonnées absolues, relatives, polaires et en gisement', () => {
    expect(parsePointInput('783640.5,427210.25', null, null)).toEqual([783640.5, 427210.25])
    expect(parsePointInput('@10,-5', [100, 200], null)).toEqual([110, 195])
    const p = parsePointInput('@10<90', [0, 0], null) as number[]
    expect(p[0]).toBeCloseTo(0, 9)
    expect(p[1]).toBeCloseTo(10, 9)
    // Gisement 100 gr = plein est
    const g = parsePointInput('@10<100g', [0, 0], null) as number[]
    expect(g[0]).toBeCloseTo(10, 9)
    expect(g[1]).toBeCloseTo(0, 9)
    // Distance directe vers le curseur
    expect(parsePointInput('5', [0, 0], [0, 100])).toEqual([0, 5])
    expect(parsePointInput('abc', null, null)).toBeUndefined()
  })
})

describe('commandes de dessin', () => {
  it('LIGNE trace des segments et C ferme sur le premier point', async () => {
    const { project, ed } = setup()
    const run = ed.run('L')
    await click(ed, 0, 0)
    await type(ed, '@10,0')
    await type(ed, '@0,10')
    await type(ed, 'C')
    await run
    const ds = project.items[0].ds
    expect(ds.name).toBe('Dessin')
    expect(ds.crs).toBe('EPSG:32632')
    expect(ds.entities.map((e) => (e.t === 'line' ? [e.x1, e.y1, e.x2, e.y2] : null))).toEqual([
      [0, 0, 10, 0],
      [10, 0, 10, 10],
      [10, 10, 0, 0],
    ])
  })

  it('POLYGONE ferme la surface et calcule la superficie', async () => {
    const { project, ed } = setup()
    const run = ed.run('POLYGONE')
    await click(ed, 0, 0)
    await click(ed, 20, 0)
    await click(ed, 20, 10)
    await click(ed, 0, 10)
    await type(ed, '')
    await run
    const e = project.items[0].ds.entities[0]
    expect(e.t === 'pline' && e.closed).toBe(true)
    expect(Math.abs(ringArea(e.t === 'pline' ? e.pts : []))).toBe(200)
    expect(ed.log.join('\n')).toContain('Surface = 200.00 m²')
  })

  it('CERCLE accepte un rayon tapé, ÉCHAP annule sans rien créer', async () => {
    const { project, ed } = setup()
    let run = ed.run('C')
    await click(ed, 5, 5)
    await type(ed, '2.5')
    await run
    expect(project.items[0].ds.entities[0]).toMatchObject({ t: 'circle', cx: 5, cy: 5, r: 2.5 })
    run = ed.run('CERCLE')
    await click(ed, 1, 1)
    await tick()
    ed.onEscape()
    await run
    expect(project.items[0].ds.entities).toHaveLength(1)
    expect(ed.log.at(-1)).toBe('*Annulé*')
  })

  it('DEPLACER puis ANNULER et RÉTABLIR', async () => {
    const { project, ed } = setup()
    let run = ed.run('L')
    await click(ed, 0, 0)
    await click(ed, 10, 0)
    await type(ed, '')
    await run
    const item = project.items[0]
    ed.setSelection([{ item, entity: 0 }])
    run = ed.run('D')
    await click(ed, 0, 0)
    await type(ed, '@5,5')
    await run
    expect(item.ds.entities[0]).toMatchObject({ x1: 5, y1: 5, x2: 15, y2: 5 })
    ed.history.undo()
    expect(item.ds.entities[0]).toMatchObject({ x1: 0, y1: 0, x2: 10, y2: 0 })
    ed.history.redo()
    expect(item.ds.entities[0]).toMatchObject({ x1: 5, y1: 5 })
  })

  it('POINT TOPO insère un bloc TCPOINT avec matricule et altitude', async () => {
    const { project, ed } = setup()
    const run = ed.run('PT')
    await click(ed, 100, 200)
    await type(ed, 'S12')
    await type(ed, '745.5')
    await type(ed, '')
    await run
    const ds = project.items[0].ds
    expect(ds.blocks.has('TCPOINT')).toBe(true)
    const e = ds.entities[0]
    expect(e).toMatchObject({ t: 'insert', block: 'TCPOINT', layer: 'TOPOJIS', x: 100, y: 200, z: 745.5, props: { MAT: 'S12', ALT: 745.5 } })
    expect(e.t === 'insert' && e.attribs!.map((a) => `${a.tag}=${a.text}@${a.layer}`)).toEqual(['MAT=S12@TopoMat', 'ALT=745.500@TopoAlt'])
  })

  it('RAYONNEMENT place un point à partir du gisement et de la distance', async () => {
    const { project, ed } = setup()
    const run = ed.run('RAY')
    await type(ed, '1000,2000')
    await type(ed, '100')
    await type(ed, '25')
    await type(ed, 'P1')
    await type(ed, '')
    await run
    const e = project.items[0].ds.entities[0]
    expect(e.t === 'insert' && e.x).toBeCloseTo(1025, 6)
    expect(e.t === 'insert' && e.y).toBeCloseTo(2000, 6)
  })
})

describe('géométrie d’édition', () => {
  it('décale un carré vers l’extérieur et l’intérieur', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10]
    // Sens trigonométrique : la gauche est l'intérieur.
    expect(offsetPolyline(sq, true, 1)).toEqual([1, 1, 9, 1, 9, 9, 1, 9])
    expect(offsetPolyline(sq, true, -1)).toEqual([-1, -1, 11, -1, 11, 11, -1, 11])
  })

  it('rotation et miroir conservent les distances et retournent les arcs', () => {
    const arc: Entity = { t: 'arc', layer: '0', color: -1, cx: 0, cy: 0, r: 5, a0: 0, a1: Math.PI / 2 }
    const r = transformEntity(arc, rotationAbout(0, 0, Math.PI / 2))
    expect(r.t === 'arc' && r.a0).toBeCloseTo(Math.PI / 2, 9)
    const m = transformEntity(arc, mirrorAbout(0, 0, 0, 1)) // symétrie par rapport à l'axe Y
    expect(m.t === 'arc' && Math.cos(m.a0)).toBeCloseTo(0, 9) // l'arc va de 90° à 180°
    expect(m.t === 'arc' && Math.cos(m.a1)).toBeCloseTo(-1, 9)
  })

  it('décompose une polyligne à arc en ligne + arc', () => {
    const e: Entity = { t: 'pline', layer: 'L', color: -1, pts: Float64Array.from([0, 0, 2, 0, 2, 5]), bulges: Float64Array.from([1, 0, 0]), closed: false }
    const parts = explode(e, new Map())!
    expect(parts.map((p) => p.t)).toEqual(['arc', 'line'])
    expect(parts[0]).toMatchObject({ cx: 1, cy: 0, r: 1 })
  })

  it('gisement et point rayonné sont réciproques', () => {
    expect(gisement(0, 0, 0, 10)).toBeCloseTo(0, 9)
    expect(gisement(0, 0, 10, 0)).toBeCloseTo(100, 9)
    expect(gisement(0, 0, -10, 0)).toBeCloseTo(300, 9)
    const p = pointRayonne(500, 500, 250, 100)
    expect(gisement(500, 500, p[0], p[1])).toBeCloseTo(250, 9)
  })

  it('cote alignée : valeur et bloc', () => {
    const d = dimension([0, 0], [30, 40], [-5, 5], 0.5)!
    expect(d.length).toBe(50)
    expect(d.block.entities.find((e) => e.t === 'text')).toMatchObject({ text: '50.00' })
  })

  it('accroche l’extrémité, le milieu et l’intersection', async () => {
    const { project, ed } = setup()
    let run = ed.run('L')
    await click(ed, 0, 0)
    await click(ed, 10, 0)
    await type(ed, '')
    await run
    run = ed.run('L')
    await click(ed, 8, -5)
    await click(ed, 8, 5)
    await type(ed, '')
    await run
    expect(findSnap(project, 9.8, 0.1, 1, null, ALL_SNAPS)).toMatchObject({ x: 10, y: 0, kind: 'extrémité' })
    expect(findSnap(project, 5.1, 0.1, 1, null, ALL_SNAPS)).toMatchObject({ x: 5, kind: 'milieu' })
    expect(findSnap(project, 8.2, 0.2, 1, null, ALL_SNAPS)).toMatchObject({ x: 8, y: 0, kind: 'intersection' })
  })
})
