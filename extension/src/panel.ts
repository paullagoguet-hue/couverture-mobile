/**
 * Panneau latéral : couverture des opérateurs à l'adresse sélectionnée.
 *
 * Reçoit le texte sélectionné via storage.session (déposé par background.ts),
 * le géocode, lit la couverture des couches au point trouvé, puis affiche un
 * tableau opérateurs × technos, le meilleur opérateur et une mini-carte.
 * Hors extension (tests), la requête peut être passée en paramètre : panel.html?q=…
 */
import {
  bestOperators,
  cleanAddress,
  communeToCoverage,
  CoverageReader,
  geocode,
  isUnambiguous,
  loadCommuneCoverage,
  loadManifest,
  operatorStatus,
  STATUS_COLORS,
  summarizeByOperator,
  type StatusKind,
  type GeocodeResult,
  type LayerCoverage,
  type Manifest,
} from '@couverture/core';

import { api, PENDING_KEY, type PendingQuery } from './browser.ts';
import { CARD_ENABLED_KEY } from './messages.ts';
import { DISCLAIMER, SITE_URL, TILES_BASE_URL } from './config.ts';
import { fillEncart } from './encart.ts';
import { MiniMap } from './minimap.ts';
import { SearchBox } from './search.ts';

const out = document.getElementById('result')!;
let reader = new CoverageReader(TILES_BASE_URL);
let manifestPromise: Promise<Manifest> | undefined;
let currentRun: AbortController | undefined;

/** Délai max pour lire la couverture (manifeste + tuiles des 8 couches). */
const COVERAGE_TIMEOUT_MS = 20_000;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Bandeau affiché au-dessus du résultat (ex. « Adresse lue sur la page : … »), HTML déjà échappé. */
let sourceNote = '';

/** Emplacement approximatif : couverture évaluée dans ce rayon (m) plutôt qu'en un point. */
let areaRadius: number | undefined;
/** Rayon par défaut si la page ne précise pas le sien (cf. radiusFor dans lodging.ts). */
const APPROX_RADIUS_M = 1000;

