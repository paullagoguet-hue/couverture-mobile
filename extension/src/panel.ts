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
  COVERED_COLOR,
  CoverageReader,
  geocode,
  isUnambiguous,
  levelInfo,
  loadManifest,
  summarizeByOperator,
  type GeocodeResult,
  type LayerCoverage,
  type Manifest,
} from '@couverture/core';

import { api, PENDING_KEY, type PendingQuery } from './browser.ts';
import { DISCLAIMER, SITE_URL, TILES_BASE_URL } from './config.ts';
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

function show(html: string) {
  out.innerHTML = (sourceNote ? `<p class="from-page">${sourceNote}</p>` : '') + html;
}

/** Point d'entrée : un texte sélectionné, saisi ou lu sur la page. */
async function run(text: string, note = '') {
  sourceNote = note;
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
    const coverage = await reader.query(manifest.layers, place.lng, place.lat, signal);
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

/** Contenu d'une case : pastille de couleur + libellé (jamais la couleur seule). */
function cell(c: LayerCoverage | undefined): { color: string; label: string; title: string } {
  if (!c) return { color: 'transparent', label: 'n.d.', title: 'Donnée non disponible' };
  if (!c.covered) return { color: 'var(--none)', label: 'Non couvert', title: 'Pas de couverture théorique à cet endroit' };
  const level = levelInfo(c.level);
  if (level) return { color: level.color, label: level.short, title: `${level.label} : ${level.description}` };
  return { color: COVERED_COLOR, label: 'Couvert', title: 'Zone couverte (pas de niveau de qualité publié)' };
}

function renderCoverage(place: GeocodeResult, manifest: Manifest, coverage: LayerCoverage[]) {
  const summaries = summarizeByOperator(coverage);
  const best = bestOperators(summaries);
  // Tous ex æquo : pas de « meilleur » à mettre en avant.
  const allTied = best.length === summaries.length && summaries.length > 1;
  const bestIds = new Set(allTied ? [] : best.map((b) => b.operator));
  const technos = [...new Set(manifest.layers.map((l) => l.techno))].sort();

  const rows = summaries
    .map((s) => {
      const cells = technos
        .map((t) => {
          const c = cell(s.byTechno[t]);
          const layer = s.byTechno[t]?.layer;
          return `<td><button class="cell" data-layer="${layer?.id ?? ''}" title="${escapeHtml(c.title)}"${layer ? '' : ' disabled'}>
              <span class="swatch" style="background:${c.color}"></span>${c.label}</button></td>`;
        })
        .join('');
      const isBest = bestIds.has(s.operator);
      return `<tr${isBest ? ' class="best"' : ''}><th scope="row">${escapeHtml(s.operatorLabel)}${isBest ? '<span class="badge">★ meilleur</span>' : ''}</th>${cells}</tr>`;
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
  const dates = technos
    .map((t) => `${t.toUpperCase()} au ${formatDate(manifest.layers.find((l) => l.techno === t)!.date)}`)
    .join(', ');

  show(`
    <h2>${escapeHtml(place.label)}</h2>
    ${place.type === 'municipality'
      ? '<p class="warning">Commune sans adresse précise : couverture au point central de la commune, elle peut varier ailleurs sur son territoire.</p>'
      : ''}
    <p class="best-text">${bestText}</p>
    <table class="coverage">
      <colgroup><col class="op" />${technos.map(() => '<col />').join('')}</colgroup>
      <thead><tr><th></th>${technos.map((t) => `<th scope="col">${t.toUpperCase()}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="map-caption">Carte : <strong id="map-layer"></strong> <small>— cliquez une case pour changer</small></p>
    <div id="minimap-slot"></div>
    <p class="note">La 5G publiée par l'Arcep ne distingue pas les bandes de fréquences : la bande 700 MHz porte loin
      mais offre un débit proche de la 4G, la bande 3,5 GHz est bien plus rapide mais de faible portée.</p>
    <p class="source">${DISCLAIMER} (données ${dates}).</p>
    <p><a id="full-map" target="_blank" rel="noopener">Voir sur la carte complète</a></p>`);

  const miniMap = attachMiniMap(document.getElementById('minimap-slot')!);

  // Case sélectionnée = couche affichée sur la mini-carte et sur la carte complète.
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
    void miniMap.show(layer, place.lng, place.lat);
  };
  out.querySelectorAll<HTMLButtonElement>('.cell').forEach((b) => b.addEventListener('click', () => select(b.dataset.layer!)));

  // Par défaut : la 4G du meilleur opérateur (ou du premier).
  const defaultOp = best[0] ?? summaries[0];
  select((defaultOp.byTechno['4g'] ?? defaultOp.byTechno[technos[0]]).layer.id);
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
    currentRun?.abort();
    const ctrl = (currentRun = new AbortController());
    void showCoverage(place, ctrl.signal);
  },
});

/** Traite une requête déposée par l'arrière-plan (clic droit, icône, page d'hébergement). */
function handlePending(p: PendingQuery) {
  if (p.kind === 'selection') {
    void run(p.text);
  } else if (p.kind === 'page-error') {
    sourceNote = '';
    show(`<p><strong>Aucune adresse lisible sur cette page.</strong></p>
          <p>Sélectionnez l'adresse affichée sur la page puis faites un clic droit, ou tapez-la ci-dessus.</p>`);
    search.focus();
  } else {
    // Adresse lue sur la page : on l'affiche pour que l'utilisateur puisse la vérifier.
    const what = [p.name, p.address].filter(Boolean).map((s) => escapeHtml(s!)).join(' — ');
    const note = `Adresse lue sur la page : ${what}`;
    if (p.lat !== undefined && p.lng !== undefined) {
      // Coordonnées publiées par la page : pas besoin de géocoder.
      sourceNote = note;
      search.setText(p.address ?? p.name ?? '');
      currentRun?.abort();
      const ctrl = (currentRun = new AbortController());
      const label = p.address ?? p.name ?? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
      void showCoverage({ label, type: 'housenumber', score: 1, lng: p.lng, lat: p.lat, citycode: '', city: '', context: '' }, ctrl.signal);
    } else {
      void run(cleanAddress(p.address!), note);
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
