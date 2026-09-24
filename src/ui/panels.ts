// Génération HTML des panneaux contextuels et des fenêtres d'information.
import { AGES, DEMOGRAPHY, EDUCATION, NODES, RES_KEYS, RES_LABEL, SEASONS, UNLOCKS, VICTORY, type Cost } from '../config/balance';
import { BUILDINGS, FARM_WATER_PER_FOOD, JOB_LABEL, WELL_NEAR_WATER_BONUS, type BuildingType } from '../config/buildings';
import {
  averageHappiness,
  birthBlockers,
  childClass,
  EVENT_DESC,
  EVENT_LABEL,
  happinessParts,
  harvestableNodes,
  healthTarget,
  wellNearWater,
} from '../sim/logic';
import type { Building, Citizen } from '../sim/types';
import type { Game } from '../sim/world';
import { iconURL, spriteURL, buildingSprite, type IconKind } from '../render/sprites';
import { esc, fmt, signed } from './dom';

export const RES_ICON: Record<string, IconKind> = { food: 'food', water: 'water', wood: 'wood', stone: 'stone' };

export function icon(kind: IconKind, cls = 'ico'): string {
  return `<img class="${cls}" src="${iconURL(kind)}" alt="">`;
}

export function costHTML(g: Game, cost: Cost, compare = true): string {
  const parts = RES_KEYS.filter((k) => cost[k]).map((k) => {
    const lack = compare && (cost[k] ?? 0) > g.s.stock[k] + 1e-9;
    return `<span class="cost${lack ? ' lack' : ''}">${icon(RES_ICON[k])}${cost[k]}</span>`;
  });
  return parts.length ? parts.join(' ') : '<span class="muted">Gratuit</span>';
}

export function buildingThumb(type: BuildingType): string {
  const d = BUILDINGS[type];
  return spriteURL('thumb_' + type, () => buildingSprite(type, 1, d.w, d.h, 0));
}

function bar(value: number, max = 100, cls = ''): string {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const col = pct >= 66 ? 'good' : pct >= 40 ? 'mid' : 'bad';
  return `<div class="bar ${cls} ${col}"><div style="width:${pct.toFixed(1)}%"></div></div>`;
}

export function citizenLink(c: Citizen | undefined): string {
  if (!c) return '<span class="muted">—</span>';
  return `<a data-act="sel-cit" data-id="${c.id}">${esc(c.first)} ${esc(c.last)}</a>`;
}
function buildingLink(g: Game, id: number | null): string {
  if (id === null) return '<span class="muted">—</span>';
  const b = g.bById.get(id);
  if (!b) return '<span class="muted">—</span>';
  return `<a data-act="sel-bld" data-id="${b.id}">${esc(BUILDINGS[b.type].name)}</a>`;
}

export function ageClassLabel(c: Citizen): string {
  switch (childClass(c)) {
    case 'baby':
      return 'Petite enfance';
    case 'child':
      return 'Enfant scolarisable';
    case 'adult':
      return 'Adulte';
    default:
      return 'Retraité(e)';
  }
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Actif',
  disconnected: 'Déconnecté',
  nostaff: 'Sans personnel',
  noresource: 'Sans ressource',
  full: 'Capacité saturée',
};

