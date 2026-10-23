// Old Back · GitHub edition (4.7): price history of every card in the catalogue.
//
//   node prices/history.mjs daily            → adds today's table (references.json)
//   node prices/history.mjs backfill [days]  → fills past days from TCGCSV's daily
//                                              archives (one per day since 2024-02-08):
//                                              every day of the last 45, then one per week.
//
// prices/history.json: { schema:1, dates:[ 'YYYY-MM-DD' … ], usd:{ cardId:[ price|null … ] } }
// Dates are the TCGplayer table dates (UTC). Prices are TCGplayer «market» in USD.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import mapping from './mapping.json' with {type:'json'};

const here=path.dirname(new URL(import.meta.url).pathname);
const file=path.join(here,'history.json'),KEEP=800,FIRST_ARCHIVE='2024-02-08';
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

async function daily(){
 const refs=JSON.parse(await fs.readFile(path.join(here,'references.json'),'utf8')),h=await load(),date=day(refs.sourceTimestamp);
 const filled=setColumn(h,date,c=>{const q=refs.records[c.id];return q?.sourceTimestamp&&day(q.sourceTimestamp)===date&&q.available?q.usd:null;});
 await save(h);console.log(`Historial: ${date} · ${filled} precios · ${h.dates.length} días`);
}

// Days to fill: every day of the last 45, then every Wednesday back to `limit` days.
function plan(limit){
 const out=[],today=new Date();
 for(let n=1;n<=limit;n++){const d=new Date(today.getTime()-n*86400000),s=d.toISOString().slice(0,10);if(s<FIRST_ARCHIVE)break;if(n<=45||d.getUTCDay()===3)out.push(s);}
 return out;
}
async function backfill(limit=365){
 const h=await load(),groups=[...new Set(mapping.map(c=>c.groupId))],todo=plan(limit).filter(d=>!h.dates.includes(d));
 console.log(`Relleno: ${todo.length} días por descargar`);
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'tcgcsv-'));let done=0;
 for(const date of todo){
  const archive=path.join(tmp,date+'.7z');
  try{
   // Each archive is downloaded once: its date stays in history.json (TCGCSV asks not to re-download them).
   try{execFileSync('curl',['-fsSL','--retry','2','-A','OldBack/4.7.0','-o',archive,`https://tcgcsv.com/archive/tcgplayer/prices-${date}.ppmd.7z`],{stdio:['ignore','ignore','pipe']});}
   catch(e){throw Error(String(e.stderr||e.message).trim().slice(0,120));}
   // Only the Pokémon Japan category (85) is extracted.
   execFileSync('7z',['x','-y','-o'+tmp,archive,`${date}/85/*`],{stdio:'ignore'});
   const prices=new Map();
   for(const g of groups){
    try{const data=JSON.parse(await fs.readFile(path.join(tmp,date,'85',String(g),'prices'),'utf8'));for(const q of data.results||[])prices.set(q.productId+'|'+q.subTypeName,q.marketPrice);}catch{}
   }
   const filled=setColumn(h,date,c=>prices.get(c.productId+'|'+c.subTypeName));
   done++;console.log(`${done===1?'::notice::':''}${date}: ${filled} precios (${(Buffer.byteLength(await fs.readFile(archive))/1048576).toFixed(1)} MB)`);
  }catch(e){console.log(`::warning::${date}: no disponible (${e.message})`);}
  await fs.rm(path.join(tmp,date),{recursive:true,force:true});await fs.rm(archive,{force:true});
  if(done%10===0)await save(h);
  await new Promise(r=>setTimeout(r,300));
 }
 await save(h);await fs.rm(tmp,{recursive:true,force:true});
 console.log(`::notice::Historial: ${h.dates.length} días, del ${h.dates[0]} al ${h.dates.at(-1)} · ${done} archivos nuevos de ${todo.length}`);
}

const [mode,arg]=process.argv.slice(2);
if(mode==='backfill')await backfill(Number(arg)||365);else await daily();
