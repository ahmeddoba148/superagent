import fs from 'node:fs';
const p='tools/build_v11.mjs';
let b=fs.readFileSync(p,'utf8');

const before=b;
b=b.replace(
  'const listLike=lines.length>=4||(?:shopping&&/[،,;]/.test(raw));',
  'const listLike=lines.length>=4||(shopping&&/[،,;]/.test(raw));'
);
b=b.replace(
  'const e=new Error("V11: كل محاولات الفهم والتحقق فشلت، لذلك لم يتم تنفيذ أي تغيير.");e.v11_failures=failures;throw e;',
  'const e=Object.assign(new Error("V11: كل محاولات الفهم والتحقق فشلت، لذلك لم يتم تنفيذ أي تغيير."),{v11_failures:failures});throw e;'
);

if(b===before)throw new Error('V11 diagnostics patch anchors not found');
fs.writeFileSync(p,b);
console.log('patched V11 diagnostics: invalid expression + Error custom property');
