# Géocodeur Photon (auto-hébergé)

Photon (https://github.com/komoot/photon) transforme une adresse en position,
à partir des données OpenStreetMap. L'extension l'utilise pour les pays sans
géocodeur public national ouvert (Portugal, Belgique… ; France et Espagne
utilisent l'IGN et CartoCiudad). Le serveur public photon.komoot.io ne convient
pas : usage limité, adresse IP bloquée en cas de rafale (constaté).

## Sur un poste de développement (Windows, macOS, Linux)

Prérequis : Java 21 (Windows : `winget install EclipseAdoptium.Temurin.21.JRE`), Node.js 24.

```
mkdir photon && cd photon
curl -LO https://github.com/komoot/photon/releases/download/1.3.0/photon-1.3.0.jar
curl -L -o belgium.jsonl.zst https://download1.graphhopper.com/public/europe/belgium/photon-dump-belgium-1.0-latest.jsonl.zst
curl -L -o portugal.jsonl.zst https://download1.graphhopper.com/public/europe/portugal/photon-dump-portugal-1.0-latest.jsonl.zst
node ../geocoder/merge-dumps.mjs belgium.jsonl.zst portugal.jsonl.zst | java -Xmx6g -jar photon-1.3.0.jar import -import-file - -data-dir ./data -j 4 -languages fr,en,es,de,it,pt,nl
java -Xmx4g -jar photon-1.3.0.jar serve -data-dir ./data -cors-any -listen-ip 127.0.0.1 -listen-port 2322
```

- Un fichier par pays, fusionnés par `merge-dumps.mjs` (Photon n'importe qu'un
  fichier) ; les pays doivent être donnés **dans l'ordre alphabétique de leur
  nom de fichier anglais** comme ci-dessus (les dumps sont triés par pays).
- Import : ~3 000 lieux/s ; Belgique + Portugal ≈ 30 min, ~10 Go de disque.
- L'extension compilée sans `VITE_PHOTON_URL` utilise `http://127.0.0.1:2322/api`.

## En production

Un petit serveur (VPS Linux, 4 cœurs, 8 à 16 Go de mémoire, disque SSD) :

- pays choisis : même procédure, puis `serve` derrière un proxy HTTPS (Caddy,
  nginx) qui limite le débit par adresse IP ;
- toute l'Europe : base prête à l'emploi (photon-db-europe-1.0, ~32 Go
  compressés, ~100 Go décompressés) sur https://download1.graphhopper.com/public/europe/ ;
- compiler l'extension avec `VITE_PHOTON_URL=https://<domaine>/api` (la CSP
  et la politique de confidentialité doivent mentionner ce domaine) ;
- mise à jour : réimporter les dumps (publiés chaque semaine) une fois par mois.

Données : © contributeurs OpenStreetMap, licence ODbL (citer la source).
