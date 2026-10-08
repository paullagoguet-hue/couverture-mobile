/**
 * Pages d'hébergement dont l'adresse peut être vérifiée en un clic.
 *
 * Détection : c'est le NAVIGATEUR qui compare l'URL de l'onglet à ces motifs
 * (declarativeContent sous Chrome/Edge, page_action.show_matches et
 * documentUrlPatterns des menus sous Firefox). L'extension ne voit ni l'URL ni
 * le contenu des pages tant que l'utilisateur n'a pas cliqué.
 *
 * Lecture : au clic seulement, via la permission activeTab (accès temporaire à
 * l'onglet actif), on lit l'adresse publiée dans les données structurées
 * schema.org de la page. Rien d'autre n'est lu.
 */

export interface LodgingSite {
  /** Motif d'URL (format des manifestes et des menus contextuels). */
  match: string;
  /** Même motif pour declarativeContent (Chrome/Edge). */
  hostSuffix: string;
  pathPrefix: string;
}

export const LODGING_SITES: LodgingSite[] = [
  { match: '*://*.booking.com/hotel/*', hostSuffix: 'booking.com', pathPrefix: '/hotel/' },
];

export const LODGING_MATCHES = LODGING_SITES.map((s) => s.match);

/** L'URL d'un onglet (connue seulement après un clic, grâce à activeTab) est-elle une page d'hébergement ? */
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
  /** La page n'est pas une page d'hébergement reconnue : rien n'a été lu. */
  notLodging?: true;
  /** …mais c'est le même site (ex. liste de résultats) : le panneau explique quoi faire. */
  sameSite?: boolean;
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
}

/**
 * Exécutée DANS la page, au clic de l'utilisateur (scripting.executeScript).
 * Doit rester autonome : le navigateur la sérialise, elle ne peut rien
 * importer ni utiliser de variable extérieure (les motifs de pages sont passés
 * en argument). Vérifie d'abord que la page est une page d'hébergement reconnue
 * (sinon ne lit rien), puis ne lit que les blocs JSON-LD.
 */
export function extractStructuredAddress(sites: { hostSuffix: string; pathPrefix: string }[]): PageAddress | null {
  const host = location.hostname;
  const onSite = sites.filter((s) => host === s.hostSuffix || host.endsWith(`.${s.hostSuffix}`));
  if (!onSite.some((s) => location.pathname.startsWith(s.pathPrefix))) {
    return { notLodging: true, sameSite: onSite.length > 0 }; // seule l'adresse de la page a été regardée
  }

  const found: Record<string, unknown>[] = [];
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 4) return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    const obj = node as Record<string, unknown>;
    if (obj.address || obj.geo) found.push(obj);
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
  if (!item) return null;

  const result: PageAddress = {};
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
      : [street, [postal, addr.addressLocality].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }

  const geo = item.geo as Record<string, string | number> | undefined;
  const lat = Number(geo?.latitude), lng = Number(geo?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    result.lat = lat;
    result.lng = lng;
  }
  return result.address || result.lat !== undefined ? result : null;
}
