// Fusionne plusieurs dumps Photon (.jsonl.zst) en un seul flux sur la sortie standard :
// en-tête et table des pays du premier fichier, puis les lieux de chacun, dans l'ordre
// alphabétique des pays (les dumps déclarent « sorted_by_country »).
//
// Copie octet par octet : seul le saut des deux premières lignes des fichiers
// suivants regarde les retours à la ligne (« \n » uniquement). Un découpage
// « par lignes » à la Node (readline) couperait aussi sur d'autres caractères
// présents dans certains noms de lieux et corromprait le JSON.
//
//   node merge-dumps.mjs belgium.jsonl.zst portugal.jsonl.zst | java -jar photon.jar import -import-file - …
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createZstdDecompress } from 'node:zlib';

/** Supprime les `count` premières lignes (séparateur \n), laisse passer le reste tel quel. */
function skipLines(count) {
  let left = count;
  return new Transform({
    transform(chunk, _enc, done) {
      let start = 0;
      while (left > 0) {
        const nl = chunk.indexOf(0x0a, start);
        if (nl < 0) return done(); // toute la portion est encore dans l'en-tête
        start = nl + 1;
        left--;
      }
      done(null, start ? chunk.subarray(start) : chunk);
    },
  });
}

const files = process.argv.slice(2);
for (const [i, file] of files.entries()) {
  const steps = [createReadStream(file), createZstdDecompress()];
  if (i > 0) steps.push(skipLines(2)); // en-tête et pays déjà écrits par le premier fichier
  await pipeline(...steps, async function* (source) {
    for await (const chunk of source) {
      if (!process.stdout.write(chunk)) await new Promise((r) => process.stdout.once('drain', r));
    }
  });
  process.stderr.write(`${file} : terminé\n`);
}
