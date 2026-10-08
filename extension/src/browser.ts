/**
 * Accès à l'API d'extension commun à Chrome/Edge et Firefox.
 *
 * Firefox expose `browser` (et un alias `chrome`), Chrome seulement `chrome`.
 * En MV3, les deux renvoient des promesses. Les seules différences utilisées
 * ici : `sidePanel` (Chrome/Edge) contre `sidebarAction` (Firefox).
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

/** Requête en attente, déposée par le menu contextuel pour le panneau. */
export interface PendingQuery {
  text: string;
  at: number; // horodatage : permet de relancer la même sélection deux fois
}

export const PENDING_KEY = 'pendingQuery';
