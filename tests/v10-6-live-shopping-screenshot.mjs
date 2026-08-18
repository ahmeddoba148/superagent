import {execFileSync} from 'node:child_process';
const URL=process.env.STAGING_URL,SECRET=process.env.STAGING_TELEGRAM_WEBHOOK_SECRET,CHAT=String(process.env.STAGING_ADMIN_CHAT_ID||'').trim();
const CONFIG='wrangler.v106.staging.jsonc',DB='superagent-v106-staging';
if(!URL||!SECRET||!CHAT)throw new Error('Missing live staging environment');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),q=s=>String(s).replaceAll("'","''"),C=q(CHAT);let seq=810000000+Number(String(Date.now()).slice(-7));
function d1(sql){const raw=execFileSync('npx',['wrangler','d1','execute',DB,'--remote','--json','--config',CONFIG,'--command',sql],{encoding:'utf8',env:process.env,maxBuffer:20*1024*1024});const j=JSON.parse(raw),b=Array.isArray(j)?j[0]:j;if(b?.success===false)throw new Error(raw);return b?.results||[]}
function assert(name,cond,detail=''){console.log(`${cond?'PASS':'FAIL'} ${name}${detail?` :: ${detail}`:''}`);if(!cond)throw new Error(`${name}: ${detail}`)}
function update(id,text){return{update_id:id,message:{message_id:id,from:{id:Number(CHAT),is_bot:false,first_name:'RealShopping'},chat:{id:Number(CHAT),type:'private'},date:Math.floor(Date.now()/1000),text}}}
async function post(text){const id=++seq,r=await fetch(`${URL}/telegram`,{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':SECRET},body:JSON.stringify(update(id,text))});const body=await r.text();if(r.status!==200||body!=='OK')throw new Error(`Webhook ${r.status} ${body}`);for(let i=0;i<80;i++){const s=d1(`SELECT status FROM telegram_inbox_v106 WHERE update_id='${id}'`)[0]?.status;if(s==='done')return id;if(s==='failed')throw new Error(`update ${id} failed`);await sleep(400)}throw new Error(`timeout update ${id}`)}

console.log('=== V10.6 LIVE SCREENSHOT SHOPPING REGRESSION ===');
for(const table of ['event_dependencies','reminder_fires','schedule_fires','reminders','schedule_rules','smart_list_items','smart_lists','shopping_sessions','conversation_messages','pending_dialogs','pending_conflicts','pending_requests','action_audit','operation_receipts','telegram_updates','telegram_inbox_v106','telegram_chat_leases_v106']){
  try{d1(`DELETE FROM ${table} WHERE chat_id='${C}'`)}catch(e){if(!/no such column/i.test(String(e)))throw e}
}
const text=`بص عاوز اشتري\nعيش تورتيلا\nعيش توست\nفينو اسود\nفصوص رومي\nشيدر طبيعي\nكاجو\nفسدق\nكوفي شيك\nحليب دينا\nايس كريم دينا`;
await post(text);
let shop=d1(`SELECT title,status FROM smart_list_items WHERE chat_id='${C}' ORDER BY id`),rem=d1(`SELECT title,local_date,local_time FROM reminders WHERE chat_id='${C}' ORDER BY id`);
const expected=['عيش تورتيلا','عيش توست','فينو اسود','فصوص رومي','شيدر طبيعي','كاجو','فسدق','كوفي شيك','حليب دينا','ايس كريم دينا'];
assert('live exact multiline -> 10 shopping',shop.length===10&&expected.every(x=>shop.some(y=>y.title===x)),JSON.stringify(shop));
assert('live exact multiline -> zero reminders',rem.length===0,JSON.stringify(rem));
await post('لا ضفهم لقائمه المشتريات');
shop=d1(`SELECT title FROM smart_list_items WHERE chat_id='${C}' ORDER BY id`);rem=d1(`SELECT title FROM reminders WHERE chat_id='${C}' ORDER BY id`);
assert('live correction keeps exactly 10 shopping',shop.length===10,JSON.stringify(shop));assert('live correction no reminders',rem.length===0,JSON.stringify(rem));
await post('مش عاوز تذكير');
shop=d1(`SELECT title FROM smart_list_items WHERE chat_id='${C}' ORDER BY id`);rem=d1(`SELECT title FROM reminders WHERE chat_id='${C}' ORDER BY id`);
assert('live no-reminder correction keeps shopping',shop.length===10,JSON.stringify(shop));assert('live no-reminder correction no reminders',rem.length===0,JSON.stringify(rem));
await post('/shopping');
const bad=d1(`SELECT COUNT(*) c FROM runtime_failures WHERE chat_id='${C}' AND created_at>=datetime('now','-20 minutes')`)[0];assert('live screenshot flow no runtime failures',Number(bad?.c||0)===0,JSON.stringify(bad));
console.log(JSON.stringify({ok:true,shopping:shop.length,reminders:rem.length},null,2));
