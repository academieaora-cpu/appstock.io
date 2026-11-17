/**
 * Projets : reprendre un travail plus tard. Trois niveaux, du plus privé au plus partagé :
 * sauvegarde automatique sur l'appareil, projets nommés sur l'appareil ou en fichier,
 * et, si l'utilisateur le choisit, enregistrement en ligne dans son compte.
 */
import type { Project } from '../core/project'
import { restoreSnapshot, snapshotInfo, takeSnapshot, type ViewState } from '../core/snapshot'
import { AUTOSAVE_ID, deleteLocal, listLocal, loadLocal, requestPersistence, saveLocal } from '../core/storage'
import { download } from '../io/export'
import { clear, field, h, modal, toast } from './dom'

export interface ProjectHost {
  project: Project
  getView(): ViewState
  setView(v: ViewState | null): void
  /** Nom du projet en cours (modifiable par l'utilisateur). */
  name: string
  getDoc(): unknown
  setDoc(doc: unknown): void
}

const when = (t: number | string) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
const size = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko')

export function openSnapshot(host: ProjectHost, bytes: Uint8Array): void {
  const r = restoreSnapshot(bytes, host.project)
  host.name = r.name
  if (r.doc) host.setDoc(r.doc)
  host.setView(r.view)
}

/** Sauvegarde automatique : appelée après chaque modification, avec un léger délai. */
export function makeAutosave(host: ProjectHost): () => void {
  let timer = 0
  return () => {
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      const p = host.project
      const action = p.items.length ? saveLocal(AUTOSAVE_ID, host.name || 'Travail en cours', takeSnapshot(p, host.getView(), host.name || 'Travail en cours', host.getDoc())) : deleteLocal(AUTOSAVE_ID)
      action.catch(() => {
        /* stockage indisponible (navigation privée…) : le travail reste en mémoire */
      })
    }, 1200)
  }
}

/** Travail en cours retrouvé au démarrage, s'il y en a un. */
export async function findAutosave(): Promise<{ bytes: Uint8Array; savedAt: string; files: string[] } | null> {
  try {
    const bytes = await loadLocal(AUTOSAVE_ID)
    if (!bytes) return null
    const info = snapshotInfo(bytes)
    return info.files.length ? { bytes, savedAt: info.savedAt, files: info.files } : null
  } catch {
    return null
  }
}

