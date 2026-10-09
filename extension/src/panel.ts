/**
 * Panneau latéral : couverture des opérateurs à l'adresse sélectionnée.
 *
 * Reçoit le texte sélectionné via storage.session (déposé par background.ts),
 * le géocode, lit la couverture des couches au point trouvé, puis affiche un
 * verdict par opérateur, le meilleur opérateur et une mini-carte.
 * Hors extension (tests), la requête peut être passée en paramètre : panel.html?q=…
 *
 * Plusieurs pays (France, Espagne) : chacun a ses tuiles, son manifeste (donc
 * ses opérateurs) et son géocodeur. Le pays est fixé AVANT de chercher
 * l'adresse, dans cet ordre :
 *  1. coordonnées publiées par l'annonce → pays du point (countryAt) ;
 *  2. pays publié par l'annonce (addressCountry) ou propre au site (Leboncoin…) ;
 *  3. saisie : pays choisi par l'utilisateur (boutons au-dessus du champ) ;
 *  4. seulement pour un texte sélectionné ou une annonce sans indice : les
 *     deux géocodeurs, et la réponse la plus crédible (geocodeAnyCountry).
 *
 * Robustesse : chaque recherche a son propre AbortController ; une nouvelle
 * recherche (saisie, clic droit, page d'annonce…) annule la précédente, dont
 * le résultat n'est alors jamais affiché. Les ressources partagées (manifeste,
 * tuiles, communes) ne dépendent pas de l'annulation d'une recherche.
 */
import {
  abortable,
  bestOperators,
  cleanAddress,
  communeToCoverage,
  COUNTRIES,
  COUNTRY_CODES,
  countryAt,
  countryFromText,
  CoverageReader,
  geocode,
  geocodeAnyCountry,
  isCountryCode,
  isUnambiguous,
  loadCommuneCoverage,
  loadManifest,
  operatorStatus,
  resolvePlace,
  SHARED_FETCH_TIMEOUT_MS,
  summarizeByOperator,
  tilesBaseFor,
  type CountryCode,
  type GeocodeResult,
  type LayerCoverage,
  type Manifest,
} from '@couverture/core';

import { api, PENDING_KEY, type PendingQuery } from './browser.ts';
import { CARD_ENABLED_KEY } from './messages.ts';
import { SITE_URL, TILES_BASE_URL } from './config.ts';
import { fillEncart } from './encart.ts';
import { FLAGS, HERO_SVG, ICONS } from './illustrations.ts';
import { InfoPage } from './info.ts';
import { MiniMap } from './minimap.ts';
import { SearchBox } from './search.ts';

const out = document.getElementById('result')!;
let currentRun: AbortController | undefined;

/** Pays de la saisie manuelle (mémorisé) ; les résultats portent leur propre pays. */
let country: CountryCode = 'fr';
const COUNTRY_KEY = 'country';

/** Source citée sous chaque résultat. */
const SOURCE_LABEL: Record<CountryCode, string> = { fr: 'Arcep', es: 'ministère espagnol du Numérique' };

const readers = new Map<CountryCode, CoverageReader>();
const manifests = new Map<CountryCode, Promise<Manifest>>();

const tilesBase = (c: CountryCode) => tilesBaseFor(TILES_BASE_URL, c);

function readerFor(c: CountryCode): CoverageReader {
  let reader = readers.get(c);
  if (!reader) readers.set(c, (reader = new CoverageReader(tilesBase(c))));
  return reader;
}

/**
 * Manifeste d'un pays, partagé entre recherches : téléchargé sans le signal de
 * l'une d'elles, et retiré du cache s'il échoue (le prochain essai recommence).
 */
function getManifest(c: CountryCode): Promise<Manifest> {
  let manifest = manifests.get(c);
  if (!manifest) {
    const loading = loadManifest(tilesBase(c), fetch, AbortSignal.timeout(SHARED_FETCH_TIMEOUT_MS));
    loading.catch(() => manifests.get(c) === loading && manifests.delete(c));
    manifests.set(c, (manifest = loading));
  }
  return manifest;
}

const info = new InfoPage(getManifest);

/** Délai max pour lire la couverture (manifeste + tuiles des 8 couches). */
const COVERAGE_TIMEOUT_MS = 20_000;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Rayon par défaut si la page ne précise pas le sien (cf. radiusFor dans lodging.ts). */
const APPROX_RADIUS_M = 1000;

