import fs from 'node:fs';

const p='SuperAgent_V11_FULL.js';
let s=fs.readFileSync(p,'utf8');

function mustReplace(from,to,label){
  if(!s.includes(from)) throw new Error(`hotfix anchor missing: ${label}`);
  s=s.replace(from,to);
}

// 1) The normalized V10.7 shopping plan lives at intent.shopping, not intent.shopping_plan.
mustReplace(
  'const plan=intent?.shopping_plan||intent?.shoppingPlan||intent?.plan||{};',
  'const plan=intent?.shopping||intent?.shopping_plan||intent?.shoppingPlan||intent?.plan||{};',
  'shopping normalized plan field'
);

// 2) Explicit multiline shopping lists are deterministic data-entry, not an AI reasoning task.
// Build the complete add-plan locally, validate it through the mature V10.7 validators,
// then execute through the same transactional shopping engine. This removes multi-model latency
// and guarantees the planner cannot silently drop list lines.
const anchor='const route=await routeRequestV11(env,routeText);\n';
const injection=`const route=await routeRequestV11(env,routeText);\nconst explicitShoppingUnitsV11=extractExplicitShoppingUnitsV11(routeText);\nif(route.task==="shopping"&&explicitShoppingUnitsV11.length>=2){\n  const seed={\n    action:"shopping",\n    needs_clarification:false,\n    question:"",\n    reply:"",\n    shopping:{\n      mode:"mutate",\n      query:"all",\n      query_value:"",\n      operations:explicitShoppingUnitsV11.map(title=>({\n        op:"add",target:"",title,replacement:"",quantity_value:null,quantity_unit:"",quantity_text:"",quantity_exact:false,factor:null,meta:{}\n      }))\n    }\n  };\n  const safetyContext={...(validationContext||{}),baseText:routeText};\n  const intent=validateAndNormalizeIntent(seed,safetyContext);\n  applySafetyFixes(intent,safetyContext);\n  finalSafetyCheck(intent,safetyContext);\n  assertShoppingEntityPreservationV11(intent,routeText);\n  Object.assign(intent,{_v11_route:route,_v11_model:"deterministic:explicit-shopping-list",_latency_ms:0});\n  return intent;\n}\n`;
mustReplace(anchor,injection,'parseIntent deterministic shopping insertion');

fs.writeFileSync(p,s);
console.log('V11 shopping hotfix applied');