// ---------------------------------------------------------------- bâtiment
export function buildingPanel(g: Game, b: Building): string {
  const def = BUILDINGS[b.type];
  const st = g.status.get(b.id);
  const connected = g.connected.has(b.id);
  let h = `<div class="ph"><img class="thumb" src="${buildingThumb(b.type)}" alt=""><div><h2>${esc(def.name)}</h2><div class="sub">Niveau ${b.level}${def.upgradeCost ? ' / 3' : ''} · ${def.w}×${def.h}</div></div><button class="x" data-act="close">✕</button></div>`;
  if (st) {
    const cls = st.status === 'active' ? 'ok' : st.status === 'full' ? 'warn' : 'bad';
    const label = b.type === 'house' ? (st.status === 'full' ? 'Pleine' : 'Places libres') : STATUS_LABEL[st.status];
    h += `<div class="status ${cls}"><b>${label}</b> — ${esc(st.msg)}</div>`;
  }
  if (def.needsRoad || b.type === 'house')
    h += `<div class="row"><span>Réseau routier</span><b class="${connected ? 'okc' : 'badc'}">${connected ? 'Relié à l’hôtel de ville' : 'Non relié'}</b></div>`;
  h += `<p class="desc">${esc(def.desc)}</p>`;

  // Personnel
  const cap = g.jobCap(b);
  if (cap > 0) {
    const avail = g.availableAdults().length;
    h += `<h3>Personnel — ${def.job ? JOB_LABEL[def.job] : ''}</h3>`;
    h += `<div class="workers"><button data-act="rm-worker" data-id="${b.id}" ${b.workers.length || b.target ? '' : 'disabled'}>−</button><b>${b.workers.length} / ${cap}</b><button data-act="add-worker" data-id="${b.id}" ${b.workers.length < cap && avail ? '' : 'disabled'} title="${avail ? '' : 'Aucun adulte disponible'}">+</button><span class="muted">${avail} adulte(s) disponible(s)</span></div>`;
    if (b.target > b.workers.length) h += `<div class="note">${b.target - b.workers.length} poste(s) vacant(s) : remplacement automatique dès qu’un adulte est libre.</div>`;
    if (b.workers.length) {
      h += '<ul class="people">';
      for (const id of b.workers) {
        const c = g.cById.get(id);
        if (c) h += `<li>${citizenLink(c)} <span class="muted">${Math.floor(c.age)} ans · éduc. ${Math.round(c.education * 100)} %</span></li>`;
      }
      h += '</ul>';
    }
  }

  // Effets spécifiques
  h += '<h3>Effets</h3><ul class="facts">';
  const rate = g.buildingRate.get(b.id) ?? 0;
  switch (b.type) {
    case 'townhall':
      h += `<li>Stockage : ${RES_KEYS.map((k) => `${RES_LABEL[k]} ${g.capacity[k]}`).join(', ')}</li><li>Racine du réseau routier.</li>`;
      break;
    case 'house': {
      const res = g.residents(b.id);
      h += `<li>Habitants : <b>${res.length} / ${g.housingCap(b)}</b>${b.reserved ? ` (+${b.reserved} place(s) réservée(s) pour une naissance)` : ''}</li>`;
      h += `<li>Autel : ${g.altarOf.has(b.id) ? buildingLink(g, g.altarOf.get(b.id)!) : '<span class="badc">non desservie</span>'}</li>`;
      h += `<li>Dispensaire : ${g.clinicOf.has(b.id) ? buildingLink(g, g.clinicOf.get(b.id)!) : '<span class="muted">non desservie</span>'}</li>`;
      h += `<li>Jardins : ${g.gardenBonus.has(b.id) ? '+' + g.gardenBonus.get(b.id) + ' bonheur' : '<span class="muted">aucun</span>'}</li>`;
      h += '</ul>';
      if (res.length) {
        h += '<h3>Foyer</h3><ul class="people">';
        for (const c of res)
          h += `<li>${citizenLink(c)} <span class="muted">${Math.floor(c.age)} ans · ${c.sex === 'F' ? '♀' : '♂'} · bonheur ${Math.round(c.happiness)}</span>${c.pregnancy ? ' ' + icon('baby') : ''}</li>`;
        h += '</ul>';
        const { parts } = happinessParts(g, res[0]);
        h += '<h3>Bonheur lié au logement</h3><ul class="parts">';
        for (const p of parts.filter((p) => /Logement|Maison|autel|Autel|Jardin|surpeuplé|Sans abri/.test(p.label)))
          h += `<li><span>${esc(p.label)}</span><b class="${p.value >= 0 ? 'okc' : 'badc'}">${signed(p.value)}</b></li>`;
      }
      h += '<ul class="facts">';
      break;
    }
    case 'woodcutter':
    case 'stonecutter': {
      const nodes = harvestableNodes(g, b);
      const stock = nodes.reduce((a, id) => a + g.s.nodes[id].stock, 0);
      h += `<li>Production récente : <b>${rate.toFixed(0)} ${b.type === 'woodcutter' ? 'bois' : 'pierre'}/an</b></li>`;
      h += `<li>Rayon : ${g.radius(b)} cases — ${nodes.length} ${b.type === 'woodcutter' ? 'arbre(s)' : 'gisement(s)'} accessible(s), ${Math.floor(stock)} unités</li>`;
      h += `<li>Rendement : ${def.rate} par travailleur et par an × ${def.levelMult![b.level - 1]}</li>`;
      break;
    }
    case 'gatherer':
    case 'farm': {
      const s = SEASONS[g.seasonIndex];
      h += `<li>Production récente : <b>${rate.toFixed(0)} nourriture/an</b></li>`;
      h += `<li>Saison (${s.name}) : ×${b.type === 'farm' ? s.farmMult : s.gatherMult}</li>`;
      h += `<li>Rendement : ${def.rate} par travailleur et par an × ${def.levelMult![b.level - 1]}</li>`;
      if (b.type === 'farm') h += `<li>Irrigation : ${FARM_WATER_PER_FOOD} eau par unité produite</li>`;
      break;
    }
    case 'well':
      h += `<li>Production récente : <b>${rate.toFixed(0)} eau/an</b></li>`;
      h += `<li>${wellNearWater(g, b) ? `Eau à proximité : +${WELL_NEAR_WATER_BONUS * 100} %` : 'Pas d’étendue d’eau à 4 cases : rendement normal'}</li>`;
      break;
    case 'granary':
      h += `<li>Stockage : +${[150, 260, 400][b.level - 1]} par ressource ${connected ? '' : '<span class="badc">(inactif : non relié)</span>'}</li>`;
      break;
    case 'altar': {
      const l = g.altarLoad.get(b.id);
      h += `<li>Rayon : ${g.radius(b)} cases · bonheur +${def.bonus![b.level - 1]}</li>`;
      h += `<li>Fidèles desservis : <b>${l?.served ?? 0} / ${def.users![b.level - 1]}</b>${l && l.demand > l.served ? ` <span class="badc">(${l.demand - l.served} en attente)</span>` : ''}</li>`;
      h += `<li>Une maison ne profite que d’un seul autel.</li>`;
      break;
    }
    case 'school': {
      const l = g.schoolLoad.get(b.id);
      h += `<li>Élèves : <b>${l?.students ?? 0} / ${l?.capacity ?? 0}</b> (max ${def.users![b.level - 1]}, ${EDUCATION.studentsPerTeacher} par enseignant)</li>`;
      h += `<li>Scolarité complète en ${EDUCATION.yearsForFull} ans (× ${def.levelMult![b.level - 1]}) : +${EDUCATION.productivityBonus * 100} % de productivité adulte</li>`;
      break;
    }
    case 'clinic': {
      const l = g.clinicLoad.get(b.id);
      h += `<li>Rayon : ${g.radius(b)} cases · habitants soignés <b>${l?.served ?? 0} / ${l?.capacity ?? 0}</b></li>`;
      h += `<li>Santé cible 96 au lieu de 80, récupération plus rapide, protège des maladies.</li>`;
      break;
    }
    case 'garden':
      h += `<li>Rayon : ${g.radius(b)} cases · bonheur +${def.bonus![b.level - 1]} (plafond global jardins +10)</li>`;
      break;
  }
  h += '</ul>';

  // Amélioration
  if (def.upgradeCost) {
    if (b.level < 3) {
      const chk = g.upgradeCheck(b);
      h += `<h3>Amélioration → niveau ${b.level + 1}</h3><p class="desc">${esc(def.levelDesc[b.level])}</p>`;
      h += `<div class="actions"><button class="primary" data-act="upgrade" data-id="${b.id}" ${chk.ok ? '' : 'disabled'}>Améliorer</button> ${costHTML(g, def.upgradeCost[b.level - 1])}</div>`;
      if (!chk.ok && chk.reason) h += `<div class="note bad">${esc(chk.reason)}</div>`;
    } else h += '<div class="note">Niveau maximal atteint.</div>';
  }
  if (def.demolishable) {
    const refund = g.refundFor(b);
    h += `<div class="actions end"><button class="danger" data-act="demolish" data-id="${b.id}">Démolir</button> <span class="muted">Remboursement : ${costHTML(g, refund, false)}</span></div>`;
  } else h += '<div class="note">Ce bâtiment ne peut pas être démoli.</div>';
  return h;
}

