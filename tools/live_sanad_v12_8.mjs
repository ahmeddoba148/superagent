import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

let regression=fs.readFileSync(new URL('./live_sanad_v12_6.mjs',import.meta.url),'utf8');
regression=regression
  .replaceAll('Sanad_V12_6_ULTIMATE_PARITY.js','Sanad_V12_8_ATOMIC.js')
  .replaceAll('12.6.0','12.8.0')
  .replaceAll('SANAD_V12_6_LIVE_REPORT.json','SANAD_V12_8_REGRESSION_REPORT.json')
  .replaceAll('SanadV126Test','SanadV128Test');

// V12.8 is canonicalized by esbuild, so legacy source-presence gates must be whitespace/quote independent.
regression=regression.replace(
  `pass('organized menu layer present',built.includes("callback_data:'s126:panel:schedule'")&&built.includes("callback_data:'s126:panel:data'")&&built.includes("callback_data:'s126:open:shopping'"));`,
  `pass('organized menu layer present',/callback_data\\s*:\\s*["']s126:panel:schedule["']/.test(built)&&/callback_data\\s*:\\s*["']s126:panel:data["']/.test(built)&&/callback_data\\s*:\\s*["']s126:open:shopping["']/.test(built));`
);
regression=regression.replace(
  `pass('data clear controls present',['shopping','context','memory','world','schedule','all'].every(x=>built.includes(\`callback_data:'s126:data:\${x}'\`)));`,
  `pass('data clear controls present',['shopping','context','memory','world','schedule','all'].every(x=>new RegExp('callback_data\\\\s*:\\\\s*["\\\']s126:data:'+x+'["\\\']').test(built)));`
);
regression=regression.replace(
  `pass('direct clear command present',built.includes('text === "/clear"')&&built.includes('showDataPanelV126'));`,
  `pass('direct clear command present',/text\\s*===\\s*["']\\/clear["']/.test(built)&&built.includes('showDataPanelV126'));`
);
regression=regression.replace(
  `pass('after-end dependency propagation',b?.local_time==='21:00',JSON.stringify(b));`,
  `if(b?.local_time!=='21:00'){const srcDbg=q(\`SELECT id,local_date,local_time,duration_minutes,updated_at FROM sanad_reminders WHERE chat_id='\${esc(CHAT)}' AND id=\${Number(a.id)}\`)[0],depDbg=q(\`SELECT * FROM sanad_dependencies WHERE chat_id='\${esc(CHAT)}' AND id=\${Number(dep.id)}\`)[0],audDbg=q(\`SELECT operation_id,tool,args_json,result_json,verified,created_at FROM sanad_audit WHERE chat_id='\${esc(CHAT)}' ORDER BY id DESC LIMIT 12\`),recDbg=q(\`SELECT operation_id,step_key,tool,result_json,created_at FROM sanad_receipts WHERE chat_id='\${esc(CHAT)}' ORDER BY created_at DESC LIMIT 12\`),failDbg=q(\`SELECT scope,error_text,context_json,created_at FROM sanad_failures WHERE chat_id='\${esc(CHAT)}' ORDER BY id DESC LIMIT 12\`),txDbg=q(\`SELECT * FROM sanad_mutation_tx WHERE chat_id='\${esc(CHAT)}' ORDER BY started_at DESC LIMIT 5\`),jrDbg=q(\`SELECT operation_id,seq,tool,state,error_text,created_at FROM sanad_mutation_journal WHERE chat_id='\${esc(CHAT)}' ORDER BY created_at DESC LIMIT 12\`);console.log('V128 DEP DEBUG',JSON.stringify({source:srcDbg,target:b,dependency:depDbg,audit:audDbg,receipts:recDbg,failures:failDbg,tx:txDbg,journal:jrDbg}));}pass('after-end dependency propagation',b?.local_time==='21:00',JSON.stringify(b));`
);

fs.writeFileSync('/tmp/live_sanad_v128_regression.mjs',regression);
execFileSync(process.execPath,['/tmp/live_sanad_v128_regression.mjs'],{stdio:'inherit',env:process.env});

const BASE_URL=process.env.URL,SETUP=process.env.SETUP_KEY;
if(!BASE_URL||!SETUP)throw new Error('missing V12.8 live URL/SETUP');
const hardRes=await fetch(`${BASE_URL}/selftest?v128=1`,{headers:{'X-Sanad-Key':SETUP}}),hard=await hardRes.json();
if(!hardRes.ok||!hard.ok||!Array.isArray(hard.tests)||hard.tests.some(x=>!x.ok))throw new Error(`V12.8 hardening selftest failed: ${JSON.stringify(hard)}`);
const regressionReport=JSON.parse(fs.readFileSync('SANAD_V12_8_REGRESSION_REPORT.json','utf8'));
const report={ok:!!regressionReport.ok&&!!hard.ok,version:'12.8.0',regression_scenarios:Number(regressionReport.scenario_count||0),v128_architecture_tests:hard.tests.length,regression:regressionReport,architecture:hard};
fs.writeFileSync('SANAD_V12_8_LIVE_REPORT.json',JSON.stringify(report,null,2));
console.log('V12.8 LIVE PASS',JSON.stringify({regression:report.regression_scenarios,architecture:report.v128_architecture_tests}));
