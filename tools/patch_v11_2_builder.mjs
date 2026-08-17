import fs from 'node:fs';
const p='tools/build_v11_2.mjs';
let s=fs.readFileSync(p,'utf8');
const patches=[
  ["replaceBetween('const FAST_MODELS=[','export default{',modelRegistry+'\\nexport default{','model registry');","replaceBetween('const FAST_MODELS=[','export default{',modelRegistry+'\\n','model registry');","export marker"],
  ["replaceBetween('const V111FIX_CHAT_MODELS=[','const profile=await getUserProfile(env,chatId);',directChat+'const profile=await getUserProfile(env,chatId);','direct chat chain');","replaceBetween('const V111FIX_CHAT_MODELS=[','const profile=await getUserProfile(env,chatId);',directChat,'direct chat chain');","profile marker"]
];
for(const [oldValue,newValue,label] of patches){
  if(!s.includes(oldValue))throw new Error('V11.2 builder patch anchor missing: '+label);
  s=s.replace(oldValue,newValue);
}
fs.writeFileSync(p,s);
console.log('patched V11.2 builder duplicate markers');
