/**
 * Arrière-plan de l'extension (service worker sous Chrome, page d'événements
 * sous Firefox).
 *
 * Seule source de données : `info.selectionText`, fourni par l'API des menus
 * contextuels quand l'utilisateur clique sur notre entrée. Aucun script n'est
 * injecté dans les pages et le contenu des sites n'est jamais lu.
 */
import { api, PENDING_KEY, sidebarAction, type PendingQuery } from './browser.ts';

const MENU_ID = 'verifier-couverture';

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: MENU_ID,
    title: 'Vérifier la couverture réseau',
    contexts: ['selection'],
  });
});

// Clic sur l'icône : Chrome/Edge ouvrent le panneau latéral eux-mêmes ;
// sous Firefox, on bascule la barre latérale.
if (api.sidePanel) {
  api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
} else if (sidebarAction) {
  const sidebar = sidebarAction;
  api.action.onClicked.addListener(() => void sidebar.toggle());
}

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;

  // L'ouverture du panneau doit se faire AVANT tout `await` : les navigateurs
  // ne l'autorisent qu'en réponse directe à un geste de l'utilisateur.
  if (api.sidePanel && tab?.windowId !== undefined) {
    api.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
  } else {
    sidebarAction?.open().catch(console.error);
  }

  // Le panneau lit la requête au chargement, ou la reçoit s'il est déjà ouvert.
  const pending: PendingQuery = { text: info.selectionText, at: Date.now() };
  api.storage.session.set({ [PENDING_KEY]: pending }).catch(console.error);
});
