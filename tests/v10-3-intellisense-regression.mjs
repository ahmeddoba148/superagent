import fs from 'fs';
import {execFileSync} from 'child_process';

const file=process.argv[2]||'SuperAgent_V10_3_Reliability_Lock.js';
const s=fs.readFileSync(file,'utf8');
let pass=0,fail=0;const errors=[];
const ok=(name,c,d='')=>{if(c)pass++;else{fail++;errors.push({name,d})}};

ok('runtime failure options explicitly typed',s.includes('@param {{chatId?: any, scope?: string, error?: any, context?: any}} [options]'));
ok('runtime failure error has default',s.includes('async function recordRuntimeFailure(env,{chatId=null,scope="runtime",error=null,context={}}={})'));
ok('allSettled result is narrowed through local result',s.includes('for(const [i,result] of results.entries()){if(result.status==="rejected")'));
ok('rejected reason accessed after narrowing',s.includes('error:result.reason'));
ok('old unsafe indexed reason access removed',!s.includes('results[i].reason'));
const errorCalls=(s.match(/recordRuntimeFailure\(env,\{[^}]*\berror:/g)||[]).length;
ok('runtime failure error call sites retained',errorCalls>=5,String(errorCalls));

// Compile an isolated @ts-check fixture containing the exact two patterns that
// produced the six VS Code Problems. This avoids treating the whole legacy JS
// application as a strict TypeScript project while still testing the fix with TS.
const fixture=`// @ts-check\n/**\n * @param {any} env\n * @param {{chatId?: any, scope?: string, error?: any, context?: any}} [options]\n */\nasync function recordRuntimeFailure(env,{chatId=null,scope='runtime',error=null,context={}}={}){return String(scope)+String(error)+String(context)+String(chatId)+String(env)}\nasync function test(env){\n  await recordRuntimeFailure(env,{scope:'a',error:new Error('x'),context:{a:1}});\n  const results=await Promise.allSettled([Promise.resolve(),Promise.reject(new Error('y'))]);\n  for(const [i,result] of results.entries()){if(result.status==='rejected')await recordRuntimeFailure(env,{scope:\`scheduled_\${i}\`,error:result.reason});}\n}\nvoid test({});\n`;
const fixturePath='.v103_intellisense_fixture.js';fs.writeFileSync(fixturePath,fixture);
try{
  execFileSync('npx',['-y','-p','typescript@latest','tsc','--allowJs','--checkJs','--noEmit','--skipLibCheck','--target','ES2022','--module','ESNext','--moduleResolution','bundler',fixturePath],{stdio:'pipe'});
  ok('TypeScript accepts exact IntelliSense patterns',true);
}catch(e){ok('TypeScript accepts exact IntelliSense patterns',false,String(e.stdout||e.stderr||e));}
try{fs.unlinkSync(fixturePath)}catch{}

console.log(JSON.stringify({pass,fail,total:pass+fail,errors},null,2));
process.exit(fail?1:0);
