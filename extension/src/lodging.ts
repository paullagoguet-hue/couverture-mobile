/**
 * Pages d'annonces de logement dont l'adresse peut être vérifiée en un clic.
 *
 * Détection : c'est le NAVIGATEUR qui compare l'URL de l'onglet aux motifs
 * (declarativeContent sous Chrome/Edge, page_action.show_matches et
 * documentUrlPatterns sous Firefox, content script de la carte). Les motifs du
 * manifeste sont parfois plus larges que la fiche elle-même (adresses sans
 * préfixe fixe) : la carte et la lecture revérifient alors `pathRegex`.
 *
 * Lecture : seulement après un clic de l'utilisateur (carte, icône ou clic
 * droit), et seulement la localisation publiée par la page. Lecteurs :
 *  - `schema`      : données structurées schema.org, JSON-LD puis microdonnées.
 *                    Les objets « organisation » / « site web » sont écartés :
 *                    certains sites y publient l'adresse de LEUR siège.
 *  - `leboncoin`   : localisation de l'annonce dans les données de la page.
 *  - `map-attr`    : coordonnées portées par l'élément carte de la fiche.
 *  - `url-commune` : commune et code postal présents dans l'adresse de la page.
 *
 * Sites vérifiés le 2026-10-08 sur des annonces réelles. Non retenus :
 * Trivago (comparateur, ni adresse ni page par hôtel), Abritel et Clévacances
 * (aucune localisation publiée).
 */

export type LodgingReader = 'schema' | 'leboncoin' | 'map-attr' | 'url-commune';

/** Précision de la localisation publiée par le site. */
export type Precision = 'exact' | 'approximate' | 'commune';

export interface LodgingSite {
  label: string;
  /** Domaine (sous-domaines compris). */
  host: string;
  /** Motifs de chemin pour le manifeste et les menus (« * » = n'importe quoi). */
  paths: string[];
  /** Expression régulière exacte des fiches (chemin de l'URL). */
  pathRegex: string;
  reader: LodgingReader;
  precision: Precision;
}

const sites = (
  label: string,
  hosts: string[],
  paths: string[],
  pathRegex: string,
  reader: LodgingReader,
  precision: Precision,
): LodgingSite[] => hosts.map((host) => ({ label, host, paths, pathRegex, reader, precision }));

export const LODGING_SITES: LodgingSite[] = [
  // Hôtels
  ...sites('Booking', ['booking.com'], ['/hotel/*'], '^/hotel/', 'schema', 'exact'),
  ...sites('Expedia', ['expedia.fr', 'expedia.com', 'expedia.be', 'expedia.ca', 'expedia.ch'], ['/*Hotel*'],
    '\\.h\\d+\\.(Hotel-Information|Description-Hotel)', 'schema', 'exact'),
  ...sites('Hotels.com', ['hotels.com'], ['/ho*'], '^/ho\\d+', 'schema', 'exact'),
  ...sites('Tripadvisor', ['tripadvisor.fr', 'tripadvisor.com', 'tripadvisor.be', 'tripadvisor.ch', 'tripadvisor.ca'],
    ['/Hotel_Review-*', '/VacationRentalReview-*'], '^/(Hotel_Review|VacationRentalReview)-', 'schema', 'exact'),
  // Locations de vacances (adresse exacte communiquée après réservation)
  ...sites('Airbnb', ['airbnb.fr', 'airbnb.com', 'airbnb.be', 'airbnb.ch', 'airbnb.ca'], ['/rooms/*'], '^/rooms/', 'schema', 'approximate'),
  ...sites('Gîtes de France', ['gites-de-france.com'], ['/*/*/*/*'], '^/[a-z]{2}/[^/]+/[^/]+/[^/]+-\\d{2,3}[a-z]\\d+', 'map-attr', 'approximate'),
  // Immobilier
  ...sites('Leboncoin', ['leboncoin.fr'], ['/ad/locations/*', '/ad/locations_gites/*', '/ad/ventes_immobilieres/*', '/ad/colocations/*'],
    '^/ad/(locations|locations_gites|ventes_immobilieres|colocations)/', 'leboncoin', 'approximate'),
  ...sites('PAP', ['pap.fr'], ['/annonces/*'], '^/annonces/[^/]+-r\\d+', 'schema', 'approximate'),
  ...sites("Bien'ici", ['bienici.com'], ['/annonce/*'], '^/annonce/', 'schema', 'commune'),
  ...sites('SeLoger', ['seloger.com'], ['/annonce/*'], '^/annonce/.+/[a-z0-9-]+-\\d{5}/', 'url-commune', 'commune'),
];

