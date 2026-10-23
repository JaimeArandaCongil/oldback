// Old Back · GitHub edition (4.5): daily TCGplayer (via TCGCSV) and ECB refresh.
// Run by .github/workflows/prices.yml; it reuses the price server's own code
// (reference-service.mjs) and writes prices/references.json, which the app reads.
import fs from 'node:fs/promises';
import {sync} from './reference-service.mjs';
import seed from './seed.json' with {type:'json'};

const file=new URL('./references.json',import.meta.url);
const time=s=>Date.parse(String(s).replace(/\+0000$/,'+00:00'));
let previous;
try{previous=JSON.parse(await fs.readFile(file,'utf8'));}catch{previous=seed;}
// A newer app build brings a newer table: start from it. New cards always get their seed row.
if(!(time(previous.sourceTimestamp)>=time(seed.sourceTimestamp)))previous=structuredClone(seed);
previous={...previous,records:{...seed.records,...previous.records}};
const next=await sync(previous);
next.origin='github';
await fs.writeFile(file,JSON.stringify(next));
console.log(`Tabla ${next.sourceTimestamp} · ${Object.keys(next.records).length} fichas · cambio ${next.fx?.date} · ${next.errors.length} avisos`);
for(const e of next.errors)console.log('Aviso:',e.source||e.groupId,e.message);
