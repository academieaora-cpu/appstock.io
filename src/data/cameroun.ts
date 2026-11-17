/**
 * Découpage administratif du Cameroun : 10 régions, 58 départements, 360 arrondissements
 * (communes). Source : liste des communes du Cameroun (Wikipédia, état au 31 décembre 2013),
 * vérifiée région par région. Sert aux listes déroulantes de la mise en page ; une saisie
 * libre reste toujours possible.
 */
const RAW = `
Adamaoua | Djérem | Ngaoundal, Tibati
Adamaoua | Faro-et-Déo | Galim-Tignère, Kontcha, Mayo-Baléo, Tignère
Adamaoua | Mayo-Banyo | Bankim, Banyo, Mayo-Darlé
Adamaoua | Mbéré | Dir, Djohong, Meiganga, Ngaoui
Adamaoua | Vina | Belel, Martap, Mbe, Nganha, Ngaoundéré Ier, Ngaoundéré IIe, Ngaoundéré IIIe, Nyambaka
Centre | Haute-Sanaga | Bibey, Lembe-Yezoum, Mbandjock, Minta, Nanga-Eboko, Nkoteng, Nsem
Centre | Lekié | Batchenga, Ebebda, Elig-Mfomo, Evodoula, Lobo, Monatélé, Obala, Okola, Sa'a
Centre | Mbam-et-Inoubou | Bafia, Bokito, Deuk, Kiiki, Kon-Yambetta, Makénéné, Ndikiniméki, Ombessa
Centre | Mbam-et-Kim | Mbangassina, Ngambè-Tikar, Ngoro, Ntui, Yoko
Centre | Méfou-et-Afamba | Afanloum, Awaé, Edzendouan, Esse, Mfou, Nkolafamba, Olanguina, Soa
Centre | Méfou-et-Akono | Akono, Bikok, Mbankomo, Ngoumou
Centre | Mfoundi | Yaoundé Ier, Yaoundé IIe, Yaoundé IIIe, Yaoundé IVe, Yaoundé Ve, Yaoundé VIe, Yaoundé VIIe
Centre | Nyong-et-Kéllé | Biyouha, Bondjock, Bot-Makak, Dibang, Éséka, Makak, Matomb, Messondo, Ngog-Mapubi, Ngui-Bassal
Centre | Nyong-et-Mfoumou | Akonolinga, Ayos, Endom, Kobdombo, Mengang
Centre | Nyong-et-So'o | Akoeman, Dzeng, Mbalmayo, Mengueme, Ngomedzap, Nkolmetet
Est | Boumba-et-Ngoko | Gari-Gombo, Moloundou, Salapoumbé, Yokadouma
Est | Haut-Nyong | Abong-Mbang, Angossas, Atok, Dimako, Doumaintang, Doumé, Lomié, Mboma, Messamena, Messok, Mindourou, Ngoyla, Nguelemendouka, Somalomo
Est | Kadey | Batouri, Kentzou, Kette, Mbang, Ndelele, Nguelebok, Ouli
Est | Lom-et-Djérem | Bélabo, Bertoua Ier, Bertoua IIe, Bétaré-Oya, Diang, Garoua-Boulaï, Mandjou, Ngoura
Extrême-Nord | Diamaré | Bogo, Dargala, Gazawa, Maroua Ier, Maroua IIe, Maroua IIIe, Meri, Ndoukoula, Petté
Extrême-Nord | Logone-et-Chari | Blangoua, Darak, Fotokol, Goulfey, Hile-Alifa, Kousséri, Logone-Birni, Makary, Waza, Zina
Extrême-Nord | Mayo-Danay | Datcheka, Gobo, Guémé, Guéré, Kai-Kai, Kalfou, Kar-Hay, Maga, Tchati-Bali, Vele, Wina, Yagoua
Extrême-Nord | Mayo-Kani | Dziguilao, Guidiguis, Kaélé, Mindif, Moulvoudaye, Moutourwa, Touloum
Extrême-Nord | Mayo-Sava | Kolofata, Mora, Tokombéré
Extrême-Nord | Mayo-Tsanaga | Bourrha, Hina, Koza, Mogodé, Mokolo, Mozogo, Soulédé-Roua
Littoral | Moungo | Baré, Bonaléa, Dibombari, Ebone, Loum, Manjo, Mbanga, Melong, Mombo, Nkongsamba Ier, Nkongsamba IIe, Nkongsamba IIIe, Penja
Littoral | Nkam | Ndobian, Nkondjock, Yabassi, Yingui
Littoral | Sanaga-Maritime | Dibamba, Dizangué, Édéa Ier, Édéa IIe, Massock-Songloulou, Mouanko, Ndom, Ngambe, Ngwei, Nyanon, Pouma
Littoral | Wouri | Douala Ier, Douala IIe, Douala IIIe, Douala IVe, Douala Ve, Douala VIe
Nord | Bénoué | Barndaké, Bashéo, Bibemi, Dembo, Garoua Ier, Garoua IIe, Garoua IIIe, Gashiga, Lagdo, Ngong, Pitoa, Touroua
Nord | Faro | Beka, Poli
Nord | Mayo-Louti | Figuil, Guider, Mayo-Oulo
Nord | Mayo-Rey | Madingring, Rey-Bouba, Tcholliré, Touboro
Nord-Ouest | Boyo | Belo, Fonfuka, Fundong, Njinikom
Nord-Ouest | Bui | Elak-Oku, Jakiri, Kumbo, Mbiame, Nkor, Nkum
Nord-Ouest | Donga-Mantung | Ako, Misaje, Ndu, Nkambé, Nwa
Nord-Ouest | Menchum | Benakuma, Furu-Awa, Wum, Zhoa
Nord-Ouest | Mezam | Bafut, Bali, Bamenda Ier, Bamenda IIe, Bamenda IIIe, Santa, Tubah
Nord-Ouest | Momo | Andek, Batibo, Mbengwi, Njikwa, Widikum-Boffe
Nord-Ouest | Ngo-Ketunjia | Babessi, Balikumbat, Ndop
Ouest | Bamboutos | Babadjou, Batcham, Galim, Mbouda
Ouest | Haut-Nkam | Bafang, Bakou, Bana, Bandja, Banka, Banwa, Kekem
Ouest | Hauts-Plateaux | Baham, Bamendjou, Bangou, Batié
Ouest | Koung-Khi | Bandjoun, Bayangam, Demdeng
Ouest | Menoua | Dschang, Fokoué, Fongo-Tongo, Nkong-Zem, Penka-Michel, Santchou
Ouest | Mifi | Bafoussam Ier, Bafoussam IIe, Bafoussam IIIe
Ouest | Ndé | Bangangté, Bassamba, Bazou, Tonga
Ouest | Noun | Bangourain, Foumban, Foumbot, Kouoptamo, Koutaba, Magba, Malentouen, Massangam, Njimom
Sud | Dja-et-Lobo | Bengbis, Djoum, Meyomessala, Meyomessi, Mintom, Oveng, Sangmélima, Zoétélé
Sud | Mvila | Biwong-Bane, Biwong-Bulu, Ebolowa Ier, Ebolowa IIe, Efoulan, Mengong, Mvangan, Ngoulemakong
Sud | Océan | Akom II, Bipindi, Campo, Kribi Ier, Kribi IIe, Lokoundjé, Lolodorf, Mvengue, Niete
Sud | Vallée-du-Ntem | Ambam, Kyé-Ossi, Ma'an, Olamze
Sud-Ouest | Fako | Buéa, Limbé Ier, Limbé IIe, Limbé IIIe, Muyuka, Tiko, West Coast
Sud-Ouest | Koupé-Manengouba | Bangem, Nguti, Tombel
Sud-Ouest | Lebialem | Alou, Menji, Wabane
Sud-Ouest | Manyu | Akwaya, Eyumodjock, Mamfé, Upper Bayang
Sud-Ouest | Meme | Konye, Kumba Ier, Kumba IIe, Kumba IIIe, Mbonge
Sud-Ouest | Ndian | Bamusso, Dikome-Balue, Ekondo-Titi, Idabato, Isanguele, Kombo-Abedimo, Kombo-Idinti, Mundemba, Toko
`

