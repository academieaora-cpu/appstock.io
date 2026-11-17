/**
 * Comptes : écran d'entrée (connexion, inscription, essai sans compte), fiche « Mon compte »
 * et tableau de bord administrateur.
 */
import { clear, field, h, modal, toast } from './dom'

type Cloud = typeof import('../cloud/cloud')
const cloud = (): Promise<Cloud> => import('../cloud/cloud')

export interface Session {
  email: string
  role: 'user' | 'admin'
  guest: boolean
}

const GUEST_KEY = 'appstock.guest'

/** Affiche l'écran d'entrée si personne n'est connecté ; résout quand l'utilisateur entre. */
export function authGate(root: HTMLElement): Promise<Session> {
  return new Promise((resolve) => {
    const screen = h('div', { class: 'auth-screen' })
    root.append(screen)
    const done = (s: Session) => {
      screen.remove()
      resolve(s)
    }
    const status = h('div', { class: 'note', hidden: true })
    const say = (text: string, kind: '' | 'ok' | 'warn' | 'err' = '') => {
      status.hidden = false
      status.className = 'note ' + kind
      status.textContent = text
    }
    const email = h('input', { type: 'text', inputMode: 'email', autocomplete: 'email', placeholder: 'vous@exemple.com' })
    const password = h('input', { type: 'password', autocomplete: 'current-password', placeholder: '8 caractères minimum' })
    const busy = (b: boolean) => screen.querySelectorAll('button').forEach((x) => ((x as HTMLButtonElement).disabled = b))
    const check = () => {
      if (!email.value.includes('@')) return say('Indiquez une adresse électronique valide.', 'warn'), false
      if (password.value.length < 8) return say('Le mot de passe doit faire au moins 8 caractères.', 'warn'), false
      return true
    }
    const enter = async () => {
      const c = await cloud()
      const role = await c.touch()
      const u = await c.currentUser()
      try {
        sessionStorage.removeItem(GUEST_KEY)
      } catch {
        /* rien */
      }
      done({ email: u?.email ?? email.value, role, guest: false })
    }
    const signIn = async () => {
      if (!check()) return
      busy(true)
      try {
        const c = await cloud()
        await c.signIn(email.value.trim(), password.value)
        await enter()
      } catch (err) {
        const m = String((err as Error).message ?? err)
        say(/Invalid login|invalid_credentials/i.test(m) ? 'Adresse ou mot de passe incorrect.' : /Email not confirmed/i.test(m) ? 'Adresse pas encore confirmée : ouvrez le courriel de confirmation reçu à l’inscription.' : m, 'err')
      } finally {
        busy(false)
      }
    }
    const signUp = async () => {
      if (!check()) return
      busy(true)
      try {
        const c = await cloud()
        const r = await c.signUp(email.value.trim(), password.value)
        if (r === 'connecté') await enter()
        else say('Compte créé. Un courriel de confirmation vous a été envoyé : cliquez le lien qu’il contient, puis connectez-vous ici.', 'ok')
      } catch (err) {
        const m = String((err as Error).message ?? err)
        say(/already registered/i.test(m) ? 'Un compte existe déjà avec cette adresse : connectez-vous.' : m, 'err')
      } finally {
        busy(false)
      }
    }
    const forgot = async () => {
      if (!email.value.includes('@')) return say('Tapez d’abord votre adresse électronique.', 'warn')
      try {
        await (await cloud()).resetPassword(email.value.trim())
        say('Si un compte existe pour cette adresse, un courriel de réinitialisation vient d’être envoyé.', 'ok')
      } catch (err) {
        say(String((err as Error).message ?? err), 'err')
      }
    }
    const guest = () => {
      try {
        sessionStorage.setItem(GUEST_KEY, '1')
      } catch {
        /* rien */
      }
      done({ email: '', role: 'user', guest: true })
    }
    password.addEventListener('keydown', (e) => e.key === 'Enter' && void signIn())
    screen.append(
      h(
        'div',
        { class: 'auth-card' },
        h('div', { class: 'auth-brand' }, h('b', null, 'AppStock Géo'), h('span', null, 'CAO · SIG · Topographie dans le navigateur')),
        h('p', { class: 'muted' }, 'Connectez-vous pour retrouver vos projets en ligne sur tous vos appareils.'),
        field('Adresse électronique', email),
        field('Mot de passe', password),
        h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => void signIn() }, 'Se connecter'), h('button', { onclick: () => void signUp() }, 'Créer un compte')),
        h('button', { class: 'link', onclick: () => void forgot() }, 'Mot de passe oublié ?'),
        status,
        h('hr'),
        h('button', { class: 'link', onclick: guest }, 'Essayer sans compte'),
        h('small', { class: 'muted' }, ' — tout fonctionne, mais rien n’est enregistré en ligne.'),
      ),
    )
    // Session déjà ouverte, ou essai en cours : on entre directement.
    void (async () => {
      try {
        if (sessionStorage.getItem(GUEST_KEY)) return guest()
      } catch {
        /* rien */
      }
      try {
        const c = await cloud()
        if (await c.currentUser()) await enter()
      } catch {
        say('Service en ligne injoignable : vous pouvez continuer sans compte, tout fonctionne sur votre appareil.', 'warn')
      }
    })()
  })
}