/** « 300 m », « 1 km », « 2 km ». */
const formatDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toLocaleString('fr-FR')} km` : `${m} m`);

/** Contexte d'une recherche : propre à elle, jamais partagé avec la suivante. */
interface Run {
  signal: AbortSignal;
  /** Bandeau au-dessus du résultat (ex. « Adresse lue sur la page : … »), HTML déjà échappé. */
  note: string;
  /** Emplacement approximatif : couverture évaluée dans ce rayon (m) plutôt qu'en un point. */
  radiusM?: number;
}

/** Démarre une recherche : annule la précédente, dont le résultat sera ignoré. */
function startRun(note = '', radiusM?: number): Run {
  currentRun?.abort();
  currentRun = new AbortController();
  return { signal: currentRun.signal, note, radiusM };
}

/** Remplace le contenu (avec un léger fondu) ; `note` éventuelle en tête. */
function show(html: string, note = '') {
  info.hide(); // une nouvelle demande prend la place de la page d'infos
  out.innerHTML = (note ? `<p class="from-page">${note}</p>` : '') + html;
  // Relance l'animation d'apparition.
  out.style.animation = 'none';
  void out.offsetWidth;
  out.style.animation = '';
}

function loading(text: string, note = '') {
  show(
    `<div class="loading"><span class="spinner"></span><span>${text}</span></div>
     <div class="card skeleton"><i></i><i></i><i></i><i></i></div>`,
    note,
  );
}

/** Message (conseil ou erreur) avec pictogramme ; renvoie le conteneur pour y brancher des boutons. */
function message(o: { icon: string; title: string; body: string; error?: boolean; action?: string }, note = '') {
  show(
    `<div class="card message${o.error ? ' error' : ''}">
       <span class="bubble">${o.icon}</span>
       <div><strong>${o.title}</strong>${o.body}${o.action ? `<p>${o.action}</p>` : ''}</div>
     </div>`,
    note,
  );
}

// --- Pays ---------------------------------------------------------------------

const countryButtons = [...document.querySelectorAll<HTMLButtonElement>('#countries button')];
countryButtons.forEach((b) => {
  const c = b.dataset.country as CountryCode;
  b.addEventListener('click', () => {
    setCountry(c);
    search.focus();
  });
});

/** Change le pays de la saisie (boutons, ou résultat trouvé dans un autre pays). */
function setCountry(c: CountryCode, remember = true) {
  country = c;
  countryButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.country === c)));
  search.close();
  if (remember) void api?.storage.local.set({ [COUNTRY_KEY]: c }).catch(() => {});
  // Opérateurs du pays chargés dès maintenant : la recherche suivante sera plus rapide.
  getManifest(c).catch(() => {});
}

// --- Accueil --------------------------------------------------------------------

const EXAMPLES: [string, CountryCode][] = [
  ['10 Rue de Rivoli, Paris', 'fr'],
  ['Bonneval-sur-Arc', 'fr'],
  ['Calle Mayor 1, Madrid', 'es'],
];

/** Accueil : explication, trois façons de vérifier, exemples. */
function showWelcome() {
  currentRun?.abort();
  show(`<section class="welcome">
    ${HERO_SVG}
    <h2>Votre téléphone captera-t-il ?</h2>
    <p class="lead">La 4G et la 5G des opérateurs, en France et en Espagne.</p>
    <div class="card">
      <ul class="steps">
        <li><span class="bubble">${ICONS.search}</span><div><strong>Tapez une adresse</strong></div></li>
        <li><span class="bubble">${ICONS.select}</span><div><strong>Ou sélectionnez-la sur une page</strong>
          <span>puis clic droit</span></div></li>
        <li><span class="bubble">${ICONS.house}</span><div><strong>Sur une annonce de logement</strong>
          <span>cliquez sur l'icône orange</span></div></li>
      </ul>
    </div>
    <div class="card">
      <h3>Essayer</h3>
      <div class="examples">${EXAMPLES.map(([e, c]) => `<button type="button" data-country="${c}">${escapeHtml(e)}</button>`).join('')}</div>
    </div>
  </section>`);
  out.querySelectorAll<HTMLButtonElement>('.examples button').forEach((b) =>
    b.addEventListener('click', () => {
      setCountry(b.dataset.country as CountryCode);
      void run(b.textContent!);
    }),
  );
}

// --- Recherche ------------------------------------------------------------------

interface RunOptions {
  note?: string;
  radiusM?: number;
  /**
   * Pays où chercher : connu d'avance (annonce), ou 'any' pour un texte sans
   * indice (cf. geocodeAnyCountry). Par défaut : le pays choisi par l'utilisateur.
   */
  where?: CountryCode | 'any';
}

/** Point d'entrée : un texte sélectionné, saisi ou lu sur la page. */
async function run(text: string, options: RunOptions = {}) {
  const { note = '', radiusM, where = country } = options;
  search.setText(text);
  const r = startRun(note, radiusM);
  loading(`Recherche de « ${escapeHtml(text)} »…`, r.note);
  const anyCountry = where === 'any';
  const others = COUNTRY_CODES.filter((c) => c !== where);
  try {
    const results = anyCountry
      ? await geocodeAnyCountry(text, { limit: 5, signal: r.signal })
      : await geocode(text, { limit: 5, country: where, signal: r.signal });
    if (r.signal.aborted) return;
    if (!results.length) {
      message(
        {
          icon: ICONS.pin,
          title: `Adresse introuvable${anyCountry ? '' : ` (${COUNTRIES[where].label})`}`,
          body: `<p>Essayez avec la ville ou le code postal.</p>`,
          action: anyCountry
            ? undefined
            : others.map((c) => `<button class="btn" type="button" data-country="${c}">${FLAGS[c]}Chercher : ${COUNTRIES[c].label}</button>`).join(' '),
        },
        r.note,
      );
      out.querySelectorAll<HTMLButtonElement>('[data-country]').forEach((b) =>
        b.addEventListener('click', () => {
          const c = b.dataset.country as CountryCode;
          setCountry(c);
          void run(text, { ...options, where: c });
        }),
      );
      return;
    }
    if (results[0].country !== country) setCountry(results[0].country);
    if (isUnambiguous(results)) return await showCoverage(results[0], r);
    // Plusieurs lieux plausibles : l'utilisateur choisit.
    show(
      `<div class="card"><strong>Lequel ?</strong>
        <ul class="choices">${results
          .map((p, i) => `<li><button type="button" data-i="${i}">${ICONS.pin}<span>${escapeHtml(p.label)}<small>${escapeHtml(p.context)}</small></span></button></li>`)
          .join('')}</ul></div>`,
      r.note,
    );
    out.querySelectorAll<HTMLButtonElement>('.choices button').forEach((b) =>
      b.addEventListener('click', () => {
        // Nouvelle recherche (même note et rayon) : un double clic n'en lance qu'une à la fois.
        const pick = startRun(r.note, r.radiusM);
        void showCoverage(results[Number(b.dataset.i)], pick);
      }),
    );
  } catch (err) {
    if (r.signal.aborted) return;
    console.error(err);
    message(
      {
        icon: ICONS.alert,
        error: true,
        title: 'Recherche impossible',
        body: `<p>Vérifiez votre connexion.</p>
               <p class="detail">${escapeHtml((err as Error).message)}</p>`,
        action: `<button class="btn" id="retry" type="button">${ICONS.retry}Réessayer</button>`,
      },
      r.note,
    );
    out.querySelector('#retry')!.addEventListener('click', () => void run(text, options));
  }
}

/** Lit et affiche la couverture ; affiche une erreur claire plutôt que de rester bloqué. */
async function showCoverage(place: GeocodeResult, r: Run) {
  if (r.signal.aborted) return;
  loading(`Lecture de la couverture à ${escapeHtml(place.label)}…`, r.note);
  const c = place.country;
  const signal = AbortSignal.any([r.signal, AbortSignal.timeout(COVERAGE_TIMEOUT_MS)]);
  try {
    // Position parfois donnée en deux temps par le géocodeur (Espagne).
    const located = await resolvePlace(place, signal);
    const manifest = await abortable(getManifest(c), signal);
    // Commune sans adresse précise : parts d'habitants précalculées sur tout son
    // territoire si elles sont publiées (France), sinon couverture au point central.
    const commune = c === 'fr' && located.type === 'municipality' && located.citycode
      ? await loadCommuneCoverage(tilesBase(c), located.citycode, signal)
      : null;
    const coverage = commune
      ? communeToCoverage(manifest.layers, commune)
      : await readerFor(c).query(manifest.layers, located.lng, located.lat, signal, r.radiusM);
    if (r.signal.aborted) return; // une recherche plus récente a pris la main
    renderCoverage(located, manifest, coverage, r);
  } catch (err) {
    if (r.signal.aborted) return; // remplacée par une recherche plus récente : rien à signaler
    // Vrai échec (réseau, délai) : ne pas garder les caches, le prochain essai repart de zéro.
    manifests.delete(c);
    readers.delete(c);
    console.error(err);
    const timedOut = signal.aborted;
    message(
      {
        icon: ICONS.noSignal,
        error: true,
        title: 'Couverture indisponible',
        body: `<p>${timedOut ? 'Le serveur ne répond pas.' : 'Serveur injoignable.'} Réessayez dans un instant.</p>
               <p class="detail">${escapeHtml(new URL(TILES_BASE_URL).origin)} · ${escapeHtml((err as Error).message)}</p>`,
        action: `<button class="btn" id="retry" type="button">${ICONS.retry}Réessayer</button>`,
      },
      r.note,
    );
    out.querySelector('#retry')!.addEventListener('click', () => void showCoverage(place, startRun(r.note, r.radiusM)));
  }
}

function renderCoverage(place: GeocodeResult, manifest: Manifest, coverage: LayerCoverage[], r: Run) {
  const c = place.country;
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
      return `<li><button type="button" class="cell${isBest ? ' best' : ''}" data-layer="${st.layerId ?? ''}" title="${escapeHtml(st.detail)}"${st.layerId ? '' : ' disabled'}>
          <span class="op-name">${escapeHtml(s.operatorLabel)}${isBest ? `<span class="badge">${ICONS.star}meilleur ici</span>` : ''}</span>
          <span class="pill" style="background:${st.color};color:${st.textColor}">${escapeHtml(st.label)}</span>
        </button></li>`;
    })
    .join('');

  const bestText = !best.length
    ? 'Ni 4G ni 5G ici.'
    : allTied
      ? 'Même couverture pour tous les opérateurs.'
      : `Meilleur : <strong>${best.map((b) => escapeHtml(b.operatorLabel)).join(', ')}</strong>`;

  const area = coverage[0]?.area;
  const areaNote =
    zone === 'commune'
      ? area!.basis === 'surface'
        ? 'Taux de 5G calculé sur toute la commune'
        : `Taux de 5G calculé sur les ${(area!.inhabitants ?? 0).toLocaleString('fr-FR')} habitants de la commune`
      : zone === 'circle'
        ? `Taux de 5G dans un rayon de ${formatDistance(area!.radiusM ?? APPROX_RADIUS_M)}`
        : '';

  // La carte complète (site web) ne couvre que la France pour l'instant.
  const fullMap = c === 'fr';

  show(
    `<section class="card">
      <div class="place-head">${ICONS.pin}<h2>${escapeHtml(place.label)}</h2><span class="flag" title="${COUNTRIES[c].label}">${FLAGS[c]}</span></div>
      ${areaNote ? `<p class="area-note">${areaNote}</p>` : ''}
      ${['municipality', 'locality'].includes(place.type) && !r.note && zone !== 'commune' // le bandeau de la page le dit déjà
        ? '<p class="warning">Couverture au centre de la commune</p>'
        : ''}
    </section>
    <section class="card">
      <p class="best-text">${best.length && !allTied ? ICONS.star : ''}<span>${bestText}</span></p>
      <ul class="operators">${rows}</ul>
    </section>
    <section class="card">
      <p class="map-caption">Carte : <strong id="map-layer"></strong></p>
      <div id="minimap-slot"></div>
      ${fullMap ? `<p class="map-actions"><a id="full-map" class="btn" target="_blank" rel="noopener">Voir sur la carte complète ${ICONS.arrow}</a></p>` : ''}
    </section>
    <p class="source">Couverture théorique, source ${SOURCE_LABEL[c]} · <button type="button" class="link" data-info>Infos</button></p>
    <div id="encart-slot"></div>`,
    r.note,
  );

  out.querySelector('[data-info]')!.addEventListener('click', () => void info.show());
  const miniMap = attachMiniMap(document.getElementById('minimap-slot')!, c);
  // Publicité éventuelle : sous le résultat, jamais avant, sans effet sur le classement.
  void fillEncart(document.getElementById('encart-slot')!);

  // Opérateur sélectionné = couche de son verdict (5G ou 4G) sur la mini-carte et la carte complète.
  const select = (layerId: string) => {
    const layer = manifest.layers.find((l) => l.id === layerId);
    if (!layer) return;
    out.querySelectorAll<HTMLElement>('.cell').forEach((b) => b.classList.toggle('selected', b.dataset.layer === layerId));
    document.getElementById('map-layer')!.textContent = `${layer.operator_label} ${layer.techno.toUpperCase()}`;
    if (fullMap) {
      const url = new URL(SITE_URL);
      url.searchParams.set('operateur', layer.operator);
      url.searchParams.set('techno', layer.techno);
      url.hash = `15/${place.lat.toFixed(5)}/${place.lng.toFixed(5)}`;
      (document.getElementById('full-map') as HTMLAnchorElement).href = url.href;
    }
    const tilesUrl = new URL(layer.tiles.file, tilesBase(c)).href;
    miniMap?.show(c, layer, tilesUrl, place.lng, place.lat, zone === 'commune' ? 11 : 13).catch(console.error);
  };
  out.querySelectorAll<HTMLButtonElement>('.cell').forEach((b) => b.addEventListener('click', () => select(b.dataset.layer!)));

  // Par défaut : la couche du meilleur opérateur (ou du premier), sinon une 4G.
  const defaultOp = best[0] ?? summaries[0];
  const fallback = defaultOp.byTechno['4g'] ?? Object.values(defaultOp.byTechno)[0];
  select(statuses.get(defaultOp.operator)!.layerId ?? fallback.layer.id);
}

/**
 * La mini-carte est créée une seule fois (MapLibre coûte cher à initialiser) ;
 * son conteneur est déplacé dans chaque nouveau résultat. Si elle ne peut pas
 * être créée (WebGL indisponible…), le résultat s'affiche sans elle.
 */
let miniMap: MiniMap | undefined;
let miniMapFailed = false;
const mapContainer = Object.assign(document.createElement('div'), { id: 'minimap' });
function attachMiniMap(slot: HTMLElement, country: CountryCode): MiniMap | undefined {
  if (miniMapFailed) {
    slot.closest('section')?.querySelector('.map-caption')?.remove();
    slot.remove();
    return undefined;
  }
  slot.replaceWith(mapContainer);
  try {
    miniMap ??= new MiniMap(mapContainer, country);
    miniMap.resize();
  } catch (err) {
    console.error('Mini-carte indisponible :', err);
    miniMapFailed = true;
    mapContainer.closest('section')?.querySelector('.map-caption')?.remove();
    mapContainer.remove();
  }
  return miniMap;
}

// --- Réception des requêtes -------------------------------------------------

// Saisie manuelle (étape 5) : Entrée, ou choix d'une suggestion (dans le pays choisi).
const search = new SearchBox(document.getElementById('search') as HTMLFormElement, {
  country: () => country,
  onSubmit: (text) => void run(text),
  onPick: (place) => void showCoverage(place, startRun()),
});

/** Horodatage de la dernière requête traitée : chaque requête n'est traitée qu'une fois. */
let lastPendingAt = 0;

/** Traite une requête déposée par l'arrière-plan (clic droit, icône, page d'hébergement). */
function handlePending(p: PendingQuery) {
  // Au chargement, la même requête peut arriver deux fois (lecture initiale + événement).
  if (p.at <= lastPendingAt) return;
  lastPendingAt = p.at;
  if (p.kind === 'selection') {
    void run(p.text, { where: 'any' });
  } else if (p.kind === 'not-lodging-page') {
    currentRun?.abort();
    message({
      icon: ICONS.house,
      title: 'Ouvrez la page du logement',
      body: `<p>Puis cliquez sur l'icône orange.</p>`,
    });
  } else if (p.kind === 'page-error') {
    currentRun?.abort();
    message({
      icon: ICONS.select,
      title: 'Adresse non trouvée sur la page',
      body: `<p>Sélectionnez-la puis clic droit, ou tapez-la ci-dessus.</p>`,
    });
    search.focus();
  } else {
    // Adresse lue sur la page : on l'affiche pour que l'utilisateur puisse la vérifier.
    const what = [p.name, p.address].filter(Boolean).map((s) => escapeHtml(s!)).join(' — ');
    const radius = p.radiusM ?? (p.precision === 'approximate' ? APPROX_RADIUS_M : undefined);
    // Précision publiée par le site : on la dit clairement.
    const precisionNote = {
      exact: '',
      approximate: '<br />Adresse exacte non publiée par le site',
      commune: '<br />Seule la commune est publiée par le site',
    }[p.precision ?? 'exact'];
    const note = `Lu sur la page : ${what}${precisionNote}`;
    if (p.lat !== undefined && p.lng !== undefined) {
      // Coordonnées publiées par la page : pas besoin de géocoder ; le pays se déduit du point.
      search.setText(p.address ?? p.name ?? '');
      const c = countryAt(p.lng, p.lat);
      if (!c) {
        currentRun?.abort();
        message(
          {
            icon: ICONS.pin,
            title: 'Pays non couvert',
            body: `<p>L'extension couvre la France et l'Espagne.</p>`,
          },
          note,
        );
        return;
      }
      setCountry(c);
      const label = p.address ?? p.name ?? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
      void showCoverage(
        { label, type: 'housenumber', score: 1, lng: p.lng, lat: p.lat, citycode: '', city: '', context: '', country: c },
        startRun(note, radius),
      );
    } else {
      // Pays publié par l'annonce ou propre au site ; sinon recherche dans tous les pays.
      const published = countryFromText(p.country);
      if (published === 'other') {
        currentRun?.abort();
        message({ icon: ICONS.pin, title: 'Pays non couvert', body: `<p>L'extension couvre la France et l'Espagne.</p>` }, note);
        return;
      }
      if (published) setCountry(published);
      void run(cleanAddress(p.address!), { note, radiusM: radius, where: published ?? 'any' });
    }
  }
}

