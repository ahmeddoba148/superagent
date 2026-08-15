from pathlib import Path

p = Path('SuperAgent_V10_3_Reliability_Lock.js')
s = p.read_text()

old1 = 'async function recordRuntimeFailure(env,{chatId=null,scope="runtime",error,context={}}={})'
new1 = '''/**
 * @param {any} env
 * @param {{chatId?: any, scope?: string, error?: any, context?: any}} [options]
 */
async function recordRuntimeFailure(env,{chatId=null,scope="runtime",error=null,context={}}={})'''
if old1 not in s:
    raise SystemExit('recordRuntimeFailure target not found')
s = s.replace(old1, new1, 1)

old2 = 'ctx.waitUntil(Promise.allSettled([deliverDueReminders(env,controller?.scheduledTime),runV10PeriodicIntelligence(env,controller?.scheduledTime),cleanupReliabilityData(env)]).then(async results=>{for(let i=0;i<results.length;i++)if(results[i].status==="rejected")await recordRuntimeFailure(env,{scope:`scheduled_${i}`,error:results[i].reason});}));'
new2 = 'ctx.waitUntil(Promise.allSettled([deliverDueReminders(env,controller?.scheduledTime),runV10PeriodicIntelligence(env,controller?.scheduledTime),cleanupReliabilityData(env)]).then(async results=>{for(const [i,result] of results.entries()){if(result.status==="rejected")await recordRuntimeFailure(env,{scope:`scheduled_${i}`,error:result.reason});}}));'
if old2 not in s:
    raise SystemExit('Promise.allSettled target not found')
s = s.replace(old2, new2, 1)

p.write_text(s)
print('V10.3 IntelliSense fixes applied')
