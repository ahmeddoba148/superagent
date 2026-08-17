import{execFileSync}from'node:child_process';
import fs from'node:fs';
const U=process.env.URL,D=process.env.DB,C=String(process.env.STAGING_ADMIN_CHAT_ID||''),S=process.env.WEBHOOK_SECRET,cfg=process.env.WRANGLER_CONFIG||'wrangler.v1152.jsonc';
const sleep=m=>new Promise(r=>setTimeout(r,m)),esc=s=>String(s).replaceAll("'","''");
if(!U||!D||!C||!S)throw new Error('missing live-test environment');
function q(sql){return JSON.parse(execFileSync('npx',['wrangler','d1','execute',D,'--remote','--config',cfg,'--command',sql,'--json'],{encoding:'utf8'}))?.[0]?.results||[]}
let seq=2157000000+(Date.now()%1500000),mid=920000;const started=new Date().toISOString(),passes=[];
async function post(text,id=++seq){const body={update_id:id,message:{message_id:++mid,date:Math.floor(Date.now()/1000),chat:{id:Number(C),type:'private'},from:{id:Number(C),is_bot:false,first_name:'V1152'},text}},t=Date.now();const r=await fetch(U+'/telegram',{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':S},body:JSON.stringify(body)});if(!r.ok)throw new Error('webhook '+r.status+' '+await r.text());return{id,t,text}}
async function wait(id,max=90000){let row,end=Date.now()+max;while(Date.now()<end){row=q(`SELECT status,attempts,last_error FROM telegram_inbox_v106 WHERE update_id='${id}' LIMIT 1`)[0];if(row?.status==='done')return row;if(row?.status==='failed')throw new Error('inbox failed '+id+' '+row.last_error);await sleep(500)}throw new Error('inbox timeout '+id+' '+JSON.stringify(row))}
function pass(name,cond,detail=''){if(!cond)throw new Error('FAIL '+name+' '+detail);passes.push({name,detail:String(detail)});console.log('PASS',name,detail)}
async function proc(name,text){const x=await post(text),r=await wait(x.id);pass(name,r.attempts===1,'attempts='+r.attempts+' ms='+(Date.now()-x.t));return{x,r}}
q(`DELETE FROM shopping_sessions WHERE chat_id='${esc(C)}';DELETE FROM smart_list_items WHERE chat_id='${esc(C)}';DELETE FROM smart_lists WHERE chat_id='${esc(C)}';DELETE FROM reminders WHERE chat_id='${esc(C)}' AND title LIKE '%V1152LIVE%';`);
await proc('identity','انت اسمك اي');
await proc('casual egyptian','صباح الفل يا صاحبي');
const list='بص عاوز اشتري\nعيش تورتيلا\nعيش توست\nفينو اسود\nفصوص رومي\nشيدر طبيعي\nكاجو\nفستق\nكوفي شيك\nحليب دينا\nايس كريم دينا\nوبطاطس طبيعية';
let x=await post(list),r=await wait(x.id),rows=q(`SELECT title FROM smart_list_items WHERE chat_id='${esc(C)}' AND status='pending'`);pass('shopping multiline preserves 11',r.attempts===1&&rows.length===11,'items='+rows.length);
await proc('shopping view','/shopping');
x=await post('فكرني يوم 3 نوفمبر 2026 الساعة 7:23 مساء أراجع V1152LIVE-SINGLE');r=await wait(x.id);rows=q(`SELECT local_date,local_time FROM reminders WHERE chat_id='${esc(C)}' AND title LIKE '%V1152LIVE-SINGLE%' AND cancelled=0`);pass('exact reminder persisted',r.attempts===1&&rows.length===1&&rows[0].local_date==='2026-11-03'&&rows[0].local_time==='19:23',JSON.stringify(rows));
await proc('relative reminder','فكرني بعد 37 دقيقة أراجع V1152LIVE-RELATIVE');
await proc('daily recurrence','فكرني كل يوم الساعة 8:17 مساء أراجع V1152LIVE-DAILY');
await proc('free-time query','عندي وقت فاضي بكرة بين 6 و10 بالليل؟');
await proc('today','/today');await proc('tomorrow','/tomorrow');await proc('week','/week');await proc('month','/month');await proc('list','/list');await proc('recurring','/recurring');
await proc('location','/where');await proc('memory','/memory');await proc('audit','/audit');await proc('undo','/undo');await proc('live context','/live');
await proc('prayer awareness','مواقيت الصلاة النهاردة في القاهرة');
await proc('holiday awareness','اقرب اجازة رسمية امتى؟');
await proc('context follow-up','طب وبعدها بكام يوم؟');
const dup=++seq;await Promise.all([post('فكرني يوم 4 نوفمبر 2026 الساعة 7:25 مساء أراجع V1152LIVE-IDEMP',dup),post('فكرني يوم 4 نوفمبر 2026 الساعة 7:25 مساء أراجع V1152LIVE-IDEMP',dup)]);r=await wait(dup);rows=q(`SELECT id FROM reminders WHERE chat_id='${esc(C)}' AND title LIKE '%V1152LIVE-IDEMP%' AND cancelled=0`);pass('idempotency duplicate exactly once',rows.length===1,'rows='+rows.length+' attempts='+r.attempts);
const a=await post('/shopping'),b=await post('/today'),c=await post('عامل اي');const rr=await Promise.all([wait(a.id),wait(b.id),wait(c.id)]);pass('same-chat burst serialization',rr.every(z=>z.attempts===1),JSON.stringify(rr.map(z=>z.attempts)));
const failures=q(`SELECT scope,error_text,created_at FROM runtime_failures WHERE created_at>='${started}'`);pass('runtime failures zero',failures.length===0,JSON.stringify(failures));
fs.writeFileSync('V11_5_2_LIVE_REPORT.json',JSON.stringify({ok:true,version:'11.5.2',started,finished:new Date().toISOString(),scenario_count:passes.length,passes,runtime_failures:failures},null,2));
console.log('LIVE MATRIX PASS',passes.length);