// ---------------------------------------------------------------- habitant
export function citizenPanel(g: Game, c: Citizen): string {
  const { parts, target } = happinessParts(g, c);
  let h = `<div class="ph"><img class="thumb small" src="${iconURL(c.age < AGES.ADULT ? 'child' : c.age >= AGES.RETIRE ? 'elder' : 'pop')}" alt=""><div><h2>${esc(c.first)} ${esc(c.last)}</h2><div class="sub">${c.sex === 'F' ? 'Femme' : 'Homme'} · ${Math.floor(c.age)} ans · ${ageClassLabel(c)}</div></div><button class="x" data-act="close">✕</button></div>`;
  h += `<div class="row"><span>${icon('health')} Santé</span><b>${Math.round(c.health)}</b></div>${bar(c.health)}`;
  h += `<div class="note">Santé visée : ${Math.round(healthTarget(g, c))}${g.s.shortage.food > 0 || g.s.shortage.water > 0 ? ' — la pénurie empêche toute récupération' : ''}</div>`;
  h += `<div class="row"><span>${icon('happy')} Bonheur</span><b>${Math.round(c.happiness)} <span class="muted">→ ${Math.round(target)}</span></b></div>${bar(c.happiness)}`;
  h += '<ul class="parts">';
  for (const p of parts) h += `<li><span>${esc(p.label)}</span><b class="${p.value >= 0 ? 'okc' : 'badc'}">${signed(p.value)}</b></li>`;
  h += `<li class="total"><span>Total (plafonné 0–100)</span><b>${Math.round(target)}</b></li></ul>`;
  h += '<h3>Situation</h3><ul class="facts">';
  h += `<li>Logement : ${c.houseId !== null ? buildingLink(g, c.houseId) : '<span class="badc">sans abri</span>'}</li>`;
  const job = c.jobId !== null ? g.bById.get(c.jobId) : undefined;
  h += `<li>Métier : ${job && BUILDINGS[job.type].job ? `${JOB_LABEL[BUILDINGS[job.type].job!]} (${buildingLink(g, job.id)})` : c.age >= AGES.RETIRE ? 'Retraité(e)' : c.age >= AGES.ADULT ? '<span class="muted">sans emploi</span>' : '<span class="muted">trop jeune</span>'}</li>`;
  const school = g.schoolOf.get(c.id);
  h += `<li>Éducation : <b>${Math.round(c.education * 100)} %</b>${school !== undefined ? ` — scolarisé(e) (${buildingLink(g, school)})` : c.age >= AGES.CHILD && c.age < AGES.ADULT ? ' — <span class="badc">non scolarisé(e)</span>' : ''}</li>`;
  if (c.age >= AGES.ADULT) h += `<li>Productivité : ×${(1 + EDUCATION.productivityBonus * c.education).toFixed(2)}</li>`;
  h += '</ul><h3>Famille</h3><ul class="facts">';
  h += `<li>Conjoint(e) : ${c.partnerId !== null ? citizenLink(g.cById.get(c.partnerId)) : '<span class="muted">—</span>'}</li>`;
  const father = c.fatherId !== null ? g.cById.get(c.fatherId) : undefined;
  const mother = c.motherId !== null ? g.cById.get(c.motherId) : undefined;
  if (c.fatherId !== null || c.motherId !== null)
    h += `<li>Parents : ${father ? citizenLink(father) : c.fatherId !== null ? '<span class="muted">défunt</span>' : ''} ${mother ? citizenLink(mother) : c.motherId !== null ? '<span class="muted">défunte</span>' : ''}</li>`;
  else h += '<li>Parents : <span class="muted">colon fondateur</span></li>';
  const kids = g.s.citizens.filter((k) => k.fatherId === c.id || k.motherId === c.id);
  h += `<li>Enfants : ${kids.length ? kids.map((k) => citizenLink(k)).join(', ') : '<span class="muted">aucun</span>'}</li>`;
  if (c.pregnancy) h += `<li>${icon('baby')} Naissance attendue dans ${Math.max(0, c.pregnancy.remaining * 12).toFixed(0)} mois ${c.pregnancy.houseId !== null ? '(place réservée)' : '<span class="badc">(aucune place réservée)</span>'}</li>`;
  h += '</ul>';
  if (c.sex === 'F' && c.partnerId !== null && !c.pregnancy && c.age <= AGES.FERTILE_MAX) {
    const bl = birthBlockers(g, c);
    h += `<h3>Naissance</h3><div class="note ${bl.length ? 'bad' : ''}">${bl.length ? 'Conditions manquantes : ' + bl.join(', ') + '.' : 'Toutes les conditions sont réunies : une naissance peut survenir.'}</div>`;
  }
  return h;
}

