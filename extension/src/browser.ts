/**
 * Accès à l'API d'extension commun à Chrome/Edge et Firefox.
 *
 * Firefox expose `browser` (et un alias `chrome`), Chrome seulement `chrome`.
 * En MV3, les deux renvoient des promesses. Différences gérées ici :
 * `sidePanel` (Chrome/Edge) contre `sidebarAction` / `pageAction` (Firefox).
 */
declare const browser: typeof chrome | undefined;

/**
 * API d'extension, ou `undefined` hors extension (page du panneau ouverte
 * directement dans un onglet pour les tests : les pages web ordinaires n'ont
 * pas `storage`).
 */
export const api: typeof chrome = (
  typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' && chrome.storage ? chrome : undefined
)!;

/** API Firefox de barre latérale (absente des types Chrome). */
export interface SidebarAction {
  open(): Promise<void>;
  toggle(): Promise<void>;
}

export const sidebarAction = (api as unknown as { sidebarAction?: SidebarAction } | undefined)?.sidebarAction;

/** API Firefox d'icône dans la barre d'adresse (affichée sur les pages d'hébergement). */
export const pageAction = (api as unknown as { pageAction?: { onClicked: chrome.events.Event<(tab: chrome.tabs.Tab) => void> } } | undefined)
  ?.pageAction;

/** Contenu d'une requête déposée par l'arrière-plan pour le panneau. */
export type PendingBody =
  | { kind: 'selection'; text: string } // texte sélectionné + clic droit
  | { kind: 'page'; name?: string; address?: string; lat?: number; lng?: number } // adresse lue sur la page
  | { kind: 'page-error' }; // page d'hébergement sans adresse lisible

export type PendingQuery = PendingBody & { at: number };

export const PENDING_KEY = 'pendingQuery';
