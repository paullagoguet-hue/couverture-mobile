/**
 * Panneau latéral (étape 3 : résultat en texte brut).
 *
 * Reçoit le texte sélectionné via storage.session (déposé par background.ts),
 * le géocode, puis lit la couverture des couches au point trouvé.
 * Hors extension (tests), la requête peut être passée en paramètre : panel.html?q=…
 */
import {
  CoverageReader,
  geocode,
  isUnambiguous,
  levelInfo,
  loadManifest,
  type GeocodeResult,
  type LayerCoverage,
  type Manifest,
} from '@couverture/core';

import { api, PENDING_KEY, type PendingQuery } from './browser.ts';
import { DISCLAIMER, SITE_URL, TILES_BASE_URL } from './config.ts';

const out = document.getElementById('result')!;
let reader = new CoverageReader(TILES_BASE_URL);

/** Délai max pour lire la couverture (manifeste + tuiles des 8 couches). */
const COVERAGE_TIMEOUT_MS = 20_000;
let manifestPromise: Promise<Manifest> | undefined;
let currentRun: AbortController | undefined;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function show(html: string) {
  out.innerHTML = html;
}

/** Point d'entrée : un texte sélectionné ou saisi. */
async function run(text: string) {
  currentRun?.abort();
  const run = (currentRun = new AbortController());
  show(`<p>Recherche de « ${escapeHtml(text)} »…</p>`);
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
            .map((r, i) => `<li><button data-i="${i}">${escapeHtml(r.label)}</button><br /><small>${escapeHtml(r.context)}</small></li>`)
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
  show(`<p>Lecture de la couverture à ${escapeHtml(place.label)}…</p>`);
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

function renderCoverage(place: GeocodeResult, manifest: Manifest, coverage: LayerCoverage[]) {
  // Une ligne par opérateur : « 4G : Très bonne couverture · 5G : non couvert ».
  const byOperator = new Map<string, LayerCoverage[]>();
  for (const c of coverage) byOperator.set(c.layer.operator_label, [...(byOperator.get(c.layer.operator_label) ?? []), c]);
  const describe = (c: LayerCoverage) =>
    `${c.layer.techno.toUpperCase()} : ${!c.covered ? 'non couvert' : (levelInfo(c.level)?.label ?? 'couvert')}`;
  const lines = [...byOperator]
    .map(([op, cs]) => `<li><strong>${escapeHtml(op)}</strong> — ${cs.sort((a, b) => a.layer.techno.localeCompare(b.layer.techno)).map(describe).join(' · ')}</li>`)
    .join('');

  // Dates des données par techno (la 5G et la 4G ne sont pas publiées au même trimestre).
  const dates = [...new Map(manifest.layers.map((l) => [l.techno, l.date]))]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, d]) => `${t.toUpperCase()} au ${formatDate(d)}`)
    .join(', ');

  const mapUrl = new URL(SITE_URL);
  mapUrl.searchParams.set('techno', '4g');
  mapUrl.hash = `15/${place.lat.toFixed(5)}/${place.lng.toFixed(5)}`;

  show(`
    <h2>${escapeHtml(place.label)}</h2>
    ${place.type === 'municipality'
      ? '<p class="warning">Commune sans adresse précise : couverture au point central de la commune, elle peut varier ailleurs sur son territoire.</p>'
      : ''}
    <ul class="coverage">${lines}</ul>
    <p class="source">${DISCLAIMER} (données ${dates}).</p>
    <p><a href="${mapUrl.href}" target="_blank" rel="noopener">Voir sur la carte complète</a></p>`);
}

// --- Réception des requêtes -------------------------------------------------

const testQuery = new URLSearchParams(location.search).get('q');
if (testQuery) {
  void run(testQuery);
} else if (api) {
  // Requête déposée avant l'ouverture du panneau…
  api.storage.session.get(PENDING_KEY).then((items) => {
    const p = items[PENDING_KEY] as PendingQuery | undefined;
    if (p) void run(p.text);
  });
  // … ou pendant qu'il est ouvert.
  api.storage.session.onChanged.addListener((changes) => {
    const p = changes[PENDING_KEY]?.newValue as PendingQuery | undefined;
    if (p) void run(p.text);
  });
}
