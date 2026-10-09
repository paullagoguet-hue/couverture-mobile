/**
 * Panneau latéral : couverture des opérateurs à l'adresse sélectionnée.
 *
 * Reçoit le texte sélectionné via storage.session (déposé par background.ts),
 * le géocode, lit la couverture des couches au point trouvé, puis affiche un
 * verdict par opérateur, le meilleur opérateur et une mini-carte.
 * Hors extension (tests), la requête peut être passée en paramètre : panel.html?q=…
 *
 * Plusieurs pays : chacun a son géocodeur, et ses tuiles et son manifeste
 * (donc ses opérateurs) — ou, en Italie et en Suisse, seulement le nombre de
 * réseaux, lu en direct aux services officiels (cf. networks.ts). Le pays est fixé AVANT de chercher
 * l'adresse, dans cet ordre :
 *  1. coordonnées publiées par l'annonce → pays du point (countryAt) ;
 *  2. pays écrit à la fin du texte (« …, Portugal »), ou publié par l'annonce
 *     (addressCountry) ou propre au site (Leboncoin…) ;
 *  3. pays du site consulté (nom de domaine national : .pt, .es, .be, .fr) ;
 *  4. sinon le pays choisi par l'utilisateur (boutons au-dessus du champ).
 * La recherche se fait ensuite dans ce seul pays (jamais de devinette entre
 * pays : les homonymes sont partout) ; introuvable, on propose les autres pays.
 *
 * Robustesse : chaque recherche a son propre AbortController ; une nouvelle
 * recherche (saisie, clic droit, page d'annonce…) annule la précédente, dont
 * le résultat n'est alors jamais affiché. Les ressources partagées (manifeste,
 * tuiles, communes) ne dépendent pas de l'annulation d'une recherche.
 */
import {
  abortable,
  bestOperators,
  configureGeocoders,
  cleanAddress,
  communeToCoverage,
  COUNTRY_CODES,
  countryAt,
  countryFromHost,
  countryFromText,
  CoverageReader,
  geocode,
  isCountryCode,
  isNetworkCountry,
  isUnambiguous,
  loadCommuneCoverage,
  loadManifest,
  NETWORK_COLORS,
  NETWORK_SOURCES,
  networkKind,
  operatorStatus,
  readNetworks,
  resolvePlace,
  speedFillExpression,
  speedRating,
  speedStatus,
  SPEED_COLORS,
  SHARED_FETCH_TIMEOUT_MS,
  summarizeByOperator,
  tilesBaseFor,
  type CountryCode,
  type GeocodeResult,
  type LayerCoverage,
  type Manifest,
  type NetworkCount,
  type NetworkCountry,
  type NetworkTechno,
} from '@couverture/core';

import { api, PENDING_KEY, type PendingQuery } from './browser.ts';
import { CARD_ENABLED_KEY } from './messages.ts';
import { PHOTON_URL, SITE_URL, TILES_BASE_URL } from './config.ts';
import { fillEncart } from './encart.ts';
import { formatNumber, initLang, LANG_KEY, LANG_LABELS, LANGS, lang, locale, t, translatePage, type Lang } from './i18n.ts';
import { FLAGS, HERO_SVG, ICONS } from './illustrations.ts';
import { InfoPage } from './info.ts';
import { MiniMap } from './minimap.ts';
import { SearchBox } from './search.ts';
import { speedDetail, speedLabel, speedName, speedSubtitle, statusDetail, statusLabel } from './verdict-text.ts';

configureGeocoders({ photonUrl: PHOTON_URL });

const out = document.getElementById('result')!;
let currentRun: AbortController | undefined;

/** Pays de la saisie manuelle (mémorisé) ; les résultats portent leur propre pays. */
let country: CountryCode = 'fr';
const COUNTRY_KEY = 'country';

/** Nom du pays dans la langue de l'interface (fourni par le navigateur). */
const countryName = (c: CountryCode) => new Intl.DisplayNames([locale()], { type: 'region' }).of(c.toUpperCase()) ?? c;

/** Liste des pays couverts, dans la langue (« France, Espagne et Portugal »). */
const countriesList = () => new Intl.ListFormat(locale(), { type: 'conjunction' }).format(COUNTRY_CODES.map(countryName));

/** Producteur des données, cité sous chaque résultat (nom propre, non traduit). */
const PRODUCERS: Record<CountryCode, string> = {
  fr: 'Arcep',
  es: 'Ministerio para la Transformación Digital',
  pt: 'ANACOM',
  be: 'IBPT-BIPT',
  lu: 'ILR',
  it: 'AGCOM',
  ch: 'OFCOM',
};

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

