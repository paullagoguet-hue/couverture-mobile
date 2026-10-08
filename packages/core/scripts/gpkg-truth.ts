/**
 * Vérité terrain : couverture en un point lue dans le GeoPackage Arcep d'origine
 * (Lambert-93), pour valider la lecture dans les tuiles.
 *
 * Utilise node:sqlite (Node ≥ 22) : un GeoPackage est une base SQLite dont les
 * géométries sont du WKB précédé d'un en-tête GPKG.
 */
import { DatabaseSync } from 'node:sqlite';

/** Projection Lambert-93 (EPSG:2154), conique conforme sécante sur GRS80. */
export function toLambert93(lng: number, lat: number): [number, number] {
  const a = 6378137, f = 1 / 298.257222101, e = Math.sqrt(2 * f - f * f);
  const rad = Math.PI / 180;
  const [phi1, phi2, phi0, lambda0] = [49 * rad, 44 * rad, 46.5 * rad, 3 * rad];
  const m = (p: number) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
  const t = (p: number) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const n = (Math.log(m(phi1)) - Math.log(m(phi2))) / (Math.log(t(phi1)) - Math.log(t(phi2)));
  const F = m(phi1) / (n * t(phi1) ** n);
  const rho = (p: number) => a * F * t(p) ** n;
  const theta = n * (lng * rad - lambda0);
  return [700000 + rho(lat * rad) * Math.sin(theta), 6600000 + rho(phi0) - rho(lat * rad) * Math.cos(theta)];
}

/** Test pair-impair du point sur tous les anneaux d'une géométrie WKB (Polygon / MultiPolygon). */
function wkbContains(buf: Buffer, start: number, x: number, y: number): boolean {
  let p = start, inside = false;
  const readGeom = () => {
    const le = buf[p] === 1; p += 1;
    const u32 = () => { const v = le ? buf.readUInt32LE(p) : buf.readUInt32BE(p); p += 4; return v; };
    const f64 = () => { const v = le ? buf.readDoubleLE(p) : buf.readDoubleBE(p); p += 8; return v; };
    const type = u32() % 1000;
    if (type === 6 || type === 7) { const n = u32(); for (let i = 0; i < n; i++) readGeom(); return; }
    if (type !== 3) throw new Error(`type WKB non géré : ${type}`);
    const nRings = u32();
    for (let r = 0; r < nRings; r++) {
      const nPts = u32();
      let px = f64(), py = f64();
      const x0 = px, y0 = py;
      for (let k = 1; k <= nPts; k++) {
        const [qx, qy] = k < nPts ? [f64(), f64()] : [x0, y0];
        if (py > y !== qy > y && x < ((qx - px) * (y - py)) / (qy - py) + px) inside = !inside;
        px = qx; py = qy;
      }
    }
  };
  readGeom();
  return inside;
}

/** Niveau au point dans un GeoPackage Arcep : 'TBC' | 'BC' | 'CL' | 'couvert' | null. */
export function gpkgCoverage(path: string, lng: number, lat: number): string | null {
  const [x, y] = toLambert93(lng, lat);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const { table_name: table } = db.prepare("SELECT table_name FROM gpkg_contents WHERE data_type='features'").get() as { table_name: string };
    for (const row of db.prepare(`SELECT niveau, geom FROM "${table}"`).iterate() as Iterable<{ niveau: string | null; geom: Uint8Array }>) {
      const buf = Buffer.from(row.geom.buffer, row.geom.byteOffset, row.geom.byteLength);
      // En-tête GPKG : 8 octets + enveloppe (type dans les bits 1-3 du flag).
      const envType = (buf[3] >> 1) & 7;
      const envLen = [0, 32, 48, 48, 64][envType];
      if (envLen >= 32) {
        const [minx, maxx, miny, maxy] = [8, 16, 24, 32].map((o) => buf.readDoubleLE(o));
        if (x < minx || x > maxx || y < miny || y > maxy) continue;
      }
      if (wkbContains(buf, 8 + envLen, x, y)) return row.niveau || 'couvert';
    }
    return null;
  } finally {
    db.close();
  }
}
