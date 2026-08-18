import fs from 'fs';
import {spawn} from 'child_process';
import readline from 'readline';
const dbfile='./v10_e2e.sqlite';try{fs.unlinkSync(dbfile)}catch{}
const py=spawn('python',['tests/sqlite_server.py',dbfile],{stdio:['pipe','pipe','inherit']});
const rl=readline.createInterface({input:py.stdout});const pending=[];rl.on('line',line=>{const p=pending.shift();if(!p)return;const j=JSON.parse(line);j.ok?p.resolve(j.value):p.reject(new Error(j.error+'\n'+j.trace));});
const bridge=req=>new Promise((resolve,reject)=>{pending.push({resolve,reject});py.stdin.write(JSON.stringify(req)+'\n')});
class Stmt{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}run(){return bridge({mode:'run',sql:this.sql,args:this.args})}all(){return bridge({mode:'all',sql:this.sql,args:this.args})}first(){return bridge({mode:'first',sql:this.sql,args:this.args})}}
class DB{prepare(sql){return new Stmt(sql)}batch(stmts){return bridge({mode:'batch',items:stmts.map(x=>({sql:x.sql,args:x.args}))})}}
const telegram=[];
globalThis.fetch=async (url,opts={})=>{
 const u=String(url);
 if(u.includes('/file/bot')) return new Response(new Blob(['voice-bytes'],{type:'audio/ogg'}),{status:200});
 if(u.includes('api.telegram.org/bot')){
   const method=u.split('/').pop();let body={};try{body=JSON.parse(opts.body||'{}')}catch{}
   telegram.push({method,body});
   if(method==='getFile')return Response.json({ok:true,result:{file_path:'voice/file.ogg'}});
   if(method==='sendMessage')return Response.json({ok:true,result:{message_id:100+telegram.length,chat:{id:body.chat_id},text:body.text}});
   if(method==='editMessageText')return Response.json({ok:true,result:{message_id:body.message_id,chat:{id:body.chat_id},text:body.text}});
   if(method==='answerCallbackQuery'||method==='sendChatAction'||method==='setWebhook'||method==='setMyCommands'||method==='getWebhookInfo')return Response.json({ok:true,result:method==='getWebhookInfo'?{url:'',allowed_updates:[]}:true});
   return Response.json({ok:true,result:true});
 }
 throw new Error('Unexpected network '+u);
};
const mod=await import(new URL('../SuperAgent_V10_Final_Stability.js?e2e='+Date.now(), import.meta.url).href);const worker=mod.default;
const env={DB:new DB(),TELEGRAM_BOT_TOKEN:'TOKEN',TELEGRAM_WEBHOOK_SECRET:'SECRET',OMNIAI_API_KEY:'KEY',SETUP_KEY:'SETUP',PUBLIC_BOT:'true',OMNIAI_SERVICE:{fetch:async req=>Response.json({text:'ضيف مناديل للمشتريات'})}};
let pass=0,fail=0;const tests=[];const ok=(name,c,d='')=>{if(c){pass++;tests.push({name,ok:true})}else{fail++;tests.push({name,ok:false,detail:d})}};
async function webhook(update){const waits=[];const ctx={waitUntil:p=>waits.push(Promise.resolve(p))};const r=await worker.fetch(new Request('https://x.test/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'SECRET','Content-Type':'application/json'},body:JSON.stringify(update)}),env,ctx);await Promise.allSettled(waits);return r;}
try{
 let r=await webhook({update_id:1,message:{message_id:1,chat:{id:77,type:'private'},text:'/start'}});ok('webhook /start 200',r.status===200,String(r.status));
 let sends=telegram.filter(x=>x.method==='sendMessage');const welcome=String(sends[0]?.body?.text||'');ok('welcome sent',sends.length===1&&(welcome.includes('Super Agent')||welcome.includes('سوبر إيجنت')),JSON.stringify(sends));ok('welcome no buttons',!sends[0].body.reply_markup,JSON.stringify(sends[0].body));
 await webhook({update_id:1,message:{message_id:1,chat:{id:77,type:'private'},text:'/start'}});sends=telegram.filter(x=>x.method==='sendMessage');ok('duplicate update ignored',sends.length===1,String(sends.length));
 const beforeAdd=telegram.length;await webhook({update_id:2,message:{message_id:2,chat:{id:77,type:'private'},text:'ضيف لبن وبيض للمشتريات'}});const addCalls=telegram.slice(beforeAdd).filter(x=>x.method==='sendMessage');ok('shopping add confirmation',addCalls.some(x=>x.body.text.includes('ضفت 2')),JSON.stringify(addCalls));ok('ordinary shopping add no buttons',addCalls.every(x=>!x.body.reply_markup),JSON.stringify(addCalls));
 const items=(await env.DB.prepare(`SELECT * FROM smart_list_items WHERE chat_id='77' ORDER BY id`).all()).results;ok('2 shopping rows',items.length===2,JSON.stringify(items));
 const beforeHyper=telegram.length;await webhook({update_id:3,message:{message_id:3,chat:{id:77,type:'private'},text:'انا في الهايبر'}});const hyper=telegram.slice(beforeHyper).filter(x=>x.method==='sendMessage');ok('hyper opens todo',hyper.some(x=>x.body.reply_markup?.inline_keyboard),JSON.stringify(hyper));
 const first=items[0];await webhook({update_id:4,callback_query:{id:'cb1',from:{id:77},message:{message_id:999,chat:{id:77,type:'private'}},data:`shop:toggle:${first.id}`}});let row=await env.DB.prepare('SELECT status FROM smart_list_items WHERE id=?').bind(first.id).first();ok('callback toggles bought',row?.status==='bought',JSON.stringify(row));
 await webhook({update_id:4,callback_query:{id:'cb1',from:{id:77},message:{message_id:999,chat:{id:77,type:'private'}},data:`shop:toggle:${first.id}`}});row=await env.DB.prepare('SELECT status FROM smart_list_items WHERE id=?').bind(first.id).first();ok('duplicate callback does not untoggle',row?.status==='bought',JSON.stringify(row));
 const beforeVoice=telegram.length;await webhook({update_id:5,message:{message_id:5,chat:{id:77,type:'private'},voice:{file_id:'VOICE',file_size:1000}}});const voiceCalls=telegram.slice(beforeVoice).filter(x=>x.method==='sendMessage');ok('voice transcript executed',voiceCalls.some(x=>x.body.text.includes('مناديل')),JSON.stringify(voiceCalls));ok('voice normal response no buttons',voiceCalls.every(x=>!x.body.reply_markup),JSON.stringify(voiceCalls));
 const nap=await env.DB.prepare(`SELECT status FROM smart_list_items WHERE chat_id='77' AND title='مناديل'`).first();ok('voice added item DB',nap?.status==='pending',JSON.stringify(nap));
 const ledger=(await env.DB.prepare('SELECT update_id,status FROM telegram_updates ORDER BY CAST(update_id AS INTEGER)').all()).results;ok('all processed ledger done',ledger.length===5&&ledger.every(x=>x.status==='done'),JSON.stringify(ledger));
}catch(e){fail++;tests.push({name:'unexpected exception',ok:false,detail:String(e.stack||e)});}
console.log(JSON.stringify({pass,fail,total:pass+fail,tests},null,2));py.stdin.write(JSON.stringify({mode:'close'})+'\n');setTimeout(()=>process.exit(fail?1:0),30);
