/**
 * Listes déroulantes Région → Département → Arrondissement (Cameroun), liées entre elles,
 * avec saisie libre possible (« Autre… ») pour un nom absent ou une autre graphie.
 */
import { REGIONS, findArrondissement, findDepartement, findRegion } from '../data/cameroun'
import type { SheetInfo } from '../topo/sheet'
import { field, h } from './dom'

const OTHER = '__autre'

function combo(label: string, value: string, options: string[], onChange: (v: string) => void, placeholder: string, onType: (v: string) => void): HTMLElement {
  const sel = h('select') as HTMLSelectElement
  const free = h('input', { type: 'text', value, placeholder: 'Saisie libre' }) as HTMLInputElement
  const known = options.includes(value)
  sel.append(h('option', { value: '' }, placeholder))
  for (const o of options) sel.append(h('option', { value: o }, o))
  sel.append(h('option', { value: OTHER }, 'Autre (saisie libre)…'))
  sel.value = value && !known ? OTHER : value
  free.style.display = sel.value === OTHER ? '' : 'none'
  sel.addEventListener('change', () => {
    if (sel.value === OTHER) {
      free.style.display = ''
      free.focus()
      onType(free.value)
    } else {
      free.style.display = 'none'
      onChange(sel.value)
    }
  })
  free.addEventListener('input', () => onType(free.value))
  return field(label, h('div', { class: 'combo' }, sel, free))
}

/**
 * Trois listes liées. Choisir un arrondissement complète département et région ; changer de
 * région vide un département qui n'en fait pas partie. `onChange` redessine l'aperçu.
 */
export function territoryFields(info: Pick<SheetInfo, 'region' | 'departement' | 'arrondissement'>, onChange: () => void): HTMLElement {
  const host = h('div', { class: 'row' })
  const build = () => {
    const region = findRegion(info.region)
    const dep = findDepartement(info.departement, info.region)
    const deps = region ? region.departements : REGIONS.flatMap((r) => r.departements)
    const arrs = dep ? dep.departement.arrondissements : region ? region.departements.flatMap((d) => d.arrondissements) : []
    host.replaceChildren(
      combo('Région', info.region, REGIONS.map((r) => r.nom), (v) => {
        info.region = v
        const r = findRegion(v)
        if (r && info.departement && !r.departements.some((d) => findDepartement(info.departement, r.nom)?.departement === d)) {
          info.departement = ''
          info.arrondissement = ''
        }
        build()
        onChange()
      }, '— Région —', (v) => {
        info.region = v
        onChange()
      }),
      combo('Département', info.departement, deps.map((d) => d.nom), (v) => {
        info.departement = v
        const f = findDepartement(v)
        if (f) {
          info.region = f.region.nom
          if (info.arrondissement && !f.departement.arrondissements.includes(info.arrondissement)) info.arrondissement = ''
        }
        build()
        onChange()
      }, '— Département —', (v) => {
        info.departement = v
        onChange()
      }),
      combo('Arrondissement', info.arrondissement, arrs, (v) => {
        info.arrondissement = v
        const f = findArrondissement(v)
        if (f) {
          info.departement = f.departement.nom
          info.region = f.region.nom
        }
        build()
        onChange()
      }, arrs.length ? '— Arrondissement —' : '— choisissez d’abord le département —', (v) => {
        info.arrondissement = v
        onChange()
      }),
    )
  }
  build()
  return host
}
