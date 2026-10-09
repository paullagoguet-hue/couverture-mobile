import { launch, sleep } from './edge.ts';
const b = await launch();
for (const q of ['pays=it&q=Via del Corso 100, Roma', 'q=Via Toledo 256, Napoli&url=https://www.immobiliare.it/annunci/1', `page=${encodeURIComponent(JSON.stringify({ name: 'A', address: 'Siena', lat: 43.3188, lng: 11.3308, precision: 'approximate', radiusM: 1000 }))}`]) {
  const page = await b.open(`panel.html?lang=fr&choisi=fr&${q.replace(/ /g, '%20')}`);
  await sleep(12000);
  const r = await page.evaluate<any>(`[document.querySelector('h2')?.innerText, performance.getEntriesByType('resource').filter(e => e.name.includes('agcom')).map(e => [e.name.includes('query') ? 'q' : 't', Math.round(e.startTime), Math.round(e.duration)])]`);
  console.log(r[0], r[1].length, JSON.stringify(r[1].filter((x: any) => x[0] === 'q').map((x: any) => x[1] + '+' + x[2])));
  console.log('   tuiles', JSON.stringify(r[1].filter((x: any) => x[0] === 't').map((x: any) => x[1] + '+' + x[2])));
  await page.close();
}
await b.close();
