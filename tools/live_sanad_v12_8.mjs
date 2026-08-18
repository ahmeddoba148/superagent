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

fs.writeFileSync('/tmp/live_sanad_v128_regression.mjs',regression);
execFileSync(process.execPath,['/tmp/live_sanad_v128_regression.mjs'],{stdio:'inherit',env:process.env});

const BASE_URL=process.env.URL,SETUP=process.env.SETUP_KEY;
if(!BASE_URL||!SETUP)throw new Error('missing V12.8 live URL/SETUP');
async function getSuite(mode){
  const res=await fetch(`${BASE_URL}/selftest?v128=${mode}`,{headers:{'X-Sanad-Key':SETUP}}),body=await res.json();
  if(!res.ok||!body.ok||!Array.isArray(body.tests)||body.tests.some(x=>!x.ok))throw new Error(`V12.8 ${mode} selftest failed: ${JSON.stringify(body)}`);
  return body;
}
const [base,crash,scale]=await Promise.all([getSuite('1'),getSuite('crash'),getSuite('scale')]);
const regressionReport=JSON.parse(fs.readFileSync('SANAD_V12_8_REGRESSION_REPORT.json','utf8'));
const architectureTests=Number(base.tests.length)+Number(crash.tests.length)+Number(scale.tests.length);
const report={ok:!!regressionReport.ok&&!!base.ok&&!!crash.ok&&!!scale.ok,version:'12.8.0',regression_scenarios:Number(regressionReport.scenario_count||0),v128_architecture_tests:architectureTests,regression:regressionReport,architecture:{base,crash,scale}};
fs.writeFileSync('SANAD_V12_8_LIVE_REPORT.json',JSON.stringify(report,null,2));
console.log('V12.8 LIVE PASS',JSON.stringify({regression:report.regression_scenarios,architecture:report.v128_architecture_tests}));