/** Délai max d'une recherche d'adresse : au-delà, message d'erreur plutôt qu'attente. */
const GEOCODE_TIMEOUT_MS = 10_000;

/** Délai max pour lire la couverture (manifeste + tuiles des 8 couches). */
const COVERAGE_TIMEOUT_MS = 20_000;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Rayon par défaut si la page ne précise pas le sien (cf. radiusFor dans lodging.ts). */
const APPROX_RADIUS_M = 1000;

/** « 300 m », « 1 km », « 1,5 km ». */
const formatDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toLocaleString(locale())} km` : `${m} m`);

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

/** SVG constant -> élément (sans innerHTML). */
const svgElement = (svg: string) => document.importNode(new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement, true);

/** Un bouton par pays du cœur : ajouter un pays n'impose pas de toucher au HTML. */
const countryButtons = COUNTRY_CODES.map((c) => {
  const b = Object.assign(document.createElement('button'), { type: 'button' });
  b.setAttribute('role', 'radio');
  b.dataset.country = c;
  b.append(svgElement(FLAGS[c]), Object.assign(document.createElement('span'), { className: 'country-name' }));
  b.addEventListener('click', () => {
    setCountry(c);
    search.focus();
  });
  document.getElementById('countries')!.append(b);
  return b;
});
/** Noms des pays, une fois la langue connue. */
const labelCountryButtons = () => countryButtons.forEach((b) => (b.querySelector('.country-name')!.textContent = countryName(b.dataset.country as CountryCode)));

/** Change le pays de la saisie (boutons, ou résultat trouvé dans un autre pays). */
function setCountry(c: CountryCode, remember = true) {
  country = c;
  countryButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.country === c)));
  search.close();
  if (remember) void api?.storage.local.set({ [COUNTRY_KEY]: c }).catch(() => {});
  // Opérateurs du pays chargés dès maintenant : la recherche suivante sera plus rapide.
  if (!isNetworkCountry(c)) getManifest(c).catch(() => {});
}

// --- Accueil --------------------------------------------------------------------

const EXAMPLES: [string, CountryCode][] = [
  ['10 Rue de Rivoli, Paris', 'fr'],
  ['Bonneval-sur-Arc', 'fr'],
  ['Calle Mayor 1, Madrid', 'es'],
  ['Rua Augusta 100, Lisboa', 'pt'],
  ['Rue Neuve 1, Bruxelles', 'be'],
  ['Place Guillaume II, Luxembourg', 'lu'],
  ['Piazza Navona, Roma', 'it'],
  ['Bahnhofstrasse 10, Zürich', 'ch'],
];

/** Accueil : explication, trois façons de vérifier, exemples. */
function showWelcome() {
  currentRun?.abort();
  show(`<section class="welcome">
    ${HERO_SVG}
    <h2>${t('welcomeTitle')}</h2>
    <p class="lead">${t('welcomeLead')}</p>
    <p class="lead">${escapeHtml(t('coversCountries', { countries: countriesList() }))}</p>
    <div class="card">
      <ul class="steps">
        <li><span class="bubble">${ICONS.search}</span><div><strong>${t('stepType')}</strong></div></li>
        <li><span class="bubble">${ICONS.select}</span><div><strong>${t('stepSelect')}</strong>
          <span>${t('stepSelectHint')}</span></div></li>
        <li><span class="bubble">${ICONS.house}</span><div><strong>${t('stepListing')}</strong>
          <span>${t('stepListingHint')}</span></div></li>
      </ul>
    </div>
    <div class="card">
      <h3>${t('tryTitle')}</h3>
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
  /** Pays où chercher (cf. countryOf) ; par défaut : le pays choisi par l'utilisateur. */
  where?: CountryCode;
}

/** En dessous, une réponse du géocodeur français ne correspond pas vraiment au texte (« Gran Vía 28, Madrid » -> 0,39). */
const MIN_SCORE = 0.45;

/**
 * Pays d'une demande, avant toute recherche (cf. en-tête) ; 'other' : pays non
 * pris en charge, publié par l'annonce.
 */