/** Au-delà, une requête déposée par l'arrière-plan est considérée comme ancienne. */
const PENDING_MAX_AGE_MS = 30_000;

/** Démarrage : pays mémorisé, puis requête en attente (ou accueil). */
async function start() {
  // Tests hors extension : panel.html?pays=es&q=<texte> (sélection) ou ?page=<JSON> (adresse lue sur une page).
  const params = new URLSearchParams(location.search);
  const testCountry = params.get('pays');
  const testQuery = params.get('q');
  const testPage = params.get('page');

  try {
    const saved = (await api?.storage.local.get(COUNTRY_KEY))?.[COUNTRY_KEY];
    setCountry(isCountryCode(testCountry) ? testCountry : isCountryCode(saved) ? saved : 'fr', false);
  } catch {
    setCountry('fr', false);
  }

  if (testQuery) {
    void run(testQuery, { where: isCountryCode(testCountry) ? testCountry : 'any' });
  } else if (testPage) {
    handlePending({ kind: 'page', ...JSON.parse(testPage), at: Date.now() });
  } else if (api) {
    // … ou pendant qu'il est ouvert (écouteur posé d'abord : rien ne se perd).
    api.storage.session.onChanged.addListener((changes) => {
      const p = changes[PENDING_KEY]?.newValue as PendingQuery | undefined;
      if (p) handlePending(p);
    });
    // Requête déposée juste avant l'ouverture du panneau ; sinon (ouverture par
    // l'icône), accueil et main au champ de saisie.
    try {
      const items = await api.storage.session.get(PENDING_KEY);
      const p = items[PENDING_KEY] as PendingQuery | undefined;
      if (p && Date.now() - p.at < PENDING_MAX_AGE_MS) handlePending(p);
      else if (!currentRun && !lastPendingAt) {
        showWelcome();
        search.focus();
      }
    } catch {
      showWelcome();
    }
  } else {
    showWelcome();
  }
}
void start();

document.getElementById('info-open')!.addEventListener('click', () => (info.visible ? info.hide() : void info.show()));

// Version affichée dans la page d'infos : permet de vérifier que la bonne version est chargée.
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
