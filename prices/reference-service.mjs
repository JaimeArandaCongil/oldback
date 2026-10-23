import mapping from './mapping.json' with {type:'json'};
import seed from './seed.json' with {type:'json'};
const DAY=86400000,KEY='prices/v2/snapshot.json',GATE='prices/v2/gate.json';
let pending;
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const timestamp=s=>Date.parse(String(s).replace(/\+0000$/,'+00:00'));
async function upstream(url){const r=await fetch(url,{headers:{'User-Agent':'OldBackPriceReference/2.0 (personal collection; daily cache)'},signal:AbortSignal.timeout(18000)});if(!r.ok)throw Error('Fuente no disponible ('+r.status+')');return r}
export function ingest(group,rows,old,stamp,checkedAt,modified){
 const index=new Map(rows.map(r=>[r.productId+'|'+r.subTypeName,r])),records={};
 for(const c of mapping.filter(c=>c.groupId===group)){
  const q=index.get(c.productId+'|'+c.subTypeName),usd=positive(q?.marketPrice)?q.marketPrice:null,previous=old[c.id];
  let change=null,jump=false,previousQuote=null;
  if(previous?.sourceTimestamp===stamp){change=previous.change??null;jump=!!previous.jump;previousQuote=previous.previousQuote??null;}
  else if(positive(usd)&&positive(previous?.usd)){
   change=(usd/previous.usd-1)*100;jump=change>100||change < -70;
   previousQuote={usd:previous.usd,sourceTimestamp:previous.sourceTimestamp};
  }
  records[c.id]={usd,available:positive(usd),productId:c.productId,groupId:group,subTypeName:c.subTypeName,sourceTimestamp:stamp,checkedAt,groupModified:modified,change,jump,previousQuote};
 }
 return records;
}
export async function sync(previous,fetcher=upstream,now=Date.now()){
 const started=Date.now(),checkedAt=new Date(now).toISOString(),next={...previous,records:{...previous.records},errors:[],checkedAt,origin:'server',nextCheckAt:now+DAY};
 try{
  const stamp=(await (await fetcher('https://tcgcsv.com/last-updated.txt')).text()).trim();
  if(!Number.isFinite(timestamp(stamp))||timestamp(stamp)>now+DAY)throw Error('Fecha de fuente inválida');
  if(timestamp(stamp)<timestamp(previous.sourceTimestamp))throw Error('La fuente ha devuelto una tabla anterior');
  next.sourceTimestamp=stamp;
  const groups=[...new Set(mapping.map(c=>c.groupId))].filter(g=>mapping.some(c=>c.groupId===g&&previous.records[c.id]?.sourceTimestamp!==stamp));
  let cursor=0;
  await Promise.all(Array.from({length:3},async()=>{while(cursor<groups.length){const group=groups[cursor++];try{
   if(Date.now()-started>60000)throw Error('Se aplaza este grupo para el siguiente intento');
   const r=await fetcher('https://tcgcsv.com/tcgplayer/85/'+group+'/prices'),data=await r.json();
   if(data.success!==true||!Array.isArray(data.results)||!data.results.length)throw Error('Tabla incompleta');
   Object.assign(next.records,ingest(group,data.results,previous.records,stamp,checkedAt,r.headers.get('last-modified')));
  }catch{next.errors.push({groupId:group,message:'No se pudo renovar este grupo; se conserva la última referencia.'})}
  await new Promise(resolve=>setTimeout(resolve,120));}}));
 }catch{next.errors.push({source:'TCGCSV',message:'No se pudo comprobar la tabla de mercado; se conserva la anterior.'})}
 try{
  const xml=await (await fetcher('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml')).text(),date=xml.match(/time=['"](\d{4}-\d\d-\d\d)['"]/)?.[1];
  const rate=currency=>Number(xml.match(new RegExp('currency=[\'"]'+currency+'[\'"]\\s+rate=[\'"]([\\d.]+)'))?.[1]);
  const usd=rate('USD'),jpy=rate('JPY');
  if(!date||!(usd>.2&&usd<5&&jpy>30&&jpy<500)||Date.parse(date)>now+DAY||Date.parse(date)<timestamp(previous.fx.date))throw Error('Cambio no válido');
  next.fx={usdEur:1/usd,eurJpy:jpy,date,sourceUrl:'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',checkedAt};
 }catch{next.errors.push({source:'ECB',message:'No se pudo renovar el cambio; se conserva el anterior.'})}
 if(next.errors.length)next.nextCheckAt=now+3600000;
 return next;
}
async function read(bucket,key){try{return await (await bucket.get(key))?.json()}catch{return null}}
export async function referenceResponse(request,env){
 if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers:{Allow:'GET'}});
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 if(!env.BUCKET)return Response.json({...seed,serverUnavailable:true},{headers});
 const bucket=env.BUCKET,stored=await read(bucket,KEY);
 // A new catalog can add mapped cards while the shared daily cache is fresh.
 // Seed those new identities immediately; keep the latest matching cached quotes.
 const merge=value=>{
  const cachedIsNewer=timestamp(value?.sourceTimestamp)>=timestamp(seed.sourceTimestamp),base=cachedIsNewer?{...seed,...value}:{...value,...seed};
  const fx=timestamp(value?.fx?.date)>=timestamp(seed.fx.date)?value.fx:seed.fx;
  const cachedRows=Object.entries(value?.records||{}).filter(([id,q])=>{const c=seed.records[id];return !c||(c.productId===q.productId&&c.groupId===q.groupId&&c.subTypeName===q.subTypeName&&timestamp(q.sourceTimestamp)>=timestamp(c.sourceTimestamp));});
  return {...base,fx,records:{...seed.records,...Object.fromEntries(cachedRows)}};
 };
 const current=merge(stored||seed);
 const force=new URL(request.url).searchParams.get('refresh')==='1';
 const recentlyChecked=value=>Number.isFinite(timestamp(value.checkedAt))&&Date.now()-timestamp(value.checkedAt)<300000;
 if(force&&recentlyChecked(current))return Response.json({...current,checkedRecently:true},{headers});
 if(!force&&Date.now()<current.nextCheckAt)return Response.json(current,{headers});
 if(!pending)pending=(async()=>{
  const gateObject=await bucket.get(GATE),gate=await gateObject?.json();
  if(gate?.until>Date.now())return {...current,updating:true};
  const lease=await bucket.put(GATE,JSON.stringify({until:Date.now()+180000}),{onlyIf:gateObject?{etagMatches:gateObject.etag}:{etagDoesNotMatch:'*'}});
  if(!lease)return {...current,updating:true};
  const latest=merge(await read(bucket,KEY)||current);
  if((!force&&Date.now()<latest.nextCheckAt)||(force&&recentlyChecked(latest))){await bucket.put(GATE,JSON.stringify({until:0}),{onlyIf:{etagMatches:lease.etag}});return {...latest,...(force?{checkedRecently:true}:{})};}
  const next=await sync(latest);
  await bucket.put(KEY,JSON.stringify(next),{httpMetadata:{contentType:'application/json'}});
  await bucket.put(GATE,JSON.stringify({until:0}),{onlyIf:{etagMatches:lease.etag}});
  return next;
 })().finally(()=>{pending=null});
 try{return Response.json(await pending,{headers})}catch{return Response.json({...current,serverUnavailable:true},{headers})}
}