export interface Departement {
  nom: string
  arrondissements: string[]
}

export interface Region {
  nom: string
  departements: Departement[]
}

export const REGIONS: Region[] = (() => {
  const out: Region[] = []
  for (const line of RAW.split('\n')) {
    const parts = line.split('|').map((s) => s.trim())
    if (parts.length !== 3) continue
    const [r, d, list] = parts
    let region = out.find((x) => x.nom === r)
    if (!region) out.push((region = { nom: r, departements: [] }))
    region.departements.push({ nom: d, arrondissements: list.split(',').map((s) => s.trim()).filter(Boolean) })
  }
  return out
})()

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^(region|departement|arrondissement)\s+(du|de la|de l'|de|des)\s*/, '')
    .trim()

export function findRegion(name: string): Region | undefined {
  const n = norm(name)
  return n ? REGIONS.find((r) => norm(r.nom) === n) : undefined
}

export function findDepartement(name: string, region?: string): { region: Region; departement: Departement } | undefined {
  const n = norm(name)
  if (!n) return undefined
  const regions = region && findRegion(region) ? [findRegion(region)!] : REGIONS
  for (const r of regions) for (const d of r.departements) if (norm(d.nom) === n) return { region: r, departement: d }
  return undefined
}

/** Département et région d'un arrondissement (premier trouvé). */
export function findArrondissement(name: string): { region: Region; departement: Departement } | undefined {
  const n = norm(name)
  if (!n) return undefined
  for (const r of REGIONS) for (const d of r.departements) if (d.arrondissements.some((a) => norm(a) === n)) return { region: r, departement: d }
  return undefined
}
