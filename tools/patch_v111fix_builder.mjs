import fs from 'node:fs';
const p='tools/build_v11_1_fix.mjs';
let s=fs.readFileSync(p,'utf8');
const before=s;
s=s.replace('headers:{Authorization:`Bearer ${env.OMNIAI_API_KEY}`,"Content-Type":"application/json"}', 'headers:{Authorization:"Bearer "+env.OMNIAI_API_KEY,"Content-Type":"application/json"}');
s=s.replace('throw new Error(`chat_http_${res.status}`)', 'throw new Error("chat_http_"+res.status)');
if(s===before)throw new Error('V11.1 FIX builder patch anchors missing');
fs.writeFileSync(p,s);
console.log('patched V11.1 FIX builder nested template literals');