/** « 300 m », « 1 km », « 2 km ». */
const formatDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toLocaleString('fr-FR')} km` : `${m} m`);

function show(html: string) {
  out.innerHTML = (sourceNote ? `<p class="from-page">${sourceNote}</p>` : '') + html;
}

/** Point d'entrée : un texte sélectionné, saisi ou lu sur la page. */
async function run(text: string, note = '', radiusM?: number) {
  sourceNote = note;
  areaRadius = radiusM;
  search.setText(text);
  currentRun?.abort();
  const run = (currentRun = new AbortController());
  show(`<p class="status">Recherche de « ${escapeHtml(text)} »…</p>`);
  try {
    const results = await geocode(text, { limit: 5, signal: run.signal });
    if (!results.length) {
      show(`<p><strong>Adresse introuvable</strong> pour « ${escapeHtml(text)} ».</p>
            <p>Essayez de sélectionner une adresse complète ou un nom de commune.</p>`);
      return;
    }
    if (isUnambiguous(results)) return await showCoverage(results[0], run.signal);
    // Plusieurs lieux plausibles : l'utilisateur choisit.
    show(`<p>Plusieurs lieux correspondent à « ${escapeHtml(text)} » :</p>
          <ul class="choices">${results
            .map((r, i) => `<li><button data-i="${i}">${escapeHtml(r.label)}<small>${escapeHtml(r.context)}</small></button></li>`)
            .join('')}</ul>`);
    out.querySelectorAll<HTMLButtonElement>('.choices button').forEach((b) =>
      b.addEventListener('click', () => showCoverage(results[Number(b.dataset.i)], run.signal)),
    );
  } catch (err) {
    if (run.signal.aborted) return;
    console.error(err);
    show(`<p class="error"><strong>La recherche d'adresse a échoué.</strong><br />
      Le service de géocodage de l'IGN (data.geopf.fr) est injoignable.</p>
      <p class="source">Détail : ${escapeHtml((err as Error).message)}</p>`);
  }
}

/** Lit et affiche la couverture ; affiche une erreur claire plutôt que de rester bloqué. */
async function showCoverage(place: GeocodeResult, runSignal: AbortSignal) {
  show(`<p class="status">Lecture de la couverture à ${escapeHtml(place.label)}…</p>`);
  const signal = AbortSignal.any([runSignal, AbortSignal.timeout(COVERAGE_TIMEOUT_MS)]);
  try {
    manifestPromise ??= loadManifest(TILES_BASE_URL, fetch, signal);
    const manifest = await manifestPromise;
    // Commune sans adresse précise : parts de surface précalculées sur tout son
    // territoire si elles sont publiées, sinon couverture au point central.
    const commune = place.type === 'municipality' && place.citycode
      ? await loadCommuneCoverage(TILES_BASE_URL, place.citycode, signal)
      : null;
    const coverage = commune
      ? communeToCoverage(manifest.layers, commune)
      : await reader.query(manifest.layers, place.lng, place.lat, signal, areaRadius);
    renderCoverage(place, manifest, coverage);
  } catch (err) {
    // Ne pas garder en cache un échec (même interrompu) : le prochain essai repart de zéro.
    manifestPromise = undefined;
    reader = new CoverageReader(TILES_BASE_URL);
    if (runSignal.aborted) return; // remplacé par une recherche plus récente
    console.error(err);
    const timedOut = signal.aborted;
    show(`<p class="error"><strong>Impossible de lire la couverture.</strong><br />
      ${timedOut ? `Le serveur des cartes ne répond pas (délai de ${COVERAGE_TIMEOUT_MS / 1000} s dépassé).` : `Le serveur des cartes est injoignable.`}</p>
      <p class="source">Serveur : ${escapeHtml(new URL(TILES_BASE_URL).origin)}<br />Détail : ${escapeHtml((err as Error).message)}</p>
      <p><button id="retry">Réessayer</button></p>`);
    out.querySelector('#retry')!.addEventListener('click', () => showCoverage(place, runSignal));
  }
}

/** Légende des couleurs du verdict (même ordre que le classement). */
const STATUS_LEGEND: [StatusKind, string][] = [
  ['5g', '5G partout'],
  ['5g-partial', '5G sur plus de la moitié'],
  ['4g', '4G (5G absente ou trop partielle)'],
  ['none', '4G faible ou pas de réseau'],
];

function renderCoverage(place: GeocodeResult, manifest: Manifest, coverage: LayerCoverage[]) {
  const summaries = summarizeByOperator(coverage);
  const statuses = new Map(summaries.map((s) => [s.operator, operatorStatus(s)]));
  const best = bestOperators(summaries);
  // Tous ex æquo : pas de « meilleur » à mettre en avant.
  const allTied = best.length === summaries.length && summaries.length > 1;
  const bestIds = new Set(allTied ? [] : best.map((b) => b.operator));
  const zone = coverage[0]?.area?.kind;

  // Une ligne par opérateur : un seul verdict coloré (5G / 5G partielle / 4G / …).
  const rows = summaries
    .map((s) => {
      const st = statuses.get(s.operator)!;
      const isBest = bestIds.has(s.operator);
      return `<tr${isBest ? ' class="best"' : ''}>
          <th scope="row">${escapeHtml(s.operatorLabel)}${isBest ? '<span class="badge">★ meilleur</span>' : ''}</th>
          <td><button class="cell status" data-layer="${st.layerId ?? ''}" title="${escapeHtml(st.detail)}"
              style="background:${st.color};color:${st.textColor}"${st.layerId ? '' : ' disabled'}>${escapeHtml(st.label)}</button></td>
        </tr>`;
    })
    .join('');

  const bestText = !best.length
    ? 'Aucun opérateur ne couvre cet endroit en 4G ou 5G.'
    : allTied
      ? `Les ${summaries.length} opérateurs offrent la même couverture ici.`
      : best.length === 1
        ? `Meilleure couverture ici : <strong>${escapeHtml(best[0].operatorLabel)}</strong>`
        : `Meilleure couverture ici (ex æquo) : <strong>${best.map((b) => escapeHtml(b.operatorLabel)).join(', ')}</strong>`;

  // Dates des données par techno (la 5G et la 4G ne sont pas publiées au même trimestre).
  const technos = [...new Set(manifest.layers.map((l) => l.techno))].sort();
  const dates = technos
    .map((t) => `${t.toUpperCase()} au ${formatDate(manifest.layers.find((l) => l.techno === t)!.date)}`)
    .join(', ');

  show(`
    <h2>${escapeHtml(place.label)}</h2>
    ${place.type === 'municipality' && !sourceNote && zone !== 'commune' // le bandeau de la page le dit déjà
      ? '<p class="warning">Commune sans adresse précise : couverture au point central de la commune, elle peut varier ailleurs sur son territoire.</p>'
      : ''}
    ${zone === 'commune'
      ? coverage[0].area!.basis === 'surface'
        ? '<p class="area-note">Taux de 5G calculé sur tout le territoire de la commune (carte Arcep à 50 m).</p>'
        : `<p class="area-note">Taux de 5G calculé sur les ${(coverage[0].area!.inhabitants ?? 0).toLocaleString('fr-FR')} habitants de la commune (Insee 2019), là où ils vivent : les zones inhabitées ne comptent pas.</p>`
      : zone === 'circle'
        ? `<p class="area-note">Taux de 5G évalué dans un rayon de ${formatDistance(coverage[0].area!.radiusM ?? APPROX_RADIUS_M)} autour de l'emplacement indiqué.</p>`
        : ''}
    <p class="best-text">${bestText}</p>
    <table class="coverage">
      <colgroup><col class="op" /><col /></colgroup>
      <tbody>${rows}</tbody>
    </table>
    <ul class="status-legend">${STATUS_LEGEND.map(
      ([k, text]) => `<li><span class="chip" style="background:${STATUS_COLORS[k].color}"></span>${text}</li>`,
    ).join('')}</ul>
    <p class="map-caption">Carte : <strong id="map-layer"></strong> <small>— cliquez un opérateur pour changer</small></p>
    <div id="minimap-slot"></div>
    <p class="note">Un verdict « 5G » ne garantit pas le très haut débit : l'Arcep ne distingue pas la bande 700 MHz
      (longue portée, débit proche de la 4G) de la bande 3,5 GHz (rapide, faible portée). Le détail par niveau s'affiche au survol.</p>
    <p class="source">${DISCLAIMER} (données ${dates}).</p>
    <p><a id="full-map" target="_blank" rel="noopener">Voir sur la carte complète</a></p>
    <div id="encart-slot"></div>`);

  const miniMap = attachMiniMap(document.getElementById('minimap-slot')!);
  // Publicité éventuelle : sous le résultat, jamais avant, sans effet sur le classement.
  void fillEncart(document.getElementById('encart-slot')!);

  // Opérateur sélectionné = couche de son verdict (5G ou 4G) sur la mini-carte et la carte complète.
  const select = (layerId: string) => {
    const layer = manifest.layers.find((l) => l.id === layerId);
    if (!layer) return;
    out.querySelectorAll<HTMLElement>('.cell').forEach((b) => b.classList.toggle('selected', b.dataset.layer === layerId));
    document.getElementById('map-layer')!.textContent = `${layer.operator_label} ${layer.techno.toUpperCase()}`;
    const url = new URL(SITE_URL);
    url.searchParams.set('operateur', layer.operator);
    url.searchParams.set('techno', layer.techno);
    url.hash = `15/${place.lat.toFixed(5)}/${place.lng.toFixed(5)}`;
    (document.getElementById('full-map') as HTMLAnchorElement).href = url.href;
    void miniMap.show(layer, place.lng, place.lat, zone === 'commune' ? 11 : 13);
  };
  out.querySelectorAll<HTMLButtonElement>('.cell').forEach((b) => b.addEventListener('click', () => select(b.dataset.layer!)));

  // Par défaut : la couche du meilleur opérateur (ou du premier), sinon une 4G.
  const defaultOp = best[0] ?? summaries[0];
  const fallback = defaultOp.byTechno['4g'] ?? Object.values(defaultOp.byTechno)[0];
  select(statuses.get(defaultOp.operator)!.layerId ?? fallback.layer.id);
}

/**
 * La mini-carte est créée une seule fois (MapLibre coûte cher à initialiser) ;
 * son conteneur est déplacé dans chaque nouveau résultat.
 */
let miniMap: MiniMap | undefined;
const mapContainer = Object.assign(document.createElement('div'), { id: 'minimap' });
function attachMiniMap(slot: HTMLElement): MiniMap {
  slot.replaceWith(mapContainer);
  miniMap ??= new MiniMap(mapContainer);
  miniMap.resize();
  return miniMap;
}

// --- Réception des requêtes -------------------------------------------------

// Saisie manuelle (étape 5) : Entrée, ou choix d'une suggestion.
const search = new SearchBox(document.getElementById('search') as HTMLFormElement, {
  onSubmit: (text) => void run(text),
  onPick: (place) => {
    sourceNote = '';
    areaRadius = undefined;
    currentRun?.abort();
    const ctrl = (currentRun = new AbortController());
    void showCoverage(place, ctrl.signal);
  },
});

/** Traite une requête déposée par l'arrière-plan (clic droit, icône, page d'hébergement). */
function handlePending(p: PendingQuery) {
  if (p.kind === 'selection') {
    void run(p.text);
  } else if (p.kind === 'not-lodging-page') {
    sourceNote = '';
    show(`<p><strong>Ouvrez la page de l'hébergement.</strong></p>
          <p>Cette page (par exemple une liste de résultats) ne correspond pas à un établissement précis.
          Cliquez sur le nom de l'hébergement : sa page s'ouvre, souvent dans un nouvel onglet, et l'icône
          de l'extension devient orange. Cliquez alors de nouveau sur l'icône.</p>`);
  } else if (p.kind === 'page-error') {
    sourceNote = '';
    show(`<p><strong>Aucune adresse lisible sur cette page.</strong></p>
          <p>Sélectionnez l'adresse affichée sur la page puis faites un clic droit, ou tapez-la ci-dessus.</p>`);
    search.focus();
  } else {
    // Adresse lue sur la page : on l'affiche pour que l'utilisateur puisse la vérifier.
    const what = [p.name, p.address].filter(Boolean).map((s) => escapeHtml(s!)).join(' — ');
    const radius = p.radiusM ?? (p.precision === 'approximate' ? APPROX_RADIUS_M : undefined);
    // Précision publiée par le site : on la dit clairement.
    const precisionNote = {
      exact: '',
      approximate:
        `<br /><strong>Emplacement approximatif</strong> : ce site ne publie pas l'adresse exacte (souvent communiquée après réservation), la couverture est donc évaluée dans un rayon de ${formatDistance(radius ?? APPROX_RADIUS_M)}.`,
      commune:
        "<br /><strong>Commune seulement</strong> : ce site ne publie pas l'adresse du bien, la couverture est donc donnée pour l'ensemble de la commune.",
    }[p.precision ?? 'exact'];
    const note = `${p.precision === 'exact' ? 'Adresse' : 'Localisation'} lue sur la page : ${what}${precisionNote}`;
    if (p.lat !== undefined && p.lng !== undefined) {
      // Coordonnées publiées par la page : pas besoin de géocoder.
      sourceNote = note;
      areaRadius = radius;
      search.setText(p.address ?? p.name ?? '');
      currentRun?.abort();
      const ctrl = (currentRun = new AbortController());
      const label = p.address ?? p.name ?? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
      void showCoverage({ label, type: 'housenumber', score: 1, lng: p.lng, lat: p.lat, citycode: '', city: '', context: '' }, ctrl.signal);
    } else {
      void run(cleanAddress(p.address!), note, radius);
    }
  }
}