/** Motifs d'URL pour le manifeste (content script, page_action) et les menus. */
export const LODGING_MATCHES = [...new Set(LODGING_SITES.flatMap((s) => s.paths.map((p) => `*://*.${s.host}${p}`)))];

/** Partie des sites transmise à la fonction injectée (doit être sérialisable). */
export const LODGING_RULES = LODGING_SITES.map(({ host, pathRegex, reader, precision }) => ({ host, pathRegex, reader, precision }));
export type LodgingRule = (typeof LODGING_RULES)[number];

const onHost = (hostname: string, host: string) => hostname === host || hostname.endsWith(`.${host}`);

/** L'URL d'un onglet (connue seulement après un clic, grâce à activeTab) est-elle une fiche reconnue ? */
export function isLodgingUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return LODGING_SITES.some((s) => onHost(u.hostname, s.host) && new RegExp(s.pathRegex).test(u.pathname));
  } catch {
    return false;
  }
}

/** Expression RE2 de l'URL complète, pour declarativeContent (Chrome/Edge). */
export function urlRegexFor(site: LodgingSite): string {
  const host = site.host.replace(/\./g, '\\.');
  const path = site.pathRegex.startsWith('^') ? site.pathRegex.slice(1) : `/.*${site.pathRegex}`;
  return `^https?://([^/]+\\.)?${host}(:\\d+)?${path}`;
}

export interface PageAddress {
  /** La page n'est pas une fiche reconnue : rien n'a été lu. */
  notLodging?: true;
  /** …mais c'est le même site (ex. liste de résultats) : le panneau explique quoi faire. */
  sameSite?: boolean;
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  precision?: Precision;
}

/**
 * Exécutée DANS la page, au clic de l'utilisateur (scripting.executeScript ou
 * carte). Doit rester autonome : le navigateur la sérialise, elle ne peut rien
 * importer ni utiliser de variable extérieure (les règles sont passées en
 * argument). Vérifie d'abord que la page est une fiche reconnue (sinon ne lit
 * rien), puis lit uniquement la localisation publiée.
 */
