import { describe, expect, it } from 'vitest'
import { Project } from '../src/core/project'
import type { Entity } from '../src/core/types'
import { ADVANCED_COMMANDS } from '../src/edit/advanced'
import { GEOMETRY_COMMANDS } from '../src/edit/commands'
import { edgePrims, extendEntity, filletLines, filletPolyline, intersectParams, trimEntity } from '../src/edit/curves'
import { Editor } from '../src/edit/editor'
import { clipHalfPlane, cutFill, divideParallel, dividePivot, drape, gridStep, gridValues, longProfile, signedArea, stakeout, tabulate, talusHachures } from '../src/topo/calc'
import { buildTin } from '../src/topo/tin'

const line = (x1: number, y1: number, x2: number, y2: number): Entity => ({ t: 'line', layer: '0', color: -1, x1, y1, x2, y2 })
const pline = (pts: number[], closed = false): Entity => ({ t: 'pline', layer: '0', color: -1, pts: Float64Array.from(pts), closed })

describe('intersections exactes', () => {
  it('segment × cercle et arc de polyligne', () => {
    const circle: Entity = { t: 'circle', layer: '0', color: -1, cx: 0, cy: 0, r: 5 }
    const [c] = edgePrims(circle)
    const [s] = edgePrims(line(-10, 0, 10, 0))
    const ts = intersectParams(s, c).sort()
    expect(ts[0]).toBeCloseTo(0.25, 12)
    expect(ts[1]).toBeCloseTo(0.75, 12)
    // Demi-cercle par bulge 1 de (0,0) à (10,0), sens trigonométrique : il passe par (5,-5).
    const half = edgePrims({ t: 'pline', layer: '0', color: -1, pts: Float64Array.from([0, 0, 10, 0]), bulges: Float64Array.from([1, 0]), closed: false })
    const vert = edgePrims(line(5, -10, 5, 10))[0]
    const t = intersectParams(vert, half[0])
    expect(t).toHaveLength(1)
    expect(-10 + 20 * t[0]).toBeCloseTo(-5, 9)
  })
})

describe('ajuster', () => {
  it('coupe la partie désignée entre deux arêtes', () => {
    const cutters = [...edgePrims(line(3, -5, 3, 5)), ...edgePrims(line(7, -5, 7, 5))]
    const res = trimEntity(line(0, 0, 10, 0), cutters, [5, 0])!
    expect(res).toHaveLength(2)
    const [a, b] = res as Extract<Entity, { t: 'line' }>[]
    expect([a.x1, a.x2]).toEqual([0, 3])
    expect(b.x1).toBeCloseTo(7, 12)
    expect(b.x2).toBe(10)
  })
  it('coupe jusqu’à l’extrémité et refuse sans intersection', () => {
    const cutters = edgePrims(line(3, -5, 3, 5))
    const res = trimEntity(line(0, 0, 10, 0), cutters, [8, 0])!
    expect(res).toHaveLength(1)
    expect((res[0] as Extract<Entity, { t: 'line' }>).x2).toBeCloseTo(3, 12)
    expect(trimEntity(line(0, 2, 10, 2), edgePrims(line(20, 0, 20, 5)), [5, 2])).toBeNull()
  })
  it('ouvre une polyligne fermée et change un cercle en arc', () => {
    const square = pline([0, 0, 10, 0, 10, 10, 0, 10], true)
    const cutters = edgePrims(line(5, -1, 5, 11))
    const [rest] = trimEntity(square, cutters, [10, 5]) as Extract<Entity, { t: 'pline' }>[]
    expect(rest.closed).toBe(false)
    // Reste : de (5,10) à (5,0) en passant par (0,10) et (0,0) ; la moitié droite a disparu.
    expect(Array.from(rest.pts)).toEqual([5, 10, 0, 10, 0, 0, 5, 0])
    const circle: Entity = { t: 'circle', layer: '0', color: -1, cx: 0, cy: 0, r: 5 }
    const [arc] = trimEntity(circle, edgePrims(line(0, -10, 0, 10)), [5, 0]) as Extract<Entity, { t: 'arc' }>[]
    expect(arc.t).toBe('arc')
    // La moitié droite (x > 0) est supprimée : il reste l'arc de 90° à 270°.
    expect(arc.a0).toBeCloseTo(Math.PI / 2, 9)
    expect(arc.a1).toBeCloseTo((3 * Math.PI) / 2, 9)
  })
})

