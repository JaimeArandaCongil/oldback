// Downloads every {url,out} in request.json into fetch/out/, a few at a time.
import fs from 'node:fs/promises';
const req=JSON.parse(await fs.readFile('fetch/request.json','utf8'));
await fs.mkdir('fetch/out',{recursive:true});
const log=[];let i=0;
async function one(r){
 for(let attempt=0;attempt<3;attempt++){
  try{
   const res=await fetch(r.url,{headers:{'User-Agent':'Mozilla/5.0 (oldback catalog builder)','Accept-Language':'ja,en;q=0.8',...(r.headers||{})},signal:AbortSignal.timeout(60000)});
   const buf=Buffer.from(await res.arrayBuffer());
   if(res.ok){await fs.mkdir(('fetch/out/'+r.out).replace(/\/[^/]*$/,''),{recursive:true});await fs.writeFile('fetch/out/'+r.out,buf);}
   log.push({url:r.url,out:r.out,status:res.status,bytes:buf.length,type:res.headers.get('content-type')});return;
  }catch(e){if(attempt===2)log.push({url:r.url,out:r.out,error:String(e)});await new Promise(s=>setTimeout(s,2000));}
 }
}
const queue=[...req.items];const workers=Array.from({length:req.parallel||4},async()=>{while(queue.length){const r=queue.shift();await one(r);if(req.delayMs)await new Promise(s=>setTimeout(s,req.delayMs));}});
await Promise.all(workers);
await fs.writeFile('fetch/out/log-'+(req.name||'run')+'.json',JSON.stringify(log,null,1));
console.log(log.filter(l=>l.status!==200).length+' fallos de '+log.length);
