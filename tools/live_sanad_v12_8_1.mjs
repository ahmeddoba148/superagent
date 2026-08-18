import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

let regression=fs.readFileSync(new URL('./live_sanad_v12_6.mjs',import.meta.url),'utf8');
regression=regression
  .replaceAll('Sanad_V12_6_ULTIMATE_PARITY.js','Sanad_V12_8_1_HOTFIX.js')
  .replaceAll('12.6.0','12.8.1')
  .replaceAll('SANAD_V12_6_LIVE_REPORT.json','SANAD_V12_8_1_REGRESSION_REPORT.json')
  .replaceAll('SanadV126Test','SanadV1281Test');

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

fs.writeFileSync('/tmp/live_sanad_v1281_regression.mjs',regression);
execFileSync(process.execPath,['/tmp/live_sanad_v1281_regression.mjs'],{stdio:'inherit',env:process.env});

const BASE_URL=process.env.URL,SETUP=process.env.SETUP_KEY;
if(!BASE_URL||!SETUP)throw new Error('missing V12.8.1 live URL/SETUP');
async function getSuite(path,label){
  const res=await fetch(`${BASE_URL}${path}`,{headers:{'X-Sanad-Key':SETUP}}),body=await res.json();
  if(!res.ok||!body.ok||!Array.isArray(body.tests)||body.tests.some(x=>!x.ok))throw new Error(`${label} selftest failed: ${JSON.stringify(body)}`);
  return body;
}
const [base,crash,scale,hotfix]=await Promise.all([
  getSuite('/selftest?v128=1','V12.8 base'),
  getSuite('/selftest?v128=crash','V12.8 crash'),
  getSuite('/selftest?v128=scale','V12.8 scale'),
  getSuite('/selftest?v1281=1','V12.8.1 hotfix')
]);
const regressionReport=JSON.parse(fs.readFileSync('SANAD_V12_8_1_REGRESSION_REPORT.json','utf8'));
const architectureTests=Number(base.tests.length)+Number(crash.tests.length)+Number(scale.tests.length)+Number(hotfix.tests.length);
const report={ok:!!regressionReport.ok&&!!base.ok&&!!crash.ok&&!!scale.ok&&!!hotfix.ok,version:'12.8.1',regression_scenarios:Number(regressionReport.scenario_count||0),architecture_tests:architectureTests,hotfix_tests:Number(hotfix.tests.length),regression:regressionReport,architecture:{base,crash,scale,hotfix}};
fs.writeFileSync('SANAD_V12_8_1_LIVE_REPORT.json',JSON.stringify(report,null,2));
console.log('V12.8.1 LIVE PASS',JSON.stringify({regression:report.regression_scenarios,architecture:report.architecture_tests,hotfix:report.hotfix_tests}));
