from pathlib import Path
p=Path('SuperAgent_V10_3_Reliability_Lock.js')
s=p.read_text()

def rep(a,b,n=1):
    global s
    if a not in s:
        raise SystemExit('missing target: '+a[:120])
    s=s.replace(a,b,n)

rep('const V10_VERSION="10.3";const V10_NAME="Super Agent V10 — Life OS · Reliability Lock";',
    'const V10_VERSION="10.3.1";const V10_NAME="Super Agent V10 — Life OS · Reliability Lock · Diagnostics";')

route='if(request.method==="GET"&&url.pathname==="/health")return reliabilityHealth(env);'
rep(route,route+'\nif(request.method==="GET"&&url.pathname==="/diagnostics")return reliabilityDiagnostics(request,env);')

anchor='async function claimTelegramUpdate(env,update){'
helper=r'''function redactDiagnosticText(value){
  let s=String(value??"");
  s=s.replace(/Bearer\s+[A-Za-z0-9._~+\/-]{8,}/gi,"Bearer [REDACTED]");
  s=s.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g,"[TELEGRAM_TOKEN_REDACTED]");
  s=s.replace(/([?&](?:key|token|secret|api[_-]?key)=)[^&\s]+/gi,"$1[REDACTED]");
  s=s.replace(/((?:authorization|api[_-]?key|token|secret)\s*[:=]\s*)["']?[^\s,"'}]{8,}/gi,"$1[REDACTED]");
  return s.slice(0,6000);
}
function safeDiagnosticContext(raw){
  try{return JSON.parse(redactDiagnosticText(raw||"{}"));}catch{return{raw:redactDiagnosticText(raw||"")};}
}
async function reliabilityDiagnostics(request,env){
  const url=new URL(request.url);const key=url.searchParams.get("key")||"";
  if(!env.SETUP_KEY||key!==env.SETUP_KEY)return json({ok:false,error:"Unauthorized"},401);
  try{
    await ensureSchemaOnce(env);
    const incident=String(url.searchParams.get("incident")||"").trim();
    const limit=clamp(Math.trunc(Number(url.searchParams.get("limit")||10)),1,20);
    let rows=[];
    if(incident){
      const row=await env.DB.prepare(`SELECT incident_id,scope,error_text,context_json,created_at FROM runtime_failures WHERE incident_id=? LIMIT 1`).bind(incident).first();
      if(row)rows=[row];
    }else{
      rows=(await env.DB.prepare(`SELECT incident_id,scope,error_text,context_json,created_at FROM runtime_failures ORDER BY id DESC LIMIT ?`).bind(limit).all())?.results||[];
    }
    return json({ok:true,version:V10_VERSION,count:rows.length,incidents:rows.map(r=>({incident_id:r.incident_id,scope:r.scope,error:redactDiagnosticText(r.error_text),context:safeDiagnosticContext(r.context_json),created_at:r.created_at}))});
  }catch(e){
    const id=await recordRuntimeFailure(env,{scope:"diagnostics_endpoint",error:e});
    return json({ok:false,error:"Diagnostics query failed",incident_id:id},500);
  }
}

'''
rep(anchor,helper+anchor)

p.write_text(s)
print('V10.3.1 diagnostics patch applied',len(p.read_bytes()))
