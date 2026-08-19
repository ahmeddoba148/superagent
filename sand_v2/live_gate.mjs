import { execFileSync } from 'node:child_process';

const URL = process.env.URL;
const CHAT = String(process.env.CHAT || '');
const W = process.env.W;
const DB = process.env.DB;
const CFG = process.env.CFG;
if (!URL || !CHAT || !W || !DB || !CFG) throw new Error('missing gate env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = 4_400_000_000 + (Date.now() % 10_000_000);

function cairoDateKey() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function plusDays(dateKey, n) {
  const [y,m,d] = dateKey.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n, 12));
  const yyyy = String(x.getUTCFullYear());
  const mm = String(x.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(x.getUTCDate()).padStart(2, '0');
  return { key: `${yyyy}-${mm}-${dd}`, human: `${dd}/${mm}/${yyyy}` };
}
const tomorrow = plusDays(cairoDateKey(), 1);
const corrected = plusDays(cairoDateKey(), 2);
const doctorDate = plusDays(cairoDateKey(), 3);

function q(sql) {
  const raw = execFileSync('npx', ['wrangler','d1','execute',DB,'--remote','--config',CFG,'--command',sql,'--json'], { encoding: 'utf8' });
  const data = JSON.parse(raw);
  return data?.[0]?.results || [];
}
function esc(v) { return String(v).replaceAll("'", "''"); }
async function post(id, text) {
  const body = {
    update_id: id,
    message: {
      message_id: id % 1_000_000,
      date: Math.floor(Date.now() / 1000),
      chat: { id: Number(CHAT), type: 'private' },
      from: { id: Number(CHAT), is_bot: false, first_name: 'SAND-V2-GATE' },
      text,
    },
  };
  const r = await fetch(`${URL}/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': W },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`webhook ${r.status}: ${await r.text()}`);
}
async function waitDone(id, textForSafeRetrigger = null) {
  for (let i = 0; i < 55; i++) {
    await sleep(1000);
    const row = q(`SELECT status,attempts,last_error,retry_after_ms FROM sand_v2_inbox WHERE update_id=${id} LIMIT 1`)[0];
    if (row?.status === 'done') return row;
    if (row?.status === 'failed') throw new Error(`update ${id} failed: ${row.last_error}`);
    if (i > 5 && i % 6 === 0 && textForSafeRetrigger) await post(id, textForSafeRetrigger);
  }
  throw new Error(`update ${id} did not finish`);
}
async function turn(offset, text) {
  const id = base + offset;
  await post(id, text);
  await waitDone(id, text);
  const op = q(`SELECT status,plan_json,result_json,error FROM sand_v2_operations WHERE chat_id='${esc(CHAT)}' AND source_update_id=${id} LIMIT 1`)[0];
  if (!op) throw new Error(`missing operation for ${id}`);
  if (!['done'].includes(op.status)) throw new Error(`turn ${offset} not done; status=${op.status} error=${op.error || ''} plan=${op.plan_json || ''}`);
  return { id, op };
}
function objects() {
  return q(`SELECT id,kind,title,state_json,status,created_by_update,updated_by_update FROM sand_v2_objects WHERE chat_id='${esc(CHAT)}' AND status='active' ORDER BY created_at`)
    .map((r) => ({ ...r, state: JSON.parse(r.state_json) }));
}
function reminders() {
  return q(`SELECT id,object_id,title,remind_at_utc,timezone,mode,status,source_update_id FROM sand_v2_reminders WHERE chat_id='${esc(CHAT)}' AND status IN ('pending','sending','uncertain') ORDER BY created_at`);
}
function assert(ok, message, detail = null) {
  if (!ok) throw new Error(`${message}${detail ? ` :: ${JSON.stringify(detail)}` : ''}`);
  console.log(`PASS: ${message}`);
}

// Isolate only this staging chat's V2 state. No production tables are touched.
q(`DELETE FROM sand_v2_deliveries WHERE chat_id='${esc(CHAT)}';
DELETE FROM sand_v2_operation_steps WHERE operation_id IN (SELECT id FROM sand_v2_operations WHERE chat_id='${esc(CHAT)}');
DELETE FROM sand_v2_operations WHERE chat_id='${esc(CHAT)}';
DELETE FROM sand_v2_reminders WHERE chat_id='${esc(CHAT)}';
DELETE FROM sand_v2_memories WHERE chat_id='${esc(CHAT)}';
DELETE FROM sand_v2_objects WHERE chat_id='${esc(CHAT)}';
DELETE FROM sand_v2_workspaces WHERE chat_id='${esc(CHAT)}';
DELETE FROM sand_v2_messages WHERE chat_id='${esc(CHAT)}';
DELETE FROM sand_v2_ai_calls WHERE chat_id='${esc(CHAT)}';
DELETE FROM sand_v2_inbox WHERE chat_id='${esc(CHAT)}';
DELETE FROM sand_v2_chat_ingress WHERE chat_id='${esc(CHAT)}';
DELETE FROM sand_v2_chat_leases WHERE chat_id='${esc(CHAT)}';`);

console.log('===== Conversation continuity: commitment, details, anchored reminder, corrections =====');
const t1 = 'بكرة الساعة ٥ العصر عندي فرح واحد صاحبي';
await turn(1, t1);
let os = objects();
assert(os.length === 1, 'one object created, no duplicate', os);
const first = os[0];
assert(first.kind === 'commitment', 'future occasion represented as commitment, not forced calendar event', first);
assert(first.state.start_local === `${tomorrow.key}T17:00`, 'relative tomorrow + 17:00 resolved against Cairo time', first.state);
assert(!first.state.end_local, 'no invented end time', first.state);
assert(reminders().length === 0, 'no reminder invented before user asks');

const t2 = 'المكان في المعادي، وخلي بالك ده نفس الفرح اللي بنتكلم عليه';
await turn(2, t2);
os = objects();
assert(os.length === 1 && os[0].id === first.id, 'detail continued same active object');
assert(String(os[0].state.location || '').includes('المعادي'), 'location added to same object', os[0].state);

const t3 = 'عايزك تنبهني لما ييجي معاده';
await turn(3, t3);
let rs = reminders();
assert(rs.length === 1 && rs[0].object_id === first.id, 'exactly one reminder attached to focused commitment', rs);
assert(rs[0].mode === 'at_start', 'reminder stored as semantic at-start policy', rs[0]);
const beforeDateCorrection = objects()[0].state.start_local;
const beforeReminderUtc = rs[0].remind_at_utc;

const t4 = `غير التاريخ وخليه يوم ${corrected.human}، الساعة زي ما هي`;
await turn(4, t4);
os = objects(); rs = reminders();
assert(os.length === 1 && os[0].id === first.id, 'date correction patched same object, no AMBIGUOUS/no duplicate', os);
assert(os[0].state.start_local === `${corrected.key}T17:00`, 'date changed while time was preserved', { beforeDateCorrection, after: os[0].state.start_local });
assert(rs.length === 1 && rs[0].object_id === first.id && rs[0].mode === 'at_start', 'date correction kept one anchored reminder', rs);
assert(rs[0].remind_at_utc !== beforeReminderUtc, 'anchored reminder automatically moved with object date', rs[0]);

const t5 = 'والميعاد يبقى ستة ونص بدل خمسة';
await turn(5, t5);
os = objects(); rs = reminders();
assert(os.length === 1 && os[0].id === first.id, 'time correction patched same object');
assert(os[0].state.start_local === `${corrected.key}T18:30`, 'time changed while corrected date was preserved', os[0].state);
assert(rs.length === 1 && rs[0].object_id === first.id, 'time correction created no duplicate reminder', rs);

// Same Telegram update again must be a no-op on durable state.
await post(base + 5, t5);
await sleep(2500);
assert(objects().length === 1 && reminders().length === 1, 'duplicate Telegram update caused no duplicate side effect');

console.log('===== Reference switching between multiple live objects =====');
const t6 = `وعندي كمان كشف دكتور يوم ${doctorDate.human} الساعة ٧ بالليل`;
await turn(6, t6);
os = objects();
assert(os.length === 2, 'second commitment created as separate object', os);
const second = os.find((o) => Number(o.created_by_update) === base + 6);
assert(Boolean(second), 'second object identifiable by operation source', os);
assert(second.state.start_local === `${doctorDate.key}T19:00`, 'second object has its own time', second?.state);

const t7 = 'بالنسبة للفرح، رجع ساعته ستة بالظبط';
await turn(7, t7);
os = objects();
const firstAfterSwitch = os.find((o) => o.id === first.id);
const secondAfterSwitch = os.find((o) => o.id === second.id);
assert(firstAfterSwitch?.state.start_local === `${corrected.key}T18:00`, 'semantic reference switched back to earlier object', firstAfterSwitch?.state);
assert(secondAfterSwitch?.state.start_local === `${doctorDate.key}T19:00`, 'unreferenced second object was not modified', secondAfterSwitch?.state);

const t8 = 'كشف الدكتور نفسه خليه الساعة ٨ بدل ٧';
await turn(8, t8);
os = objects();
const secondAfterPatch = os.find((o) => o.id === second.id);
assert(secondAfterPatch?.state.start_local === `${doctorDate.key}T20:00`, 'semantic reference switched to doctor commitment and preserved its date', secondAfterPatch?.state);

console.log('===== Memory continuity without object confusion =====');
await turn(9, 'افتكر إن اسم مراتي مرام');
let mem = q(`SELECT subject,predicate,value_json,status FROM sand_v2_memories WHERE chat_id='${esc(CHAT)}' AND status='active'`);
assert(mem.length >= 1 && mem.some((m) => String(m.value_json).includes('مرام')), 'natural memory fact persisted', mem);
await turn(10, 'اسم مراتي إيه؟');
const lastOp = q(`SELECT status,plan_json,result_json FROM sand_v2_operations WHERE chat_id='${esc(CHAT)}' AND source_update_id=${base + 10} LIMIT 1`)[0];
assert(lastOp?.status === 'done', 'memory recall turn completed without clarification', lastOp);
const assistant = q(`SELECT content FROM sand_v2_messages WHERE chat_id='${esc(CHAT)}' AND update_id=${base + 10} AND role='assistant' LIMIT 1`)[0];
assert(String(assistant?.content || '').includes('مرام'), 'remembered fact recalled naturally', assistant);

const bad = q(`SELECT source_update_id,status,error,plan_json FROM sand_v2_operations WHERE chat_id='${esc(CHAT)}' AND source_update_id BETWEEN ${base + 1} AND ${base + 10} AND status<>'done'`);
assert(bad.length === 0, 'no hidden clarify/partial/failed operation in clear-context flow', bad);
console.log('SAND_CORE_V2_SEMANTIC_CONVERSATION_GATE_OK');