export function extractStructuredAddress(rules: LodgingRule[]): PageAddress | null {
  const hostname = location.hostname;
  const onSite = rules.filter((r) => hostname === r.host || hostname.endsWith(`.${r.host}`));
  const rule = onSite.find((r) => new RegExp(r.pathRegex).test(location.pathname));
  if (!rule) return { notLodging: true, sameSite: onSite.length > 0 }; // seule l'adresse de la page a été regardée

  const result: PageAddress = { precision: rule.precision };
  const setCoords = (lat: unknown, lng: unknown) => {
    const la = Number(lat), lo = Number(lng);
    if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && (la !== 0 || lo !== 0)) {
      result.lat = la;
      result.lng = lo;
    }
  };
  const formatAddress = (addr: unknown): string | undefined => {
    if (typeof addr === 'string') return addr.trim() || undefined;
    if (!addr || typeof addr !== 'object') return undefined;
    const a = addr as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const street = str(a.streetAddress), postal = str(a.postalCode), city = str(a.addressLocality);
    // Certains sites mettent l'adresse complète dans streetAddress (code postal compris).
    if (postal && street.includes(postal)) return street;
    return [street, [postal, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || undefined;
  };

  if (rule.reader === 'leboncoin') {
    // Données de la page (Next.js) : props.pageProps.ad.{subject, location}.
    try {
      const ad = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent ?? '')?.props?.pageProps?.ad;
      const loc = ad?.location;
      if (typeof ad?.subject === 'string') result.name = ad.subject;
      result.address = [loc?.zipcode, loc?.city].filter(Boolean).join(' ') || undefined;
      setCoords(loc?.lat, loc?.lng);
    } catch {
      // format inattendu : rien de lisible
    }
  } else if (rule.reader === 'map-attr') {
    // Élément carte de la fiche : <div id="map-accommodation" data-lat data-lng data-map-info>.
    const map = document.querySelector<HTMLElement>('#map-accommodation[data-lat][data-lng]');
    if (map) {
      setCoords(map.dataset.lat, map.dataset.lng);
      try {
        const title = JSON.parse(map.dataset.mapInfo ?? '{}').title;
        if (typeof title === 'string') result.name = title;
      } catch {
        // pas de titre lisible
      }
    }
  } else if (rule.reader === 'url-commune') {
    // …/{commune}-{code postal}/… dans l'adresse de la page.
    const m = location.pathname.match(/\/([a-z0-9-]+?)-(\d{5})\//i);
    if (m) result.address = `${m[2]} ${m[1].replace(/-/g, ' ')}`;
    if (document.title) result.name = document.title.slice(0, 120);
  } else {
    // schema.org : JSON-LD puis microdonnées. On écarte l'éditeur du site
    // (organisation, site web…) et on préfère les objets de type logement.
    const SKIP = /^(Organization|Corporation|WebSite|WebPage|BreadcrumbList|Brand|Person|ImageObject|Offer|AggregateRating|Rating)$/;
    const PREFER = /Hotel|Lodging|Accommodation|VacationRental|Apartment|House|Residence|Room|Suite|BedAndBreakfast|Hostel|Resort|Campground|RealEstateListing|Place/;
    const typeOf = (o: Record<string, unknown>) => [o['@type']].flat().map(String).join(' ');
    const candidates: Record<string, unknown>[] = [];
    const visit = (node: unknown, depth: number) => {
      if (!node || typeof node !== 'object' || depth > 6) return;
      if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
      const obj = node as Record<string, unknown>;
      const type = typeOf(obj);
      if (!SKIP.test(type) && (obj.address || obj.geo || obj.latitude !== undefined)) candidates.push(obj);
      for (const key of ['@graph', 'itemOffered', 'about', 'mainEntity', 'containsPlace', 'location']) visit(obj[key], depth + 1);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        visit(JSON.parse(script.textContent ?? ''), 0);
      } catch {
        // bloc JSON-LD invalide : ignoré
      }
    }
    const item = candidates.find((c) => PREFER.test(typeOf(c))) ?? candidates[0];
    if (item) {
      if (typeof item.name === 'string') result.name = item.name;
      result.address = formatAddress(item.address);
      const geo = item.geo as Record<string, unknown> | undefined;
      setCoords(geo?.latitude ?? item.latitude, geo?.longitude ?? item.longitude);
    } else {
      // Microdonnées (itemscope / itemprop), ex. Expedia, Hotels.com.
      const scope = [...document.querySelectorAll<HTMLElement>('[itemscope][itemtype]')].find(
        (e) => PREFER.test(e.getAttribute('itemtype') ?? '') && e.querySelector('[itemprop="address"], [itemprop="latitude"]'),
      );
      if (scope) {
        const prop = (name: string) => {
          const el = scope.querySelector<HTMLElement>(`[itemprop="${name}"]`);
          return (el?.getAttribute('content') ?? el?.textContent ?? '').trim();
        };
        result.name = prop('name') || undefined;
        result.address = formatAddress({ streetAddress: prop('streetAddress'), postalCode: prop('postalCode'), addressLocality: prop('addressLocality') });
        setCoords(prop('latitude'), prop('longitude'));
      }
    }
  }
  // Certains sites laissent des entités HTML dans leurs données (« 5&nbsp;pièces ») :
  // décodage en texte brut (DOMParser n'exécute aucun script).
  const decode = (s: string | undefined) =>
    s === undefined ? undefined : (new DOMParser().parseFromString(s, 'text/html').documentElement.textContent ?? s).replace(/\s+/g, ' ').trim() || undefined;
  result.name = decode(result.name);
  result.address = decode(result.address);
  return result.address || result.lat !== undefined ? result : null;
}
