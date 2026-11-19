import { describe, expect, it } from 'vitest'
import { pointInRing } from '../src/core/geom'
import { inwardFrames } from '../src/edit/ops'
import { elevationColor, labelContour } from '../src/topo/contourlabels'
import { DEFAULT_RULES } from '../src/topo/codes'
import { DEFAULT_PLAN, generatePlan } from '../src/topo/generate'

describe('habillage des courbes', () => {
  it('cotes régulières le long d’une courbe, trait interrompu, sommets restés sur la courbe', () => {
    const pts = [783600, 427150, 783700, 427200]
    const r = labelContour(pts, false, { spacing: 40, textLength: 4, gap: 0.5 })
    expect(r.labels.length).toBeGreaterThanOrEqual(2)
    let len = 0
    for (const p of r.pieces) {
      for (let i = 0; i < p.length; i += 2) {
        // Chaque sommet reste sur la droite y = 427150 + (x - 783600) / 2
        expect(Math.abs(p[i + 1] - (427150 + (p[i] - 783600) / 2))).toBeLessThan(1e-9)
      }
      for (let i = 2; i < p.length; i += 2) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1])
    }
    const total = Math.hypot(100, 50)
    expect(len).toBeCloseTo(total - r.labels.length * 5, 6)
    for (const l of r.labels) expect(Math.abs(l.rot - Math.atan2(50, 100))).toBeLessThan(1e-9)
  })
  it('courbe fermée : les morceaux se rejoignent par le point de départ', () => {
    const ring: number[] = []
    for (let i = 0; i < 64; i++) ring.push(50 * Math.cos((i / 64) * 2 * Math.PI), 50 * Math.sin((i / 64) * 2 * Math.PI))
    const r = labelContour(ring, true, { spacing: 100, textLength: 5, gap: 0.5 })
    expect(r.labels.length).toBeGreaterThanOrEqual(2)
    expect(r.pieces.length).toBe(r.labels.length)
  })
  it('dégradé : bas en vert, haut en brun', () => {
    expect(elevationColor(700, 700, 750)).toBe(0x1a9641)
    expect(elevationColor(750, 700, 750)).toBe(0x7f3b08)
  })
})

describe('annotations de la parcelle à l’intérieur', () => {
  it('directions intérieures justes pour les deux sens de parcours et un angle rentrant', () => {
    const shapes = [
      [0, 0, 30, 0, 30, 30, 15, 12, 0, 30],
      [0, 30, 15, 12, 30, 30, 30, 0, 0, 0],
    ]
    for (const ring of shapes) {
      const f = inwardFrames(ring)
      for (let i = 0; i < ring.length / 2; i++) expect(pointInRing(ring[i * 2] + f.vertex[i][0] * 0.5, ring[i * 2 + 1] + f.vertex[i][1] * 0.5, ring)).toBe(true)
      for (let i = 0; i < ring.length / 2; i++) {
        const j = (i + 1) % (ring.length / 2)
        const mx = (ring[i * 2] + ring[j * 2]) / 2
        const my = (ring[i * 2 + 1] + ring[j * 2 + 1]) / 2
        expect(pointInRing(mx + f.edge[i][0] * 0.5, my + f.edge[i][1] * 0.5, ring)).toBe(true)
      }
    }
  })
  it('plan généré : noms des bornes et longueurs des côtés dans la parcelle', () => {
    const b = [
      ['B.1', 783643.653, 427227.772],
      ['B.2', 783650.829, 427210.757],
      ['B.3', 783639.247, 427172.135],
      ['B.4', 783624.996, 427177.778],
      ['B.5', 783632.079, 427197.03],
      ['B.6', 783632.809, 427221.321],
    ] as const
    const pts = b.map(([id, x, y], i) => ({ id, x, y, z: 745 + i * 0.3, code: 'BORN', line: i + 2 }))
    const plan = generatePlan(pts, DEFAULT_RULES, { ...DEFAULT_PLAN, offset: [0, 0, 0] }, 'essai')
    expect(Math.round(plan.parcel!.area)).toBe(778)
    const ring = b.flatMap(([, x, y]) => [x, y])
    const texts = plan.dataset.entities.filter((e) => e.t === 'text' && (e.layer === '05_BORNES' || e.layer === '14_COTATIONS'))
    expect(texts.length).toBe(12)
    for (const t of texts) if (t.t === 'text') expect(pointInRing(t.x, t.y, ring)).toBe(true)
  })
})
