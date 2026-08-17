import fs from 'node:fs';
const p='tools/build_v11_2.mjs';
let s=fs.readFileSync(p,'utf8');
const old="replaceBetween('const FAST_MODELS=[','export default{',modelRegistry+'\\nexport default{','model registry');";
const neu="replaceBetween('const FAST_MODELS=[','export default{',modelRegistry+'\\n','model registry');";
if(!s.includes(old))throw new Error('V11.2 builder export patch anchor missing');
s=s.replace(old,neu);
fs.writeFileSync(p,s);
console.log('patched V11.2 builder export marker');