describe('prolonger et raccorder', () => {
  it('prolonge jusqu’à la première limite', () => {
    const limits = [...edgePrims(line(15, -5, 15, 5)), ...edgePrims(line(20, -5, 20, 5))]
    const r = extendEntity(line(0, 0, 10, 0), limits, [9, 0]) as Extract<Entity, { t: 'line' }>
    expect(r.x2).toBeCloseTo(15, 12)
    const p = extendEntity(pline([0, 0, 5, 5, 10, 5]), limits, [1, 1]) as Extract<Entity, { t: 'pline' }>
    expect(p).toBeNull()
  })
  it('raccord de rayon r tangent aux deux lignes, et angle vif', () => {
    const res = filletLines([[0, 0], [10, 0]], [8, 0], [[12, 2], [12, 10]], [12, 8], 2)
    if (typeof res === 'string') throw new Error(res)
    expect(res.a[1][0]).toBeCloseTo(10, 9)
    expect(res.b[1][1]).toBeCloseTo(2, 9)
    expect(res.arc!.cx).toBeCloseTo(10, 9)
    expect(res.arc!.cy).toBeCloseTo(2, 9)
    expect(res.arc!.r).toBe(2)
    const sharp = filletLines([[0, 0], [10, 0]], [8, 0], [[12, 2], [12, 10]], [12, 8], 0)
    if (typeof sharp === 'string') throw new Error(sharp)
    expect(sharp.a[1]).toEqual([12, 0])
    expect(sharp.b[1][0]).toBeCloseTo(12, 12)
    expect(sharp.b[1][1]).toBeCloseTo(0, 12)
  })
  it('arrondit les angles d’un carré : surface = 100 − (4 − π)·r²', () => {
    const r = filletPolyline([0, 0, 10, 0, 10, 10, 0, 10], true, 2)
    expect(r.done).toBe(4)
    const e: Entity = { t: 'pline', layer: '0', color: -1, pts: Float64Array.from(r.pts), bulges: Float64Array.from(r.bulges), closed: true }
    // Aire avec arcs : polygone des sommets + segments circulaires.
    let area = Math.abs(signedArea(r.pts))
    for (let i = 0; i < r.bulges.length; i++) {
      const b = r.bulges[i]
      if (!b) continue
      const n = r.pts.length / 2
      const j = (i + 1) % n
      const c = Math.hypot(r.pts[j * 2] - r.pts[i * 2], r.pts[j * 2 + 1] - r.pts[i * 2 + 1])
      const theta = 4 * Math.atan(Math.abs(b))
      const rad = c / (2 * Math.sin(theta / 2))
      area += (rad * rad * (theta - Math.sin(theta))) / 2
    }
    expect(e.t).toBe('pline')
    expect(area).toBeCloseTo(100 - (4 - Math.PI) * 4, 9)
  })
})

describe('calculs topographiques', () => {
  it('hachures de talus alternées, perpendiculaires, jusqu’au pied', () => {
    const segs = talusHachures([0, 10, 20, 10], [0, 0, 20, 0], 2, 0.5)
    expect(segs).toHaveLength(10)
    expect(segs[0]).toEqual([1, 10, 1, 0])
    expect(segs[1][3]).toBeCloseTo(5, 12)
  })
  it('carroyage : pas et valeurs ronds', () => {
    expect(gridStep(120, 80, 500)).toBe(25)
    expect(gridValues(783612.4, 783701, 25)).toEqual([783625, 783650, 783675, 783700])
  })
  it('implantation : gisement, distance, lecture par rapport à la référence', () => {
    const [r] = stakeout([0, 0], [0, 10], [{ name: 'A', x: 10, y: 0 }])
    expect(r.gisement).toBeCloseTo(100, 12)
    expect(r.distance).toBe(10)
    expect(r.hz).toBeCloseTo(100, 12)
    const [r2] = stakeout([0, 0], [10, 0], [{ name: 'B', x: 0, y: 10 }])
    expect(r2.hz).toBeCloseTo(300, 12)
  })
  it('découpe par demi-plan exacte sur un polygone concave', () => {
    // U de 3 × 3 creusé d'une encoche 1 × 2 au milieu du haut : aire 7.
    const u = [0, 0, 3, 0, 3, 3, 2, 3, 2, 1, 1, 1, 1, 3, 0, 3]
    expect(Math.abs(signedArea(u))).toBe(7)
    // Partie y ≥ 2 : deux bras de 1 × 1.
    expect(Math.abs(signedArea(clipHalfPlane(u, 0, 1, -2)))).toBeCloseTo(2, 12)
  })
  it('division parallèle et par pivot : surface exacte', () => {
    const rect = [0, 0, 40, 0, 40, 25, 0, 25]
    const d = divideParallel(rect, [0, 0], [0, 25], 300)
    if (typeof d === 'string') throw new Error(d)
    expect(d.partArea).toBeCloseTo(300, 6)
    expect(d.restArea).toBeCloseTo(700, 6)
    expect(d.cut[0][0]).toBeCloseTo(12, 6)
    const p = dividePivot(rect, [0, 0], [40, 10], 250)
    if (typeof p === 'string') throw new Error(p)
    expect(p.partArea).toBeCloseTo(250, 6)
    expect(divideParallel(rect, [0, 0], [0, 25], 2000)).toMatch(/comprise entre/)
  })
  it('cubatures exactes sur un plan incliné', () => {
    // Terrain z = x/10 sur 0..20 × 0..10 : plateforme à 1 m.
    const pts = [] as { x: number; y: number; z: number }[]
    for (let x = 0; x <= 20; x += 5) for (let y = 0; y <= 10; y += 5) pts.push({ x: 783600 + x, y: 427200 + y, z: 700 + x / 10 })
    const tin = buildTin(pts)!
    const r = cutFill(tin, 701)
    expect(r.area).toBeCloseTo(200, 6)
    // Déblai : prisme triangulaire x de 10 à 20 : 0.5 × 10 × 1 × 10 = 50 m³ ; remblai idem.
    expect(r.cut).toBeCloseTo(50, 6)
    expect(r.fill).toBeCloseTo(50, 6)
    const inside = cutFill(tin, 701, [783610, 427200, 783620, 427200, 783620, 427210, 783610, 427210])
    expect(inside.cut).toBeCloseTo(50, 6)
    expect(inside.fill).toBeCloseTo(0, 9)
    const outside = cutFill(tin, 701, [783615, 427200, 783630, 427200, 783630, 427210, 783615, 427210])
    expect(outside.area).toBeCloseTo(50, 6)
    expect(outside.uncovered).toBeCloseTo(100, 6)
  })
  it('profil en long : cassures du MNT et altitudes interpolées', () => {
    const pts = [] as { x: number; y: number; z: number }[]
    for (let x = 0; x <= 20; x += 10) for (let y = 0; y <= 10; y += 10) pts.push({ x, y, z: 100 + x / 10 })
    const tin = buildTin(pts)!
    const prof = longProfile(tin, [0, 5, 20, 5], 5)
    expect(prof[0].d).toBe(0)
    expect(prof[prof.length - 1].d).toBe(20)
    for (const p of prof) expect(p.z).toBeCloseTo(100 + p.x / 10, 9)
    // Les pas réguliers priment sur les cassures confondues (x = 10 est une arête du MNT).
    expect(prof.filter((p) => p.kind === 'pas').map((p) => p.d)).toEqual([5, 10, 15])
    const breaks = longProfile(tin, [0, 5, 20, 5], 0)
    expect(breaks.filter((p) => p.kind === 'mnt').map((p) => p.d)).toEqual([5, 10, 15])
  })
})

