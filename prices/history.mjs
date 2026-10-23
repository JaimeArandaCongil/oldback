// Old Back · GitHub edition (4.7): price history of every card in the catalogue.
//
//   node prices/history.mjs   → adds today's table (references.json) to prices/history.json
//
// The history starts with the tables already inside the app (mapping.json and
// seed.json) and grows by one day with every daily run. TCGCSV's archives are not
// used: they block downloads from GitHub and ask not to be used for this.
// prices/history.json: { schema:1, dates:[ 'YYYY-MM-DD' … ], usd:{ cardId:[ price|null … ] } }
import fs from 'node:fs/promises';
import path from 'node:path';
import mapping from './mapping.json' with {type:'json'};
import seed from './seed.json' with {type:'json'};

const here=path.dirname(new URL(import.meta.url).pathname);
const file=path.join(here,'history.json'),KEEP=800;
const day=s=>String(s).slice(0,10);
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;

async function load(){
 try{const h=JSON.parse(await fs.readFile(file,'utf8'));if(h.schema===1&&Array.isArray(h.dates))return h;}catch{}
 return {schema:1,dates:[],usd:{}};
}
// Sets one date column from a function card → price.
function setColumn(h,date,priceOf){
 let i=h.dates.indexOf(date);
 if(i<0){h.dates.push(date);h.dates.sort();i=h.dates.indexOf(date);for(const id of Object.keys(h.usd))h.usd[id].splice(i,0,null);}
 let filled=0;
 for(const c of mapping){
  const row=h.usd[c.id]||=Array(h.dates.length).fill(null);
  while(row.length<h.dates.length)row.push(null);
  const v=priceOf(c);row[i]=positive(v)?Math.round(v*100)/100:null;if(row[i]!==null)filled++;
 }
 return filled;
}
function trim(h){
 if(h.dates.length<=KEEP)return;
 const cut=h.dates.length-KEEP;h.dates=h.dates.slice(cut);
 for(const id of Object.keys(h.usd))h.usd[id]=h.usd[id].slice(cut);
}
async function save(h){trim(h);await fs.writeFile(file,JSON.stringify(h));}

// One column per table date: q.sourceTimestamp says which table each price comes from.
function addTable(h,records){
 const byDate=new Map();
 for(const c of mapping){const q=records[c.id];if(!q?.sourceTimestamp||!positive(q.usd)||q.available===false)continue;const d=day(q.sourceTimestamp);if(!byDate.has(d))byDate.set(d,new Map());byDate.get(d).set(c.id,q.usd);}
 for(const [d,prices] of byDate)if(!h.dates.includes(d)||d===[...byDate.keys()].sort().at(-1)){
  const i=h.dates.indexOf(d),old=i<0?null:new Map(Object.entries(h.usd).map(([id,row])=>[id,row[i]]));
  setColumn(h,d,c=>prices.get(c.id)??old?.get(c.id)??null);
 }
}
async function daily(){
 const refs=JSON.parse(await fs.readFile(path.join(here,'references.json'),'utf8')),h=await load(),date=day(refs.sourceTimestamp);
 // The tables already in the app start the history (19 and 21 October 2026).
 addTable(h,Object.fromEntries(mapping.map(c=>[c.id,c])));addTable(h,seed.records);
 const filled=setColumn(h,date,c=>{const q=refs.records[c.id];return q?.sourceTimestamp&&day(q.sourceTimestamp)===date&&q.available?q.usd:null;});
 await save(h);console.log(`Historial: ${date} · ${filled} precios · ${h.dates.length} días`);
}

await daily();
