import fs from 'node:fs';
const p='tools/build_v11.mjs';
let b=fs.readFileSync(p,'utf8');
const lines=b.split('\n');
const i=lines.findIndex(x=>x.includes("'identity insertion'"));
if(i<0)throw new Error('identity insertion builder line not found');
lines[i]="{const h=s.indexOf('async function handleTelegramUpdate(update,env){');const a=s.indexOf('await sendChatAction',h);if(h<0||a<0||a-h>12000)throw new Error('V11 identity insertion anchor not found');s=s.slice(0,a)+'if(await handleV11Identity(text,env,chatId))return;\\n'+s.slice(a);}";
fs.writeFileSync(p,lines.join('\n'));
console.log('patched V11 builder identity insertion');
