/**
 * Pages d'annonces de logement dont l'adresse peut être vérifiée en un clic.
 *
 * Détection : c'est le NAVIGATEUR qui compare l'URL de l'onglet à ces motifs
 * (declarativeContent sous Chrome/Edge, page_action.show_matches et
 * documentUrlPatterns sous Firefox, et le content script de la carte limité à
 * ces mêmes pages).
 *
 * Lecture : seulement après un clic de l'utilisateur (carte, icône ou clic
 * droit), et seulement la localisation publiée par la page :
 *  - `jsonld`    : données structurées schema.org (adresse, `geo`, ou
 *                  `latitude`/`longitude` directement sur l'objet) ;
 *  - `leboncoin` : localisation de l'annonce dans les données de la page
 *                  (pas de schema.org sur ce site ; format propre, à surveiller).
 * Sites vérifiés le 2026-10-08. Non retenus : Trivago (ni adresse ni page par
 * hôtel), Abritel (aucune localisation publiée).
 */

export type LodgingReader = 'jsonld' | 'leboncoin';

export interface LodgingSite {
  /** Nom affiché dans les messages. */
  label: string;
  /** Motif d'URL (format des manifestes et des menus contextuels). */
  match: string;
  /** Même motif pour declarativeContent (Chrome/Edge) et la vérification au clic. */
  hostSuffix: string;
  pathPrefix: string;
  reader: LodgingReader;
  /** Le site ne publie qu'un emplacement approximatif (adresse exacte après réservation). */
  approximate: boolean;
}

const site = (label: string, host: string, path: string, reader: LodgingReader, approximate: boolean): LodgingSite => ({
  label,
  match: `*://*.${host}${path}*`,
  hostSuffix: host,
  pathPrefix: path,
  reader,
  approximate,
});

export const LODGING_SITES: LodgingSite[] = [
  site('Booking', 'booking.com', '/hotel/', 'jsonld', false),
  // Airbnb : coordonnées volontairement approximatives avant réservation.
  ...['airbnb.fr', 'airbnb.com', 'airbnb.be', 'airbnb.ch', 'airbnb.ca'].map((host) =>
    site('Airbnb', host, '/rooms/', 'jsonld', true),
  ),
  // Leboncoin : annonces immobilières seulement (pas les voitures, l'électroménager…).
  ...['/ad/locations/', '/ad/locations_gites/', '/ad/ventes_immobilieres/', '/ad/colocations/'].map((path) =>
    site('Leboncoin', 'leboncoin.fr', path, 'leboncoin', true),
  ),
];

export const LODGING_MATCHES = LODGING_SITES.map((s) => s.match);

/** Partie des sites transmise à la fonction injectée (doit être sérialisable). */
export const LODGING_RULES = LODGING_SITES.map(({ hostSuffix, pathPrefix, reader, approximate }) => ({
  hostSuffix,
  pathPrefix,
  reader,
  approximate,
}));

/** L'URL d'un onglet (connue seulement après un clic, grâce à activeTab) est-elle une page d'annonce ? */
export function isLodgingUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return LODGING_SITES.some(
      (s) => (u.hostname === s.hostSuffix || u.hostname.endsWith(`.${s.hostSuffix}`)) && u.pathname.startsWith(s.pathPrefix),
    );
  } catch {
    return false;
  }
}

export interface PageAddress {
  /** La page n'est pas une annonce reconnue : rien n'a été lu. */
  notLodging?: true;
  /** …mais c'est le même site (ex. liste de résultats) : le panneau explique quoi faire. */
  sameSite?: boolean;
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  /** Emplacement approximatif (le site ne publie pas l'adresse exacte). */
  approximate?: boolean;
}

/**
 * Exécutée DANS la page, au clic de l'utilisateur (scripting.executeScript ou
 * carte). Doit rester autonome : le navigateur la sérialise, elle ne peut rien
 * importer ni utiliser de variable extérieure (les règles sont passées en
 * argument). Vérifie d'abord que la page est une annonce reconnue (sinon ne lit
 * rien), puis lit uniquement la localisation publiée.
 */
export function extractStructuredAddress(rules: typeof LODGING_RULES): PageAddress | null {
  const host = location.hostname;
  const onSite = rules.filter((r) => host === r.hostSuffix || host.endsWith(`.${r.hostSuffix}`));
  const rule = onSite.find((r) => location.pathname.startsWith(r.pathPrefix));
  if (!rule) return { notLodging: true, sameSite: onSite.length > 0 }; // seule l'adresse de la page a été regardée

  const result: PageAddress = { approximate: rule.approximate };
  const setCoords = (lat: unknown, lng: unknown) => {
    const la = Number(lat), lo = Number(lng);
    if (Number.isFinite(la) && Number.isFinite(lo) && (la !== 0 || lo !== 0)) {
      result.lat = la;
      result.lng = lo;
    }
  };

  if (rule.reader === 'leboncoin') {
    // Données de la page (Next.js) : props.pageProps.ad.{subject, location}.
    try {
      const data = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent ?? '');
      const ad = data?.props?.pageProps?.ad;
      const loc = ad?.location;
      if (typeof ad?.subject === 'string') result.name = ad.subject;
      result.address = [loc?.zipcode, loc?.city].filter(Boolean).join(' ') || undefined;
      setCoords(loc?.lat, loc?.lng);
    } catch {
      // format inattendu : rien de lisible
    }
  } else {
    const found: Record<string, unknown>[] = [];
    const visit = (node: unknown, depth: number) => {
      if (!node || typeof node !== 'object' || depth > 4) return;
      if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
      const obj = node as Record<string, unknown>;
      if (obj.address || obj.geo || obj.latitude !== undefined) found.push(obj);
      visit(obj['@graph'], depth + 1);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        visit(JSON.parse(script.textContent ?? ''), 0);
      } catch {
        // bloc JSON-LD invalide : ignoré
      }
    }
    const item = found[0];
    if (item) {
      if (typeof item.name === 'string') result.name = item.name;
      const addr = item.address as string | Record<string, string> | undefined;
      if (typeof addr === 'string') {
        result.address = addr;
      } else if (addr && typeof addr === 'object') {
        const street = addr.streetAddress ?? '';
        const postal = addr.postalCode ?? '';
        // Certains sites mettent l'adresse complète dans streetAddress (code postal compris).
        result.address = postal && street.includes(postal)
          ? street
          : [street, [postal, addr.addressLocality].filter(Boolean).join(' ')].filter(Boolean).join(', ') || undefined;
      }
      const geo = item.geo as Record<string, unknown> | undefined;
      setCoords(geo?.latitude ?? item.latitude, geo?.longitude ?? item.longitude);
    }
  }
  return result.address || result.lat !== undefined ? result : null;
}