export function nodePanel(g: Game, x: number, y: number): string {
  const n = g.nodeAtTile(x, y);
  if (!n) return '';
  const tree = n.kind === 'tree';
  const stateLabel = n.state === 'ok' ? 'Exploitable' : n.state === 'depleted' ? (tree ? 'Souche (abattu)' : 'Épuisé') : 'En reconstitution';
  let h = `<div class="ph"><img class="thumb small" src="${iconURL(tree ? 'wood' : 'stone')}" alt=""><div><h2>${tree ? 'Arbre' : 'Gisement de pierre'}</h2><div class="sub">${stateLabel}</div></div><button class="x" data-act="close">✕</button></div>`;
  h += `<div class="row"><span>Stock</span><b>${Math.floor(n.stock)} / ${n.max}</b></div>${bar(n.stock, n.max)}`;
  h += '<ul class="facts">';
  if (n.state === 'depleted') h += `<li>Reconstitution dans ${Math.max(0, n.timer).toFixed(1)} an(s).</li>`;
  if (n.state === 'growing') h += `<li>Pleinement exploitable dans ${Math.max(0, n.timer).toFixed(1)} an(s).</li>`;
  h += `<li>${tree ? `Repousse ${NODES.treeRegrowDelay} ans après l’abattage, puis grandit ${NODES.treeGrowYears} an(s).` : `Se reconstitue lentement (${NODES.rockRegrowDelay} + ${NODES.rockGrowYears} ans) : convention de jeu.`}</li>`;
  h += `<li>${g.owned(x, y) ? 'Dans le territoire.' : '<span class="badc">Hors territoire : inexploitable.</span>'}</li>`;
  if (n.state === 'depleted') h += '<li>Une construction sur cet emplacement supprime définitivement la ressource.</li>';
  h += '</ul>';
  return h;
}

