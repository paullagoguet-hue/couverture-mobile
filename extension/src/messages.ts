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

/** Préférence « Ne plus proposer » de la carte (storage.local). */
export const CARD_DISABLED_KEY = 'cardDisabled';
