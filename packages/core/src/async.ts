/**
 * Outils pour les ressources partagées entre plusieurs recherches (manifeste,
 * fichiers de communes, tuiles) : leur téléchargement ne doit pas dépendre du
 * signal d'annulation de la première recherche qui les a demandées, sinon
 * annuler celle-ci (nouvelle recherche lancée juste après) ferait échouer
 * toutes les autres qui attendent la même ressource.
 */

/** Délai max d'un téléchargement partagé (au-delà, échec puis nouvel essai possible). */
export const SHARED_FETCH_TIMEOUT_MS = 30_000;

/**
 * Attend `promise`, mais rejette dès que `signal` est annulé — sans annuler
 * le travail sous-jacent, qui reste disponible pour les autres demandeurs.
 */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}
