import fs from 'node:fs';
const p='tools/build_v11.mjs';
let b=fs.readFileSync(p,'utf8');
const lines=b.split('\n');
const i=lines.findIndex(x=>x.includes("'identity insertion'"));
if(i<0)throw new Error('identity insertion builder line not found');
lines[i]="{const h=s.indexOf('async function handleTelegramUpdate(update,env){');if(h<0)throw new Error('handleTelegramUpdate anchor missing');console.log('V11_HANDLE_SNIPPET_START\\n'+s.slice(h,h+9000)+'\\nV11_HANDLE_SNIPPET_END');}";
fs.writeFileSync(p,lines.join('\n'));
console.log('patched V11 builder for anchor discovery');
