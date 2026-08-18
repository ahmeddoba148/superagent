import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

let regression=fs.readFileSync(new globalThis.URL('./live_sanad_v12_6.mjs',import.meta.url),'utf8');
regression=regression
  .replaceAll('Sanad_V12_6_ULTIMATE_PARITY.js','Sanad_V12_7_HARDENED.js')
  .replaceAll('12.6.0','12.7.0')
  .replaceAll('SANAD_V12_6_LIVE_REPORT.json','SANAD_V12_7_REGRESSION_REPORT.json')
  .replaceAll('SanadV126Test','SanadV127Test');
fs.writeFileSync('/tmp/live_sanad_v127_regression.mjs',regression);
execFileSync(process.execPath,['/tmp/live_sanad_v127_regression.mjs'],{stdio:'inherit',env:process.env});

const BASE_URL=process.env.URL,SETUP=process.env.SETUP_KEY;
if(!BASE_URL||!SETUP)throw new Error('missing V12.7 live URL/SETUP');
const deepRes=await fetch(`${BASE_URL}/selftest?v127=1`,{headers:{'X-Sanad-Key':SETUP}}),deep=await deepRes.json();
if(!deepRes.ok||!deep.ok||!Array.isArray(deep.tests)||deep.tests.some(x=>!x.ok))throw new Error(`V12.7 deep hardening selftest failed: ${JSON.stringify(deep)}`);
const regressionReport=JSON.parse(fs.readFileSync('SANAD_V12_7_REGRESSION_REPORT.json','utf8'));
const report={ok:!!regressionReport.ok&&!!deep.ok,version:'12.7.0',regression_scenarios:Number(regressionReport.scenario_count||0),hardening_tests:deep.tests.length,regression:regressionReport,hardening:deep};
fs.writeFileSync('SANAD_V12_7_LIVE_REPORT.json',JSON.stringify(report,null,2));
console.log('V12.7 LIVE PASS',JSON.stringify({regression:report.regression_scenarios,hardening:report.hardening_tests}));
