/**
 * Enregistrement en ligne, facultatif : compte utilisateur, projets rangés par
 * utilisateur. Le module n'est chargé que si l'utilisateur ouvre cette fonction ;
 * sans cela, la plateforme n'envoie aucun fichier.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLOUD_BUCKET, CLOUD_KEY, CLOUD_URL } from './config'

export interface CloudProject {
  id: string
  name: string
  size_bytes: number
  updated_at: string
  storage_path: string
}

let clientPromise: Promise<SupabaseClient> | null = null
function client(): Promise<SupabaseClient> {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(CLOUD_URL, CLOUD_KEY))
  return clientPromise
}

const fail = (context: string, error: { message: string } | null): void => {
  if (error) throw new Error(`${context} : ${error.message}`)
}

export async function currentUser(): Promise<{ id: string; email: string } | null> {
  const { data } = await (await client()).auth.getSession()
  const u = data.session?.user
  return u ? { id: u.id, email: u.email ?? '' } : null
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await (await client()).auth.signInWithPassword({ email, password })
  fail('Connexion impossible', error)
}

/** Crée un compte. Renvoie « confirmer » si un courriel de confirmation a été envoyé. */
export async function signUp(email: string, password: string): Promise<'connecté' | 'confirmer'> {
  const { data, error } = await (await client()).auth.signUp({ email, password, options: { emailRedirectTo: location.origin } })
  fail('Création du compte impossible', error)
  return data.session ? 'connecté' : 'confirmer'
}

export async function signOut(): Promise<void> {
  await (await client()).auth.signOut()
}

export async function listCloud(): Promise<CloudProject[]> {
  const { data, error } = await (await client()).from('geo_projects').select('id,name,size_bytes,updated_at,storage_path').order('updated_at', { ascending: false })
  fail('Lecture de la liste impossible', error)
  return (data ?? []) as CloudProject[]
}

/** Enregistre un projet en ligne ; un projet du même nom est remplacé. */
export async function saveCloud(name: string, bytes: Uint8Array): Promise<CloudProject> {
  const sb = await client()
  const user = await currentUser()
  if (!user) throw new Error('Connectez-vous pour enregistrer en ligne.')
  const existing = (await listCloud()).find((p) => p.name === name)
  const id = existing?.id ?? crypto.randomUUID()
  const path = `${user.id}/${id}.geoprojet`
  const up = await sb.storage.from(CLOUD_BUCKET).upload(path, new Blob([bytes as BlobPart], { type: 'application/gzip' }), { upsert: true, contentType: 'application/gzip' })
  fail('Envoi du projet impossible', up.error)
  const row = { id, name, storage_path: path, size_bytes: bytes.length, updated_at: new Date().toISOString() }
  const { error } = await sb.from('geo_projects').upsert(row)
  fail('Enregistrement impossible', error)
  return row
}

export async function loadCloud(project: CloudProject): Promise<Uint8Array> {
  const { data, error } = await (await client()).storage.from(CLOUD_BUCKET).download(project.storage_path)
  fail('Téléchargement impossible', error)
  return new Uint8Array(await (data as Blob).arrayBuffer())
}

export async function deleteCloud(project: CloudProject): Promise<void> {
  const sb = await client()
  const rm = await sb.storage.from(CLOUD_BUCKET).remove([project.storage_path])
  fail('Suppression du fichier impossible', rm.error)
  const { error } = await sb.from('geo_projects').delete().eq('id', project.id)
  fail('Suppression impossible', error)
}

// ---------------------------------------------------------------------------
// Compte, profil et administration
// ---------------------------------------------------------------------------

export interface Profile {
  email: string
  full_name: string | null
  organisation: string | null
  role: 'user' | 'admin'
}

/** Enregistre la dernière activité et renvoie le rôle (« user » si la base n'est pas encore configurée). */
export async function touch(): Promise<'user' | 'admin'> {
  const { data, error } = await (await client()).rpc('geo_touch')
  if (error) return 'user'
  return data === 'admin' ? 'admin' : 'user'
}

export async function getProfile(): Promise<Profile | null> {
  const user = await currentUser()
  if (!user) return null
  const { data } = await (await client()).from('geo_profiles').select('email,full_name,organisation,role').eq('id', user.id).maybeSingle()
  return (data as Profile | null) ?? { email: user.email, full_name: null, organisation: null, role: 'user' }
}

export async function updateProfile(p: { full_name: string; organisation: string }): Promise<void> {
  const user = await currentUser()
  if (!user) throw new Error('Non connecté.')
  const { error } = await (await client()).from('geo_profiles').update(p).eq('id', user.id)
  fail('Mise à jour du profil impossible', error)
}

export async function claimAdmin(code: string): Promise<boolean> {
  const { data, error } = await (await client()).rpc('geo_claim_admin', { code: code.trim() })
  fail('Vérification du code impossible', error)
  return data === true
}

export interface AdminRow {
  id: string
  email: string
  full_name: string | null
  organisation: string | null
  role: 'user' | 'admin'
  created_at: string
  last_sign_in_at: string | null
  last_seen_at: string | null
  projects: number
  storage_bytes: number
}

export async function adminOverview(): Promise<AdminRow[]> {
  const { data, error } = await (await client()).rpc('geo_admin_overview')
  fail('Lecture des comptes impossible', error)
  return (data ?? []) as AdminRow[]
}

export async function adminSetRole(id: string, role: 'user' | 'admin'): Promise<void> {
  const { error } = await (await client()).rpc('geo_admin_set_role', { target: id, new_role: role })
  fail('Changement de rôle impossible', error)
}

export async function resetPassword(email: string): Promise<void> {
  const { error } = await (await client()).auth.resetPasswordForEmail(email, { redirectTo: location.origin })
  fail('Envoi du courriel impossible', error)
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await (await client()).auth.updateUser({ password })
  fail('Changement de mot de passe impossible', error)
}
