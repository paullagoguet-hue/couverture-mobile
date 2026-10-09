/** Messages échangés entre la carte (content script) et l'arrière-plan. */
import type { PageAddress } from './lodging.ts';

export interface CheckPageMessage {
  type: 'check-lodging-page';
  /** Adresse lue sur la page au clic de l'utilisateur (null si la page n'en publie pas). */
  found: PageAddress | null;
}

export interface CheckPageResponse {
  /** Le panneau a pu être ouvert (sinon la carte indique comment l'afficher). */
  panelOpened: boolean;
}

/**
 * Proposition de vérification sur les pages d'annonces (storage.local) :
 * désactivée par défaut, l'utilisateur l'active lui-même depuis le panneau.
 */
export const CARD_ENABLED_KEY = 'cardEnabled';
