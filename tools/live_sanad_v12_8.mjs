import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

let regression=fs.readFileSync(new URL('./live_sanad_v12_6.mjs',import.meta.url),'utf8');
regression=regression
  .replaceAll('Sanad_V12_6_ULTIMATE_PARITY.js','Sanad_V12_8_ATOMIC.js')
  .replaceAll('12.6.0','12.8.0')
  .replaceAll('SANAD_V12_6_LIVE_REPORT.json','SANAD_V12_8_REGRESSION_REPORT.json')
  .replaceAll('SanadV126Test','SanadV128Test');
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
