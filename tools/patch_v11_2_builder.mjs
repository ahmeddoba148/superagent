import fs from 'node:fs';
const p='tools/build_v11_2.mjs';
let s=fs.readFileSync(p,'utf8');
const patches=[
  ["replaceBetween('const FAST_MODELS=[','export default{',modelRegistry+'\\nexport default{','model registry');","replaceBetween('const FAST_MODELS=[','export default{',modelRegistry+'\\n','model registry');","export marker"],
  ["replaceBetween('function v11RouteAxes(text){','function extractExplicitShoppingUnitsV11(text){',simpleExtract+'\\nfunction extractExplicitShoppingUnitsV11(text){','remove router engine');","replaceBetween('function v11RouteAxes(text){','function extractExplicitShoppingUnitsV11(text){',simpleExtract+'\\n','remove router engine');","shopping helper marker"],
  ["replaceBetween('function runV11PureSelfTests(){','async function parseIntentWithFallback(env,userText,validationContext){',selfTest+'\\nasync function parseIntentWithFallback(env,userText,validationContext){','self tests');","replaceBetween('function runV11PureSelfTests(){','async function parseIntentWithFallback(env,userText,validationContext){',selfTest+'\\n','self tests');","parser marker"],
  ["replaceBetween('async function parseIntentWithFallback(env,userText,validationContext){','async function parseIntentWithFallbackLegacy(env,userText,validationContext,V11_MODEL_POOL){',simplePlanner+'\\nasync function parseIntentWithFallbackLegacy(env,userText,validationContext,V11_MODEL_POOL){','simple 3-model planner');","replaceBetween('async function parseIntentWithFallback(env,userText,validationContext){','async function parseIntentWithFallbackLegacy(env,userText,validationContext,V11_MODEL_POOL){',simplePlanner+'\\n','simple 3-model planner');","legacy parser marker"],
  ["replaceBetween('const V111FIX_CHAT_MODELS=[','const profile=await getUserProfile(env,chatId);',directChat+'const profile=await getUserProfile(env,chatId);','direct chat chain');","replaceBetween('const V111FIX_CHAT_MODELS=[','const profile=await getUserProfile(env,chatId);',directChat,'direct chat chain');","profile marker"]
];
for(const [oldValue,newValue,label] of patches){
  if(!s.includes(oldValue))throw new Error('V11.2 builder patch anchor missing: '+label);
  s=s.replace(oldValue,newValue);
}
fs.writeFileSync(p,s);
console.log('patched all V11.2 builder boundary markers');