export function parcelPanel(g: Game, idx: number): string {
  const P = g.N / 16;
  const px = idx % P;
  const py = Math.floor(idx / P);
  const chk = g.parcelCheck(px, py);
  let trees = 0;
  let rocks = 0;
  let water = 0;
  for (let y = py * 16; y < py * 16 + 16; y++)
    for (let x = px * 16; x < px * 16 + 16; x++) {
      const n = g.nodeAtTile(x, y);
      if (n && n.state !== 'depleted') n.kind === 'tree' ? trees++ : rocks++;
      if (g.s.terrain[y * g.N + x] === 1) water++;
    }
  let h = `<div class="ph"><img class="thumb small" src="${iconURL('parcel')}" alt=""><div><h2>Parcelle ${px + 1}-${py + 1}</h2><div class="sub">${g.s.parcels[idx] ? 'Acquise' : 'Verrouillée'}</div></div><button class="x" data-act="close">✕</button></div>`;
  h += `<ul class="facts"><li>Arbres : ${trees} · Gisements : ${rocks} · Cases d’eau : ${water}</li><li>Parcelles achetées : ${g.s.parcelsBought} (le prix augmente à chaque achat)</li></ul>`;
  if (!g.s.parcels[idx]) {
    h += `<h3>Acquérir</h3><div class="actions"><button class="primary" data-act="buy-parcel" data-id="${idx}" ${chk.ok ? '' : 'disabled'}>Acheter</button> ${costHTML(g, chk.cost)}</div>`;
    if (!chk.ok && chk.reason) h += `<div class="note bad">${esc(chk.reason)}</div>`;
  }
  return h;
}

