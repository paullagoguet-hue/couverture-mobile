# Politique de confidentialité — extension « Vérifier la couverture réseau »

*Dernière mise à jour : [à compléter à la publication]*
*Éditeur : [nom ou raison sociale à compléter] — contact : [adresse e-mail à compléter]*

L'extension « Vérifier la couverture réseau » affiche la couverture mobile
théorique (données publiques de l'Arcep) à une adresse. Elle n'a pas de
compte utilisateur, ne dépose pas de cookie, n'utilise aucun outil de mesure
d'audience et ne vend ni ne partage aucune donnée à des fins commerciales.

## Ce que l'extension lit, et quand

L'extension ne lit **jamais** le contenu des pages que vous visitez, sauf
dans les cas suivants, **toujours à la suite d'une action de votre part** :

| Action de votre part | Ce qui est lu |
|---|---|
| Vous sélectionnez un texte puis choisissez « Vérifier la couverture réseau » dans le menu du clic droit | Le texte sélectionné |
| Vous tapez une adresse dans le panneau de l'extension | Le texte saisi |
| Sur la page d'une annonce de logement d'un site pris en charge, vous cliquez sur « Vérifier » (encadré proposé par l'extension), sur l'icône de l'extension ou sur l'entrée du clic droit | La localisation de l'annonce publiée par la page (adresse ou coordonnées), et rien d'autre |

Sur les pages d'annonces des sites pris en charge, l'extension affiche un
encadré proposant la vérification. **Tant que vous ne cliquez pas sur
« Vérifier », rien n'est lu dans la page.** L'encadré peut être fermé ou
désactivé définitivement (« Ne plus proposer »).

L'extension ne lit ni votre historique de navigation, ni vos formulaires, ni
vos identifiants, ni le contenu des autres pages.

## Données transmises et destinataires

| Donnée | Destinataire | Finalité |
|---|---|---|
| Texte sélectionné, adresse saisie ou adresse lue sur la page | Service de géocodage de la Géoplateforme de l'IGN (`data.geopf.fr`) | Convertir l'adresse en position sur la carte |
| Requêtes de fond de carte (zone affichée) | Géoplateforme de l'IGN (`data.geopf.fr`) | Afficher la mini-carte |
| Requêtes de tuiles de couverture (zone autour de l'adresse) | Hébergement des données de couverture : [domaine à compléter] | Lire la couverture à cet endroit |

Ces requêtes sont envoyées directement depuis votre navigateur. Comme pour
toute requête sur Internet, les serveurs destinataires reçoivent votre
adresse IP et peuvent la conserver dans leurs journaux techniques selon leur
propre politique : voir les [conditions générales de la Géoplateforme de l'IGN](https://cartes.gouv.fr/cgu/)
et [la politique de l'hébergeur à compléter]. L'éditeur de l'extension ne
reçoit aucune de ces données.

## Données conservées sur votre appareil

| Donnée | Emplacement | Durée |
|---|---|---|
| Dernière demande de vérification (texte ou adresse lue), le temps de l'afficher dans le panneau | Stockage de session de l'extension | Effacée à la fermeture du navigateur |
| Préférence « Ne plus proposer » de l'encadré | Stockage local de l'extension | Jusqu'à réactivation ou désinstallation |

## Permissions demandées

- **Menus contextuels** : l'entrée « Vérifier la couverture réseau » du clic droit.
- **Stockage** : transmettre votre demande au panneau et mémoriser la préférence ci-dessus.
- **Onglet actif et injection de script** (`activeTab`, `scripting`) : lire, à votre clic seulement, la localisation publiée par l'annonce affichée.
- **Accès aux pages d'annonces des sites pris en charge** : afficher l'encadré de vérification sur ces pages uniquement.
- **Panneau latéral** (Chrome, Edge) et **règles d'affichage** (`declarativeContent`) : afficher le résultat et colorer l'icône sur les pages d'annonces, sans que l'extension lise l'adresse des pages.

## Sources des données affichées

Couverture mobile théorique : Arcep, « Mon Réseau Mobile » (Licence Ouverte).
Population : Insee, Filosofi 2019, données carroyées (Licence Ouverte).
Géocodage et fond de carte : IGN, Géoplateforme.
Les résultats sont des estimations théoriques, en extérieur, fournies sans garantie.

## Vos droits

L'éditeur ne détenant aucune donnée vous concernant, il n'a rien à vous
communiquer, rectifier ou effacer. Pour toute question : [contact à compléter].
Pour les données traitées par l'IGN ou l'hébergeur, adressez-vous à eux.