export function openProjectsDialog(host: ProjectHost): void {
  const body = h('div', { class: 'content' })
  const close = modal('Projets — reprendre son travail plus tard', body, { wide: true })
  const hasWork = () => host.project.items.length > 0
  const snapshot = () => takeSnapshot(host.project, host.getView(), host.name || 'Projet', host.getDoc())

  const nameInput = h('input', { type: 'text', value: host.name, placeholder: 'Nom du projet', oninput: () => (host.name = nameInput.value.trim()) })
  const localList = h('div')
  const cloudBox = h('div')

  const load = (bytes: Uint8Array) => {
    try {
      openSnapshot(host, bytes)
      close()
      toast(`Projet « ${host.name} » rouvert.`, 'ok')
    } catch (err) {
      toast(String((err as Error).message ?? err), 'erreur')
    }
  }

  const drawLocal = async () => {
    clear(localList)
    let rows
    try {
      rows = (await listLocal()).filter((r) => r.id !== AUTOSAVE_ID)
    } catch (err) {
      localList.append(h('div', { class: 'note warn' }, String((err as Error).message ?? err)))
      return
    }
    if (!rows.length) {
      localList.append(h('p', { class: 'muted' }, 'Aucun projet enregistré sur cet appareil pour l’instant.'))
      return
    }
    localList.append(
      h(
        'table',
        { class: 'grid' },
        h('thead', null, h('tr', null, ...['Projet', 'Enregistré le', 'Taille', ''].map((c) => h('th', null, c)))),
        h(
          'tbody',
          null,
          ...rows.map((r) =>
            h(
              'tr',
              null,
              h('td', null, r.name),
              h('td', null, when(r.savedAt)),
              h('td', null, size(r.size)),
              h(
                'td',
                null,
                h('button', { onclick: async () => {
                  const bytes = await loadLocal(r.id)
                  if (bytes) load(bytes)
                } }, 'Ouvrir'),
                ' ',
                h('button', { onclick: async () => {
                  await deleteLocal(r.id)
                  void drawLocal()
                } }, 'Supprimer'),
              ),
            ),
          ),
        ),
      ),
    )
  }

  const saveHere = async () => {
    if (!hasWork()) return toast('Rien à enregistrer : ouvrez un fichier ou générez un plan.', 'erreur')
    if (!host.name) return toast('Donnez un nom au projet.', 'erreur')
    try {
      await saveLocal('p:' + host.name, host.name, snapshot())
      void requestPersistence()
      toast(`Projet « ${host.name} » enregistré sur cet appareil.`, 'ok')
      void drawLocal()
    } catch (err) {
      toast('Enregistrement impossible : ' + String((err as Error).message ?? err), 'erreur')
    }
  }

  const fileInput = h('input', { type: 'file', accept: '.geoprojet', hidden: true, onchange: async () => {
    const f = fileInput.files?.[0]
    if (f) load(new Uint8Array(await f.arrayBuffer()))
  } })

  // --- En ligne (facultatif) ---------------------------------------------------
  const drawCloud = async () => {
    clear(cloudBox)
    cloudBox.append(h('p', { class: 'muted' }, 'Chargement…'))
    let cloud: typeof import('../cloud/cloud')
    let user: { id: string; email: string } | null
    try {
      cloud = await import('../cloud/cloud')
      user = await cloud.currentUser()
    } catch (err) {
      clear(cloudBox)
      cloudBox.append(h('div', { class: 'note warn' }, 'Service en ligne injoignable : ' + String((err as Error).message ?? err)))
      return
    }
    clear(cloudBox)
    if (!user) {
      const email = h('input', { type: 'text', inputMode: 'email', autocomplete: 'email', placeholder: 'vous@exemple.com' })
      const password = h('input', { type: 'password', autocomplete: 'current-password', placeholder: '8 caractères minimum' })
      const act = async (mode: 'in' | 'up') => {
        if (!email.value.includes('@') || password.value.length < 8) return toast('Indiquez une adresse valide et un mot de passe d’au moins 8 caractères.', 'erreur')
        try {
          if (mode === 'in') await cloud.signIn(email.value.trim(), password.value)
          else if ((await cloud.signUp(email.value.trim(), password.value)) === 'confirmer') {
            toast('Compte créé : ouvrez le courriel de confirmation, puis connectez-vous.', 'ok', 10000)
            return
          }
          void drawCloud()
        } catch (err) {
          toast(String((err as Error).message ?? err), 'erreur', 9000)
        }
      }
      cloudBox.append(
        h('div', { class: 'row' }, field('Adresse électronique', email), field('Mot de passe', password)),
        h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => act('in') }, 'Se connecter'), h('button', { onclick: () => act('up') }, 'Créer un compte')),
      )
      return
    }
    const list = h('div')
    const refresh = async () => {
      clear(list)
      try {
        const rows = await cloud.listCloud()
        if (!rows.length) list.append(h('p', { class: 'muted' }, 'Aucun projet en ligne pour l’instant.'))
        else {
          list.append(
            h(
              'table',
              { class: 'grid' },
              h('thead', null, h('tr', null, ...['Projet', 'Enregistré le', 'Taille', ''].map((c) => h('th', null, c)))),
              h(
                'tbody',
                null,
                ...rows.map((r) =>
                  h(
                    'tr',
                    null,
                    h('td', null, r.name),
                    h('td', null, when(r.updated_at)),
                    h('td', null, size(r.size_bytes)),
                    h(
                      'td',
                      null,
                      h('button', { onclick: async () => {
                        try {
                          load(await cloud.loadCloud(r))
                        } catch (err) {
                          toast(String((err as Error).message ?? err), 'erreur')
                        }
                      } }, 'Ouvrir'),
                      ' ',
                      h('button', { onclick: async () => {
                        try {
                          await cloud.deleteCloud(r)
                          void refresh()
                        } catch (err) {
                          toast(String((err as Error).message ?? err), 'erreur')
                        }
                      } }, 'Supprimer'),
                    ),
                  ),
                ),
              ),
            ),
          )
        }
      } catch (err) {
        list.append(h('div', { class: 'note warn' }, String((err as Error).message ?? err)))
      }
    }
    cloudBox.append(
      h('p', null, 'Connecté : ', h('b', null, user.email), ' ', h('button', { class: 'link', onclick: async () => {
        await cloud.signOut()
        void drawCloud()
      } }, 'Se déconnecter')),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: async () => {
        if (!hasWork()) return toast('Rien à enregistrer.', 'erreur')
        if (!host.name) return toast('Donnez un nom au projet.', 'erreur')
        try {
          await cloud.saveCloud(host.name, snapshot())
          toast(`Projet « ${host.name} » enregistré en ligne.`, 'ok')
          void refresh()
        } catch (err) {
          toast(String((err as Error).message ?? err), 'erreur', 9000)
        }
      } }, 'Enregistrer le projet en ligne')),
      list,
    )
    void refresh()
  }

  body.append(
    fileInput,
    h('div', { class: 'note ok' }, 'Votre travail en cours est enregistré automatiquement sur cet appareil : à la prochaine ouverture de la plateforme, vous pourrez le reprendre en un clic.'),
    h('h3', null, 'Projet en cours'),
    h('div', { class: 'row' }, field('Nom', nameInput), h('button', { class: 'primary', onclick: saveHere }, 'Enregistrer sur cet appareil'), h('button', { onclick: () => {
      if (!hasWork()) return toast('Rien à enregistrer.', 'erreur')
      download({ name: (host.name || 'projet') + '.geoprojet', mime: 'application/gzip', data: snapshot() })
    } }, 'Télécharger en fichier'), h('button', { onclick: () => fileInput.click() }, 'Ouvrir un fichier projet')),
    h('h3', null, 'Projets sur cet appareil'),
    localList,
    h('h3', null, 'Projets en ligne (facultatif)'),
    h('p', { class: 'muted' }, 'Pour retrouver un projet sur un autre appareil. Dans ce cas seulement, le projet est envoyé sur le serveur de la plateforme, dans votre compte, visible de vous seul. Sans connexion, rien ne quitte votre appareil.'),
    cloudBox,
  )
  void drawLocal()
  void drawCloud()
}