// ---------------------------------------------------------------- tableau de population
export function populationModal(g: Game): string {
  const cs = g.s.citizens;
  const babies = cs.filter((c) => c.age < AGES.CHILD).length;
  const kids = cs.filter((c) => c.age >= AGES.CHILD && c.age < AGES.ADULT).length;
  const adults = cs.filter((c) => g.isAdultWorker(c));
  const workers = adults.filter((c) => c.jobId !== null).length;
  const elders = cs.filter((c) => c.age >= AGES.RETIRE).length;
  const schooled = g.schoolOf.size;
  let h = '<h2>Population et emplois</h2>';
  h += `<div class="stats">
    <div>${icon('pop')}<b>${cs.length}</b><span>Habitants</span></div>
    <div>${icon('baby')}<b>${babies}</b><span>0–5 ans</span></div>
    <div>${icon('child')}<b>${kids}</b><span>6–17 ans (${schooled} scolarisés)</span></div>
    <div>${icon('pop')}<b>${adults.length - workers}</b><span>Adultes disponibles</span></div>
    <div>${icon('work')}<b>${workers}</b><span>Travailleurs</span></div>
    <div>${icon('elder')}<b>${elders}</b><span>Retraités</span></div>
    <div>${icon('happy')}<b>${Math.round(averageHappiness(g))} %</b><span>Bonheur moyen</span></div>
  </div>`;
  h += '<h3>Emplois</h3><table class="tbl"><thead><tr><th>Bâtiment</th><th>Métier</th><th>État</th><th>Personnel</th><th></th></tr></thead><tbody>';
  const jobs = g.s.buildings.filter((b) => g.jobCap(b) > 0).sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id);
  if (!jobs.length) h += '<tr><td colspan="5" class="muted">Aucun bâtiment n’emploie de travailleurs pour l’instant.</td></tr>';
  for (const b of jobs) {
    const st = g.status.get(b.id);
    h += `<tr><td><a data-act="goto-bld" data-id="${b.id}">${esc(BUILDINGS[b.type].name)}</a> <span class="muted">niv. ${b.level}</span></td><td>${JOB_LABEL[BUILDINGS[b.type].job!]}</td><td class="${st?.status === 'active' ? 'okc' : 'badc'}">${STATUS_LABEL[st?.status ?? 'active']}</td><td><b>${b.workers.length}/${g.jobCap(b)}</b></td><td class="nowrap"><button data-act="rm-worker" data-id="${b.id}" ${b.workers.length ? '' : 'disabled'}>−</button><button data-act="add-worker" data-id="${b.id}" ${b.workers.length < g.jobCap(b) && adults.length - workers > 0 ? '' : 'disabled'}>+</button></td></tr>`;
  }
  h += '</tbody></table>';
  h += '<h3>Habitants</h3><div class="scroll"><table class="tbl"><thead><tr><th>Nom</th><th>Âge</th><th>Métier</th><th>Logement</th><th>Santé</th><th>Bonheur</th><th>Éduc.</th></tr></thead><tbody>';
  for (const c of [...cs].sort((a, b) => b.age - a.age)) {
    const job = c.jobId !== null ? g.bById.get(c.jobId) : undefined;
    h += `<tr><td>${citizenLink(c)}${c.pregnancy ? ' ' + icon('baby') : ''}</td><td>${Math.floor(c.age)}</td><td>${job ? JOB_LABEL[BUILDINGS[job.type].job!] : c.age >= AGES.RETIRE ? 'Retraite' : c.age >= AGES.ADULT ? '<span class="muted">—</span>' : g.schoolOf.has(c.id) ? 'Élève' : '<span class="muted">Enfant</span>'}</td><td>${c.houseId !== null ? 'Maison' : '<span class="badc">Sans abri</span>'}</td><td>${Math.round(c.health)}</td><td>${Math.round(c.happiness)}</td><td>${Math.round(c.education * 100)} %</td></tr>`;
  }
  h += '</tbody></table></div>';
  return h;
}

export function objectivesModal(g: Game): string {
  const p = g.s.progress;
  const pop = g.s.citizens.length;
  const hap = averageHappiness(g);
  let h = '<h2>Objectifs et progression</h2>';
  h += `<h3>Victoire</h3><p>Atteindre <b>${VICTORY.population} habitants</b> et maintenir pendant <b>${VICTORY.holdYears} années</b> un bonheur moyen d’au moins <b>${VICTORY.happiness} %</b>, sans pénurie de nourriture ni d’eau.</p>`;
  h += `<ul class="checks">
    <li class="${pop >= VICTORY.population ? 'done' : ''}">Population : ${pop} / ${VICTORY.population}</li>
    <li class="${hap >= VICTORY.happiness ? 'done' : ''}">Bonheur moyen : ${Math.round(hap)} % / ${VICTORY.happiness} %</li>
    <li class="${g.s.shortage.food === 0 && g.s.shortage.water === 0 ? 'done' : ''}">Aucune pénurie de nourriture ni d’eau</li>
    <li class="${p.victory ? 'done' : ''}">Maintien : ${p.victory ? 'accompli' : `${p.victoryHold.toFixed(1)} / ${VICTORY.holdYears} ans`}</li>
  </ul>`;
  if (p.victory) h += '<p class="okc"><b>Victoire obtenue !</b> Vous jouez en mode libre.</p>';
  h += '<h3>Paliers de population</h3><ul class="checks">';
  for (const u of UNLOCKS) {
    const items = u.buildings.map((b) => BUILDINGS[b as BuildingType].name);
    if (u.maxLevel > 1) items.push(`améliorations niveau ${u.maxLevel}`);
    h += `<li class="${p.maxPop >= u.pop ? 'done' : ''}"><b>${u.pop ? u.pop + ' habitants' : 'Départ'}</b> : ${items.join(', ')}</li>`;
  }
  h += '</ul>';
  h += `<h3>Démographie</h3><ul class="facts"><li>Naissances : ${p.births} · Décès : ${p.deaths} · Record de population : ${p.maxPop}</li>
  <li>Âge fertile : ${AGES.FERTILE_MIN}–${AGES.FERTILE_MAX} ans · grossesse ${Math.round(DEMOGRAPHY.pregnancyYears * 12)} mois · intervalle minimal ${DEMOGRAPHY.birthCooldown} ans</li>
  <li>Une naissance exige : une place libre dans la maison, bonheur du couple ≥ ${DEMOGRAPHY.minHappiness}, santé ≥ ${DEMOGRAPHY.minHealth}, réserves de nourriture et d’eau ≥ ${DEMOGRAPHY.minFoodStock}.</li></ul>`;
  if (g.s.events.length) {
    h += '<h3>Événements en cours</h3><ul class="facts">';
    for (const e of g.s.events) h += `<li><b>${EVENT_LABEL[e.kind]}</b> — ${EVENT_DESC[e.kind]} (encore ${Math.ceil(e.remaining * 12)} mois)</li>`;
    h += '</ul>';
  }
  return h;
}