describe('tabulation et transformation 3D', () => {
  it('stations au pas, aux sommets et aux extrémités, normales à gauche', () => {
    const st = tabulate([0, 0, 25, 0, 25, 10], 10)
    expect(st.map((s) => s.s)).toEqual([0, 10, 20, 25, 30, 35])
    expect(st[1].nx).toBeCloseTo(0, 12)
    expect(st[1].ny).toBeCloseTo(1, 12)
  })
  it('altitudes lues sur le MNT, refus hors MNT', () => {
    const pts = [] as { x: number; y: number; z: number }[]
    for (let x = 0; x <= 20; x += 10) for (let y = 0; y <= 10; y += 10) pts.push({ x, y, z: 50 + x / 10 + y / 20 })
    const tin = buildTin(pts)!
    const r = drape(tin, [0, 0, 20, 10], true)!
    expect(r.zs[0]).toBeCloseTo(50, 9)
    expect(r.zs[r.zs.length - 1]).toBeCloseTo(52.5, 9)
    expect(r.pts.length / 2).toBeGreaterThan(2)
    expect(drape(tin, [0, 0, 30, 0], false)).toBeNull()
  })
})

describe('commandes dans l’éditeur', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0))
  function setup() {
    const project = new Project()
    project.crs = 'EPSG:32632'
    const ed = new Editor(project)
    ed.pickTol = () => 0.5
    ed.register([...GEOMETRY_COMMANDS, ...ADVANCED_COMMANDS])
    ed.snapOn = false
    return { project, ed }
  }
  it('script : dessin, puis ajuster au clic', async () => {
    const { ed } = setup()
    await ed.runScript(['; deux lignes qui se croisent', 'L', '0,0', '10,0', '', 'L', '5,-5', '5,5', ''].join('\n'))
    const item = ed.target()
    expect(item.ds.entities).toHaveLength(2)
    void ed.run('AJUSTER')
    await tick()
    ed.onEnter()
    await tick()
    ed.onMove([8, 0])
    ed.onClick([8, 0], false)
    await tick()
    ed.onEnter()
    await tick()
    await tick()
    const lines = item.ds.entities.filter((e) => e.t === 'line') as Extract<Entity, { t: 'line' }>[]
    expect(lines).toHaveLength(2)
    const h = lines.find((l) => l.y1 === 0 && l.y2 === 0)!
    expect(Math.max(h.x1, h.x2)).toBeCloseTo(5, 9)
  })
  it('choix des objets : T pour tout', async () => {
    const { ed } = setup()
    await ed.runScript(['L', '0,0', '10,0', '', 'L', '0,5', '10,5', '', 'EFFACER', 'T', ''].join('\n'))
    expect(ed.target().ds.entities).toHaveLength(0)
  })
})
