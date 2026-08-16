import fs from 'node:fs';
const p=process.argv[2]||'SuperAgent_V10_7_Universal_Agent.js';
const s=fs.readFileSync(p,'utf8');
const checks=[
  ['version 10.7',s.includes('const V10_VERSION="10.7"')],
  ['semantic shopping schema',s.includes('"shopping":{')&&s.includes('action==="shopping"')],
  ['semantic executor',s.includes('executeShoppingPlanV107')],
  ['shopping context',s.includes('buildShoppingContextV107')],
  ['transaction rollback',s.includes('restoreShoppingSnapshotV107')],
  ['structured metadata migration',s.includes('ensureColumn(env,"smart_list_items","meta_json"')],
  ['quantity math',s.includes("op.op==='increment'")&&s.includes("op.op==='multiply'")],
  ['semantic-first marker',s.includes('V10.7: normal human language is interpreted semantically first')],
  ['Cloudflare tuple annotation',s.includes('/** @type {[RegExp,string][]} */\n  const pairs=[')],
  ['AI fallback stays available',s.includes('if(await handleV10DirectCommands(env,chatId,text,{fromVoice:false}))return;')],
  ['no V10.6 version identity',!s.includes('const V10_VERSION="10.6";')]
];
let bad=0;for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)bad++}
if(bad)process.exit(1);
console.log(`V10.7 static architecture checks PASS (${checks.length})`);