export function helpModal(): string {
  return `<h2>Aide</h2>
  <h3>Commandes</h3>
  <table class="tbl keys"><tbody>
  <tr><td>Clic gauche</td><td>Sélectionner, construire, tracer une route (maintenir et glisser)</td></tr>
  <tr><td>Clic droit ou molette maintenus</td><td>Déplacer la caméra</td></tr>
  <tr><td>Z Q S D / flèches</td><td>Déplacer la caméra (W A S D sur clavier QWERTY)</td></tr>
  <tr><td>Molette</td><td>Zoom centré sur le pointeur</td></tr>
  <tr><td>R</td><td>Pivoter le bâtiment à placer</td></tr>
  <tr><td>Échap</td><td>Annuler l’action en cours / fermer / menu</td></tr>
  <tr><td>Espace</td><td>Pause / reprise</td></tr>
  <tr><td>1, 2, 3</td><td>Vitesse ×1, ×2, ×4</td></tr>
  <tr><td>C</td><td>Recentrer sur l’hôtel de ville</td></tr>
  <tr><td>P</td><td>Population et emplois</td></tr>
  <tr><td>Écran tactile</td><td>Glisser un doigt : déplacer · pincer : zoomer · toucher : action</td></tr>
  </tbody></table>
  <h3>Règles essentielles</h3>
  <ul class="facts">
  <li>Un bâtiment est <b>relié</b> si une route touchant son pourtour rejoint l’hôtel de ville. Exploitations, services et greniers doivent être reliés.</li>
  <li>La production dépend du <b>personnel affecté</b> (boutons + et −). Sans travailleur, aucune production.</li>
  <li>Bûcherons et tailleurs exploitent les arbres et gisements <b>accessibles</b> dans leur rayon ; les stocks s’épuisent puis se reconstituent.</li>
  <li>Chaque habitant consomme nourriture et eau (les enfants moitié moins). En hiver, les maisons consomment du bois.</li>
  <li>Une pénurie fait chuter santé et bonheur ; si elle dure, des habitants meurent.</li>
  <li>Les couples ont des enfants s’ils disposent d’une <b>place libre</b> dans leur maison, d’assez de bonheur, de santé et de réserves.</li>
  <li>Les enfants de 6 à 17 ans vont à l’école s’il y a des enseignants ; ils deviennent adultes à 18 ans et prennent leur retraite à 65 ans.</li>
  <li>Achetez des parcelles adjacentes (outil Parcelles) pour agrandir le territoire.</li>
  <li>Une année dure environ une minute à vitesse ×1. Saisons : ${SEASONS.map((s) => `<b>${s.name}</b> (${s.effects.split(':')[1] ?? s.effects})`).join(' ; ')}</li>
  </ul>`;
}

export function fmtCostPlain(cost: Cost): string {
  const parts = RES_KEYS.filter((k) => cost[k]).map((k) => `${cost[k]} ${RES_LABEL[k].toLowerCase()}`);
  return parts.join(', ') || 'gratuit';
}

export { fmt };
