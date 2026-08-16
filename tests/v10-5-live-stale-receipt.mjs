import {execFileSync} from 'node:child_process';
const URL=process.env.STAGING_URL, SECRET=process.env.STAGING_TELEGRAM_WEBHOOK_SECRET, CHAT=String(process.env.STAGING_ADMIN_CHAT_ID||'');
if(!URL||!SECRET||!CHAT)throw new Error('Missing staging env');
const DB='superagent-v105-staging',CFG='wrangler.staging.jsonc';let id=Number(String(Date.now()).slice(-9));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function d1(sql){const x=JSON.parse(execFileSync('npx',['wrangler','d1','execute',DB,'--remote','--json','--config',CFG,'--command',sql],{encoding:'utf8',env:process.env}));return (Array.isArray(x)?x[0]:x)?.results||[];}
async function say(text){const n=++id;const r=await fetch(URL+'/telegram',{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':SECRET},body:JSON.stringify({update_id:n,message:{message_id:n,from:{id:Number(CHAT),is_bot:false},chat:{id:Number(CHAT),type:'private'},date:Math.floor(Date.now()/1000),text}})});if((await r.text())!=='OK')throw new Error('webhook rejected');}
async function waitFor(fn,label){for(let i=0;i<24;i++){const v=fn();if(v)return v;await sleep(700)}throw new Error('timeout '+label)}
const title='اجتماع إعادة 515';const text='يوم 29 ديسمبر 2026 الساعة 6:35 مساء عندي اجتماع اسمه إعادة 515 ومدته ساعة';
const C=CHAT.replaceAll("'","''");
d1(`DELETE FROM reminders WHERE chat_id='${C}' AND title='${title}'; DELETE FROM operation_receipts WHERE chat_id='${C}'; DELETE FROM action_audit WHERE chat_id='${C}'; DELETE FROM telegram_updates WHERE chat_id='${C}'; DELETE FROM conversation_messages WHERE chat_id='${C}';`);
console.log('USER > '+text);await say(text);let row=await waitFor(()=>d1(`SELECT id,title,local_date,local_time FROM reminders WHERE chat_id='${C}' AND title='${title}' AND cancelled=0 LIMIT 1`)[0],'first create');console.log('PASS first create',row);
console.log('USER > /undo');await say('/undo');await waitFor(()=>d1(`SELECT COUNT(*) c FROM reminders WHERE chat_id='${C}' AND title='${title}' AND cancelled=0`)[0]?.c===0?true:null,'undo removal');console.log('PASS undo removed first create');
const receipts=d1(`SELECT id,state FROM operation_receipts WHERE chat_id='${C}' ORDER BY id DESC LIMIT 3`);if(!receipts.length)throw new Error('expected receipt to exist before recreate');console.log('Receipt before recreate',receipts);
console.log('USER > SAME CREATE AGAIN');await say(text);row=await waitFor(()=>d1(`SELECT id,title,local_date,local_time FROM reminders WHERE chat_id='${C}' AND title='${title}' AND cancelled=0 LIMIT 1`)[0],'recreate after stale receipt');console.log('PASS recreate after undo despite old receipt',row);
const states=d1(`SELECT id,state FROM operation_receipts WHERE chat_id='${C}' ORDER BY id`);if(!states.some(x=>x.state==='stale'))throw new Error('old receipt was not invalidated as stale');if(!states.some(x=>x.state==='committed'))throw new Error('new committed receipt missing');console.log('PASS stale receipt invalidated + new receipt committed',states);
console.log(JSON.stringify({ok:true,test:'live stale receipt recreate',row,states}));
