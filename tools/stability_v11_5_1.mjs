import fs from'node:fs';
const U=process.env.URL,K=process.env.SETUP_KEY;
if(!U||!K)throw Error('URL/SETUP_KEY missing');
const exp=['gemini::gemini-3.5-flash-lite','gemini::gemini-3.1-flash-lite','gemini::gemini-2.5-flash-lite'];
const rounds=Number(process.env.STABILITY_ROUNDS||6),samples=[];
for(let i=0;i<rounds;i++){
  const t=Date.now(),r=await fetch(U+'/ready?all=1',{headers:{'X-SuperAgent-Key':K}}),x=await r.json();
  samples.push({round:i+1,http:r.status,wall_ms:Date.now()-t,attempts:x.attempts||[]});
  if(!r.ok||!x.ok||!x.all_models_ok||JSON.stringify((x.attempts||[]).map(a=>a.model))!==JSON.stringify(exp)||!(x.attempts||[]).every(a=>a.ok))throw Error('stability round '+(i+1)+' '+JSON.stringify(x));
  await new Promise(r=>setTimeout(r,1500));
}
const per=Object.fromEntries(exp.map(m=>{const a=samples.flatMap(s=>s.attempts).filter(x=>x.model===m).map(x=>Number(x.latency_ms||0)).sort((a,b)=>a-b);return[m,{successes:a.length,total:rounds,min_ms:a[0],max_ms:a.at(-1),avg_ms:Math.round(a.reduce((p,c)=>p+c,0)/a.length)}]}));
const out={ok:true,rounds,requests:rounds*3,per_model:per,samples};
fs.writeFileSync('V11_5_1_MODEL_STABILITY.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