export function openAccountDialog(session: Session, onSignOut: () => void, onRole: (role: 'user' | 'admin') => void): void {
  const body = h('div', { class: 'content' })
  modal('Mon compte', body)
  if (session.guest) {
    body.append(h('p', null, 'Vous utilisez la plateforme sans compte : vos projets restent sur cet appareil.'), h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: onSignOut }, 'Se connecter ou créer un compte')))
    return
  }
  body.append(h('p', { class: 'muted' }, 'Chargement…'))
  void (async () => {
    const c = await cloud()
    const p = await c.getProfile()
    clear(body)
    const name = h('input', { type: 'text', value: p?.full_name ?? '' })
    const org = h('input', { type: 'text', value: p?.organisation ?? '' })
    const pass = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Nouveau mot de passe (8 caractères minimum)' })
    const code = h('input', { type: 'text', placeholder: 'Code administrateur' })
    body.append(
      h('table', { class: 'kv' }, h('tbody', null, h('tr', null, h('td', null, 'Adresse'), h('td', null, session.email)), h('tr', null, h('td', null, 'Rôle'), h('td', null, session.role === 'admin' ? 'Administrateur' : 'Utilisateur')))),
      h('h3', null, 'Profil'),
      h('div', { class: 'row' }, field('Nom et prénom', name), field('Cabinet / organisation', org)),
      h('div', { class: 'actions' }, h('button', { onclick: async () => {
        try {
          await c.updateProfile({ full_name: name.value.trim(), organisation: org.value.trim() })
          toast('Profil enregistré.', 'ok')
        } catch (err) {
          toast(String((err as Error).message ?? err), 'erreur')
        }
      } }, 'Enregistrer le profil')),
      h('h3', null, 'Mot de passe'),
      h('div', { class: 'row' }, field('Nouveau mot de passe', pass), h('button', { onclick: async () => {
        if (pass.value.length < 8) return toast('8 caractères minimum.', 'erreur')
        try {
          await c.updatePassword(pass.value)
          pass.value = ''
          toast('Mot de passe changé.', 'ok')
        } catch (err) {
          toast(String((err as Error).message ?? err), 'erreur')
        }
      } }, 'Changer')),
      session.role === 'admin'
        ? ''
        : h('div', null, h('h3', null, 'Administration'), h('div', { class: 'row' }, field('Code reçu de l’équipe', code), h('button', { onclick: async () => {
            try {
              if (await c.claimAdmin(code.value)) {
                toast('Vous êtes administrateur.', 'ok')
                onRole('admin')
              } else toast('Code invalide ou déjà utilisé.', 'erreur')
            } catch (err) {
              toast(String((err as Error).message ?? err), 'erreur')
            }
          } }, 'Devenir administrateur'))),
      h('div', { class: 'actions' }, h('button', { onclick: onSignOut }, 'Se déconnecter')),
    )
  })()
}

const when = (s: string | null) => (s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const size = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : n ? Math.max(1, Math.round(n / 1024)) + ' Ko' : '—')

export function openAdminPanel(): void {
  const body = h('div', { class: 'content' })
  modal('Administration — utilisateurs', body, { wide: true })
  const draw = async () => {
    clear(body)
    body.append(h('p', { class: 'muted' }, 'Chargement…'))
    let rows
    try {
      rows = await (await cloud()).adminOverview()
    } catch (err) {
      clear(body)
      body.append(h('div', { class: 'note err' }, String((err as Error).message ?? err)))
      return
    }
    clear(body)
    const week = Date.now() - 7 * 86400 * 1000
    const active = rows.filter((r) => r.last_seen_at && new Date(r.last_seen_at).getTime() > week).length
    const projects = rows.reduce((s, r) => s + Number(r.projects), 0)
    const bytes = rows.reduce((s, r) => s + Number(r.storage_bytes), 0)
    body.append(
      h('div', { class: 'stats' }, ...[['Comptes', String(rows.length)], ['Actifs sur 7 jours', String(active)], ['Projets en ligne', String(projects)], ['Stockage utilisé', size(bytes)]].map(([k, v]) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, k)))),
      h(
        'div',
        { class: 'scroll tall' },
        h(
          'table',
          { class: 'grid' },
          h('thead', null, h('tr', null, ...['Adresse', 'Nom', 'Organisation', 'Inscrit le', 'Dernière connexion', 'Dernière activité', 'Projets', 'Stockage', 'Rôle'].map((c) => h('th', null, c)))),
          h(
            'tbody',
            null,
            ...rows.map((r) =>
              h(
                'tr',
                null,
                h('td', null, r.email),
                h('td', null, r.full_name ?? ''),
                h('td', null, r.organisation ?? ''),
                h('td', null, when(r.created_at)),
                h('td', null, when(r.last_sign_in_at)),
                h('td', null, when(r.last_seen_at)),
                h('td', null, String(r.projects)),
                h('td', null, size(Number(r.storage_bytes))),
                h(
                  'td',
                  null,
                  h('span', { class: 'badge ' + (r.role === 'admin' ? 'ok' : '') }, r.role === 'admin' ? 'admin' : 'utilisateur'),
                  ' ',
                  h('button', { class: 'link', onclick: async () => {
                    try {
                      await (await cloud()).adminSetRole(r.id, r.role === 'admin' ? 'user' : 'admin')
                      void draw()
                    } catch (err) {
                      toast(String((err as Error).message ?? err), 'erreur')
                    }
                  } }, r.role === 'admin' ? 'retirer' : 'promouvoir'),
                ),
              ),
            ),
          ),
        ),
      ),
    )
  }
  void draw()
}