/** Au-delà, une requête déposée par l'arrière-plan est considérée comme ancienne. */
const PENDING_MAX_AGE_MS = 30_000;

// Tests hors extension : panel.html?q=<texte> (sélection) ou panel.html?page=<JSON> (adresse lue sur une page).
const params = new URLSearchParams(location.search);
const testQuery = params.get('q');
const testPage = params.get('page');
if (testQuery) {
  void run(testQuery);
} else if (testPage) {
  handlePending({ kind: 'page', ...JSON.parse(testPage), at: Date.now() });
} else if (api) {
  // Requête déposée juste avant l'ouverture du panneau ;
  // sinon (ouverture par l'icône), on donne la main au champ de saisie.
  api.storage.session.get(PENDING_KEY).then((items) => {
    const p = items[PENDING_KEY] as PendingQuery | undefined;
    if (p && Date.now() - p.at < PENDING_MAX_AGE_MS) handlePending(p);
    else search.focus();
  });
  // … ou pendant qu'il est ouvert.
  api.storage.session.onChanged.addListener((changes) => {
    const p = changes[PENDING_KEY]?.newValue as PendingQuery | undefined;
    if (p) handlePending(p);
  });
}

// Version affichée en bas du panneau : permet de vérifier que la bonne version est chargée.
document.getElementById('version')!.textContent = `version ${api?.runtime.getManifest().version ?? 'test'}`;

// Proposition de vérification sur les pages d'annonces : désactivée par défaut,
// activée par l'utilisateur ici (et désactivable depuis l'encadré).
if (api) {
  const toggle = document.getElementById('card-enabled') as HTMLInputElement;
  toggle.closest('label')!.hidden = false;
  const refresh = () => api.storage.local.get(CARD_ENABLED_KEY).then((s) => (toggle.checked = s[CARD_ENABLED_KEY] === true));
  toggle.addEventListener('change', () => void api.storage.local.set({ [CARD_ENABLED_KEY]: toggle.checked }));
  api.storage.local.onChanged.addListener(refresh);
  void refresh();
}