function countryOf(o: { text?: string; published?: string; host?: string }): CountryCode | 'other' {
  // Pays écrit à la fin du texte : « Rua Augusta 100, Lisboa, Portugal ».
  const lastPart = o.text?.split(',').pop()?.trim();
  const written = lastPart && lastPart !== o.text?.trim() ? countryFromText(lastPart) : null;
  if (written && written !== 'other') return written;
  const published = countryFromText(o.published);
  if (published) return published;
  return countryFromHost(o.host) ?? country;
}

const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
};

/** Point d'entrée : un texte sélectionné, saisi ou lu sur la page. */
async function run(text: string, options: RunOptions = {}) {
  const { note = '', radiusM, where = country } = options;
  search.setText(text);
  const r = startRun(note, radiusM);
  loading(t('searching', { q: escapeHtml(text) }), r.note);
  const others = COUNTRY_CODES.filter((c) => c !== where);
  if (where !== country) setCountry(where); // pays déduit de la page ou du texte : affiché sur les boutons
  try {
    const results = (
      await geocode(text, { limit: 5, country: where, signal: AbortSignal.any([r.signal, AbortSignal.timeout(GEOCODE_TIMEOUT_MS)]) })
    ).filter((p) => p.score >= MIN_SCORE);
    if (r.signal.aborted) return;
    if (!results.length) {
      message(
        {
          icon: ICONS.pin,
          title: t('notFoundIn', { country: countryName(where) }),
          body: `<p>${t('notFoundHint')}</p>`,
          action: others.map((c) => `<button class="btn" type="button" data-country="${c}">${FLAGS[c]}${t('searchIn', { country: countryName(c) })}</button>`).join(' '),
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
    if (isUnambiguous(results)) return await showCoverage(results[0], r);
    // Plusieurs lieux plausibles : l'utilisateur choisit.
    show(
      `<div class="card"><strong>${t('which')}</strong>
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
        title: t('searchFailed'),
        body: `<p>${t('checkConnection')}</p>
               <p class="detail">${escapeHtml((err as Error).message)}</p>`,
        action: `<button class="btn" id="retry" type="button">${ICONS.retry}${t('retry')}</button>`,
      },
      r.note,
    );
    out.querySelector('#retry')!.addEventListener('click', () => void run(text, options));
  }
}

/** Lit et affiche la couverture ; affiche une erreur claire plutôt que de rester bloqué. */
async function showCoverage(place: GeocodeResult, r: Run) {
  if (r.signal.aborted) return;
  loading(t('reading', { place: escapeHtml(place.label) }), r.note);
  const c = place.country;
  const signal = AbortSignal.any([r.signal, AbortSignal.timeout(COVERAGE_TIMEOUT_MS)]);
  try {
    // Position parfois donnée en deux temps par le géocodeur (Espagne).
    const located = await resolvePlace(place, signal);
    if (isNetworkCountry(c)) {
      const counts = await readNetworks(c, located.lng, located.lat, { radiusM: r.radiusM, signal });
      if (r.signal.aborted) return;
      return renderNetworks(located, c, counts, r);
    }
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
        title: t('coverageUnavailable'),
        body: `<p>${timedOut ? t('serverNoResponse') : t('serverUnreachable')} ${t('retrySoon')}</p>
               <p class="detail">${isNetworkCountry(c) ? PRODUCERS[c] : escapeHtml(new URL(TILES_BASE_URL).origin)} · ${escapeHtml((err as Error).message)}</p>`,
        action: `<button class="btn" id="retry" type="button">${ICONS.retry}${t('retry')}</button>`,
      },
      r.note,
    );
    out.querySelector('#retry')!.addEventListener('click', () => void showCoverage(place, startRun(r.note, r.radiusM)));
  }
}

/** Une ligne d'opérateur : badge (couleur, texte), infobulle, donnée publiée, couche de la carte. */
interface RowView {
  color: string;
  textColor: string;
  label: string;
  detail: string;
  sub: string;
  layerId?: string;
  rating?: { score: number; quality: number };
}

function renderCoverage(place: GeocodeResult, manifest: Manifest, coverage: LayerCoverage[], r: Run) {
  const c = place.country;
  const summaries = summarizeByOperator(coverage);
  // Verdict de débit là où il est publié par opérateur (Portugal), sinon de couverture (5G / 4G…).
  const speedClasses = manifest.speed_classes;
  const views = new Map<string, RowView>(
    summaries.map((s) => {
      if (speedClasses) {
        const st = speedStatus(s, speedClasses);
        return [s.operator, { ...st, label: speedLabel(st), detail: speedDetail(st), sub: speedSubtitle(st), rating: speedRating(st) }];
      }
      const st = operatorStatus(s);
      return [s.operator, { ...st, label: statusLabel(st), detail: statusDetail(s, st), sub: '' }];
    }),
  );
  const best = speedClasses ? bestOperators(summaries, (s) => views.get(s.operator)!.rating!) : bestOperators(summaries);
  // Tous ex æquo : pas de « meilleur » à mettre en avant.
  const allTied = best.length === summaries.length && summaries.length > 1;
  const bestIds = new Set(allTied ? [] : best.map((b) => b.operator));
  const zone = coverage[0]?.area?.kind;

  // Une ligne par opérateur : un seul verdict coloré (5G / 5G partielle / 4G / …).
  const rows = summaries
    .map((s) => {
      const st = views.get(s.operator)!;
      const isBest = bestIds.has(s.operator);
      return `<li><button type="button" class="cell${isBest ? ' best' : ''}" data-layer="${st.layerId ?? ''}" title="${escapeHtml(st.detail)}"${st.layerId ? '' : ' disabled'}>
          <span class="op-name">${escapeHtml(s.operatorLabel)}${st.sub ? `<small class="op-detail">${escapeHtml(st.sub)}</small>` : ''}${isBest ? `<span class="badge">${ICONS.star}${t('bestBadge')}</span>` : ''}</span>
          <span class="pill" style="background:${st.color};color:${st.textColor}">${escapeHtml(st.label)}</span>
        </button></li>`;
    })
    .join('');

  const bestText = !best.length
    ? t('noNetworkHere')
    : allTied
      ? t('allSame')
      : t('best', { ops: `<strong>${best.map((b) => escapeHtml(b.operatorLabel)).join(', ')}</strong>` });

  const area = coverage[0]?.area;
  const areaNote =
    zone === 'commune'
      ? area!.basis === 'surface'
        ? t('areaCommuneSurface')
        : t('areaCommunePop', { n: formatNumber(area!.inhabitants ?? 0) })
      : zone === 'circle'
        ? t(speedClasses ? 'areaShare' : 'areaCircle', { d: formatDistance(area!.radiusM ?? APPROX_RADIUS_M) })
        : '';
  // Débit : légende des couleurs de la carte.
  const legend = speedClasses
    ? (['fast', 'medium', 'slow'] as const).map((k) => `<span class="swatch" style="background:${SPEED_COLORS[k].color}"></span>${speedName(k)}`).join(' ')
    : '';

  // La carte complète (site web) ne couvre que la France pour l'instant.
  const fullMap = c === 'fr';

  show(
    `${placeHead(place, r, areaNote, zone === 'commune')}
    <section class="card">
      <p class="best-text">${best.length && !allTied ? ICONS.star : ''}<span>${bestText}</span></p>
      <ul class="operators">${rows}</ul>
    </section>
    <section class="card">
      <p class="map-caption">${t('mapCaption')} <strong id="map-layer"></strong>${legend ? ` <small class="map-legend">${legend}</small>` : ''}</p>
      <div id="minimap-slot"></div>
      ${fullMap ? `<p class="map-actions"><a id="full-map" class="btn" target="_blank" rel="noopener">${t('fullMap')} ${ICONS.arrow}</a></p>` : ''}
    </section>
    <p class="source">${t('sourceLine', { source: PRODUCERS[c] })} · <button type="button" class="link" data-info>${t('infoLink')}</button></p>
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
    const fill = speedClasses ? speedFillExpression(speedClasses) : undefined;
    miniMap?.show(c, layer, tilesUrl, place.lng, place.lat, zone === 'commune' ? 11 : 13, fill).catch(console.error);
  };
  out.querySelectorAll<HTMLButtonElement>('.cell').forEach((b) => b.addEventListener('click', () => select(b.dataset.layer!)));

  // Par défaut : la couche du meilleur opérateur (ou du premier), sinon une 4G.
  const defaultOp = best[0] ?? summaries[0];
  const fallback = defaultOp.byTechno['4g'] ?? Object.values(defaultOp.byTechno)[0];
  select(views.get(defaultOp.operator)!.layerId ?? fallback.layer.id);
}

/** En-tête commun d'un résultat : lieu, drapeau, zone évaluée, avertissement « centre de la commune ». */
function placeHead(place: GeocodeResult, r: Run, areaNote: string, communeZone = false) {
  const c = place.country;
  return `<section class="card">
      <div class="place-head">${ICONS.pin}<h2>${escapeHtml(place.label)}</h2><span class="flag" title="${countryName(c)}">${FLAGS[c]}</span></div>
      ${areaNote ? `<p class="area-note">${areaNote}</p>` : ''}
      ${['municipality', 'locality'].includes(place.type) && !r.note && !communeZone // le bandeau de la page le dit déjà
        ? `<p class="warning">${t('communeCenter')}</p>`
        : ''}
    </section>`;
}

/**
 * Italie, Suisse : nombre de réseaux qui couvrent (5G, 4G), sans dire lesquels.
 * Une ligne par techno ; un clic montre sa carte officielle.
 */
function renderNetworks(place: GeocodeResult, c: NetworkCountry, counts: NetworkCount[], r: Run) {
  const source = NETWORK_SOURCES[c];
  const pct = (v: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);
  const rows = counts
    .map((n) => {
      const colors = NETWORK_COLORS[networkKind(n)];
      const label = n.count ? t('outOf', { n: formatNumber(n.count), total: formatNumber(n.total) }) : t('status_none');
      // Infobulle sur une zone : répartition (« 3 sur 4 : 80 %, 2 sur 4 : 20 % »).
      const detail = n.area
        ? Object.entries(n.area.shares)
            .sort((a, b) => Number(b[0]) - Number(a[0]))
            .map(([k, v]) => `${Number(k) ? t('outOf', { n: formatNumber(Number(k)), total: formatNumber(n.total) }) : t('status_none')} : ${pct(v)}`)
            .join(', ')
        : '';
      return `<li><button type="button" class="cell" data-techno="${n.techno}"${detail ? ` title="${escapeHtml(detail)}"` : ''}>
          <span class="op-name">${n.techno.toUpperCase()}</span>
          <span class="pill" style="background:${colors.color};color:${colors.textColor}">${escapeHtml(label)}</span>
        </button></li>`;
    })
    .join('');
  const area = counts[0]?.area;
  const areaNote = area ? t('areaNetworks', { d: formatDistance(area.radiusM) }) : '';
  // Couleurs de la carte officielle ; une même couleur pour plusieurs nombres (Suisse : « 1–2 ») est groupée.
  const legend = source.colors
    .map((color, i) => ({ color, from: i + 1, to: source.colors.lastIndexOf(color) + 1 }))
    .filter((g, i) => source.colors.indexOf(g.color) === i)
    .map((g) => `<span class="swatch" style="background:${g.color}"></span>${formatNumber(g.from)}${g.to > g.from ? `–${formatNumber(g.to)}` : ''}`)
    .join(' ');

  show(
    `${placeHead(place, r, areaNote)}
    <section class="card">
      <p class="best-text"><span>${t('networksTitle')}</span></p>
      <ul class="operators">${rows}</ul>
      <p class="hint">${escapeHtml(t('unnamedOps', { ops: new Intl.ListFormat(locale(), { type: 'conjunction' }).format(source.operators) }))}</p>
    </section>
    <section class="card">
      <p class="map-caption">${t('mapCaption')} <strong id="map-layer"></strong> <small class="map-legend">${legend}</small></p>
      <div id="minimap-slot"></div>
    </section>
    <p class="source">${t('sourceLine', { source: PRODUCERS[c] })} · <button type="button" class="link" data-info>${t('infoLink')}</button></p>
    <div id="encart-slot"></div>`,
    r.note,
  );

  out.querySelector('[data-info]')!.addEventListener('click', () => void info.show());
  const miniMap = attachMiniMap(document.getElementById('minimap-slot')!, c);
  void fillEncart(document.getElementById('encart-slot')!);
  const select = (techno: NetworkTechno) => {
    out.querySelectorAll<HTMLElement>('.cell').forEach((b) => b.classList.toggle('selected', b.dataset.techno === techno));
    document.getElementById('map-layer')!.textContent = t('mapNetworks', { techno: techno.toUpperCase() });
    const shapes = counts.find((n) => n.techno === techno)?.shapes;
    miniMap?.showNetworks(source, techno, shapes, place.lng, place.lat, 13).catch(console.error);
  };
  out.querySelectorAll<HTMLButtonElement>('.cell').forEach((b) => b.addEventListener('click', () => select(b.dataset.techno as NetworkTechno)));
  // Par défaut : la 5G si au moins un réseau, sinon la 4G.
  select(counts.find((n) => n.techno === '5g')?.count ? '5g' : '4g');
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
    // Pas de pays publié pour une sélection : « other » impossible, repli sur le pays choisi par sûreté.
    const where = countryOf({ text: p.text, host: hostOf(p.pageUrl) });
    void run(p.text, { where: where === 'other' ? country : where });
  } else if (p.kind === 'not-lodging-page') {
    currentRun?.abort();
    message({
      icon: ICONS.house,
      title: t('openListing'),
      body: `<p>${t('thenClickIcon')}</p>`,
    });
  } else if (p.kind === 'page-error') {
    currentRun?.abort();
    message({
      icon: ICONS.select,
      title: t('noAddress'),
      body: `<p>${t('noAddressHint')}</p>`,
    });
    search.focus();
  } else {
    // Adresse lue sur la page : on l'affiche pour que l'utilisateur puisse la vérifier.
    const what = [p.name, p.address].filter(Boolean).map((s) => escapeHtml(s!)).join(' — ');
    const radius = p.radiusM ?? (p.precision === 'approximate' ? APPROX_RADIUS_M : undefined);
    // Précision publiée par le site : on la dit clairement.
    const precisionNote = {
      exact: '',
      approximate: `<br />${t('approxNote')}`,
      commune: `<br />${t('communeOnly')}`,
    }[p.precision ?? 'exact'];
    const note = t('readOnPage', { what }) + precisionNote;
    if (p.lat !== undefined && p.lng !== undefined) {
      // Coordonnées publiées par la page : pas besoin de géocoder ; le pays se déduit du point.
      search.setText(p.address ?? p.name ?? '');
      const c = countryAt(p.lng, p.lat);
      if (!c) {
        currentRun?.abort();
        message(
          {
            icon: ICONS.pin,
            title: t('countryNotCovered'),
            body: `<p>${escapeHtml(t('coversCountries', { countries: countriesList() }))}</p>`,
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
      // Pays publié par l'annonce ou propre au site, sinon celui du site, sinon le pays choisi.
      const where = countryOf({ text: p.address, published: p.country, host: p.pageHost });
      if (where === 'other') {
        currentRun?.abort();
        message({ icon: ICONS.pin, title: t('countryNotCovered'), body: `<p>${escapeHtml(t('coversCountries', { countries: countriesList() }))}</p>` }, note);
        return;
      }
      void run(cleanAddress(p.address!), { note, radiusM: radius, where });
    }
  }
}

/** Au-delà, une requête déposée par l'arrière-plan est considérée comme ancienne. */
const PENDING_MAX_AGE_MS = 30_000;

/** Démarrage : pays mémorisé, puis requête en attente (ou accueil). */
async function start() {
  // Tests hors extension : panel.html?q=<texte>[&url=<page>] (clic droit), ?pays=es&q=<texte> (saisie),
  // ?page=<JSON> (adresse lue sur une page).
  const params = new URLSearchParams(location.search);
  const testCountry = params.get('pays');
  const testQuery = params.get('q');
  const testPage = params.get('page');

  // Langue choisie (ou du navigateur) avant tout affichage ; ?lang=en pour les tests.
  await initLang(params.get('lang'));
  translatePage();
  labelCountryButtons();
  setupLanguageSelect();

  try {
    const saved = (await api?.storage.local.get(COUNTRY_KEY))?.[COUNTRY_KEY];
    // Tests : ?choisi=fr fixe le pays choisi (comme un clic sur les boutons) sans forcer la saisie.
    const chosen = params.get('choisi');
    setCountry(isCountryCode(testCountry) ? testCountry : isCountryCode(chosen) ? chosen : isCountryCode(saved) ? saved : 'fr', false);
  } catch {
    setCountry('fr', false);
  }

  if (testQuery) {
    if (isCountryCode(testCountry)) void run(testQuery, { where: testCountry });
    else handlePending({ kind: 'selection', text: testQuery, pageUrl: params.get('url') ?? undefined, at: Date.now() });
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

// Page d'infos : choix de la langue, et version (pour vérifier que la bonne version est chargée).
function setupLanguageSelect() {
  document.getElementById('version')!.textContent = t('version', { v: api?.runtime.getManifest().version ?? 'test' });
  const select = document.getElementById('lang-select') as HTMLSelectElement;
  select.replaceChildren(...LANGS.map((l) => new Option(LANG_LABELS[l], l, false, l === lang())));
  select.addEventListener('change', async () => {
    try {
      await api?.storage.local.set({ [LANG_KEY]: select.value as Lang });
    } catch {
      // stockage indisponible : la langue ne sera pas retenue
    }
    location.reload(); // tous les textes, y compris ceux déjà affichés
  });
}

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
