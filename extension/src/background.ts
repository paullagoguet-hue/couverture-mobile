/**
 * Arrière-plan de l'extension (service worker sous Chrome, page d'événements
 * sous Firefox).
 *
 * Ce que l'extension lit, et quand :
 *  - `info.selectionText`, fourni par le menu contextuel quand l'utilisateur
 *    clique « Vérifier la couverture réseau » sur un texte sélectionné ;
 *  - sur une page d'hébergement reconnue (cf. lodging.ts), et SEULEMENT après
 *    un clic de l'utilisateur, l'adresse publiée dans les données structurées
 *    de la page (permission activeTab : accès temporaire à cet onglet).
 * Aucun script n'est injecté en permanence et aucune permission d'hôte n'est demandée.
 */
import { api, pageAction, PENDING_KEY, sidebarAction, type PendingBody } from './browser.ts';
import { ICON_SIZES, iconPixels } from './icon.ts';
import { extractStructuredAddress, isLodgingUrl, LODGING_MATCHES, LODGING_SITES } from './lodging.ts';

const MENU_SELECTION = 'verifier-couverture';
const MENU_PAGE = 'verifier-hebergement';

api.runtime.onInstalled.addListener(async () => {
  // À la mise à jour (ou au rechargement en développement), les entrées existent
  // déjà : on repart de zéro pour éviter les erreurs d'identifiant en double.
  await api.contextMenus.removeAll();
  api.contextMenus.create({
    id: MENU_SELECTION,
    title: 'Vérifier la couverture réseau',
    contexts: ['selection'],
  });
  // N'apparaît que sur les pages d'hébergement reconnues (filtrage fait par le navigateur).
  api.contextMenus.create({
    id: MENU_PAGE,
    title: 'Vérifier la connexion de cet hébergement',
    contexts: ['page'],
    documentUrlPatterns: LODGING_MATCHES,
  });

  // Chrome/Edge : pastille sur l'icône quand l'onglet affiche une page d'hébergement.
  // Le navigateur évalue la règle lui-même, sans permission d'hôte.
  const dc = api.declarativeContent;
  if (dc) {
    const imageData = Object.fromEntries(
      ICON_SIZES.filter((s) => s <= 32).map((s) => [s, new ImageData(iconPixels(s, true), s, s)]),
    );
    dc.onPageChanged.removeRules(undefined, () => {
      dc.onPageChanged.addRules([
        {
          conditions: LODGING_SITES.map(
            (s) => new dc.PageStateMatcher({ pageUrl: { hostSuffix: s.hostSuffix, pathPrefix: s.pathPrefix } }),
          ),
          actions: [new dc.SetIcon({ imageData })],
        },
      ]);
    });
  }
});

/** Ouvre le panneau. À appeler AVANT tout `await` : exige un geste de l'utilisateur. */
function openPanel(tab: chrome.tabs.Tab | undefined) {
  if (api.sidePanel && tab?.windowId !== undefined) {
    api.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
  } else {
    sidebarAction?.open().catch(console.error);
  }
}

function sendToPanel(query: PendingBody) {
  // Le panneau lit la requête au chargement, ou la reçoit s'il est déjà ouvert.
  api.storage.session.set({ [PENDING_KEY]: { ...query, at: Date.now() } }).catch(console.error);
}

/** Lit l'adresse de la page d'hébergement active (appelé uniquement après un clic). */
async function checkLodgingPage(tab: chrome.tabs.Tab) {
  if (tab.id === undefined) return;
  try {
    const [injection] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: extractStructuredAddress });
    const found = injection?.result;
    sendToPanel(found ? { kind: 'page', ...found } : { kind: 'page-error' });
  } catch (err) {
    console.error(err);
    sendToPanel({ kind: 'page-error' });
  }
}

// Clic droit sur une sélection, ou sur une page d'hébergement.
api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_SELECTION && info.selectionText) {
    openPanel(tab);
    sendToPanel({ kind: 'selection', text: info.selectionText });
  } else if (info.menuItemId === MENU_PAGE && tab) {
    openPanel(tab);
    void checkLodgingPage(tab);
  }
});

// Clic sur l'icône : ouvre le panneau (saisie manuelle) ; sur une page
// d'hébergement, lit en plus son adresse. L'URL de l'onglet n'est connue
// qu'à ce moment-là, grâce à activeTab.
if (api.sidePanel) api.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
api.action.onClicked.addListener((tab) => {
  if (isLodgingUrl(tab.url)) {
    openPanel(tab);
    void checkLodgingPage(tab);
  } else if (api.sidePanel) {
    openPanel(tab);
  } else {
    void sidebarAction?.toggle();
  }
});

// Firefox : icône dans la barre d'adresse, affichée seulement sur les pages d'hébergement.
pageAction?.onClicked.addListener((tab) => {
  openPanel(tab);
  void checkLodgingPage(tab);
});
