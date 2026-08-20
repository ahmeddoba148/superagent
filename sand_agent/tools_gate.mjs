import { execFileSync } from 'node:child_process';

const URL = process.env.URL;
const CHAT = String(process.env.CHAT || '');
const W = process.env.W;
const DB = process.env.DB;
const CFG = process.env.CFG;
if (!URL || !CHAT || !W || !DB || !CFG) throw new Error('missing tools gate env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = 4_620_000_000 + (Date.now() % 10_000_000);
function esc(v) { return String(v).replaceAll("'", "''"); }
function q(sql) {
  const raw = execFileSync('npx', ['wrangler','d1','execute',DB,'--remote','--config',CFG,'--command',sql,'--json'], { encoding: 'utf8' });
  const data = JSON.parse(raw);
  return data?.[0]?.results || [];
}
function assert(ok, message, detail = null) {
  if (!ok) throw new Error(`${message}${detail ? ` :: ${JSON.stringify(detail)}` : ''}`);
  console.log(`PASS: ${message}`);
}
async function post(id, text) {
  const body = {
    update_id: id,
    message: {
      message_id: id % 1_000_000,
      date: Math.floor(Date.now() / 1000),
      chat: { id: Number(CHAT), type: 'private' },
      from: { id: Number(CHAT), is_bot: false, first_name: 'SAND-AGENT-GATE' },
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
async function waitDone(id, text) {
  for (let i = 0; i < 55; i++) {
    await sleep(1000);
    const row = q(`SELECT status,attempts,last_error FROM sand_v2_inbox WHERE update_id=${id} LIMIT 1`)[0];
    if (row?.status === 'done') return;
    if (row?.status === 'failed') throw new Error(`update ${id} failed: ${row.last_error}`);
    if (i > 5 && i % 6 === 0) await post(id, text);
  }
  throw new Error(`update ${id} did not finish`);
}
async function turn(offset, text) {
  const id = base + offset;
  await post(id, text);
  await waitDone(id, text);
  const row = q(`SELECT status,plan_json,result_json,error FROM sand_v2_operations WHERE chat_id='${esc(CHAT)}' AND source_update_id=${id} LIMIT 1`)[0];
  if (!row || row.status !== 'done') throw new Error(`operation ${id} not done: ${JSON.stringify(row)}`);
  return { id, plan: JSON.parse(row.plan_json), result: JSON.parse(row.result_json) };
}
function toolStep(turnResult, expectedName) {
  const planned = (turnResult.plan?.actions || []).find((x) => x?.type === 'tool.call');
  assert(planned?.args?.name === expectedName, `planner selected ${expectedName}`, planned || turnResult.plan);
  const step = (turnResult.result?.execution?.steps || []).find((x) => x?.tool_name === expectedName);
  assert(step?.tool_result?.ok === true, `${expectedName} executed and verified`, step || turnResult.result);
  return step.tool_result;
}

console.log('===== Agent OS semantic tool routing =====');

const calcTurn = await turn(1, 'احسبلي 25 × 18 + 7 بالظبط');
const calc = toolStep(calcTurn, 'calculator.evaluate');
assert(Number(calc.result) === 457, 'calculator returned exact verified result', calc);

const unitTurn = await turn(2, 'حوّل 3 كيلومتر لمتر');
const unit = toolStep(unitTurn, 'unit.convert');
assert(Math.abs(Number(unit.result) - 3000) < 1e-9, 'unit conversion returned 3000 m', unit);

const timeTurn = await turn(3, 'الساعة كام دلوقتي في القاهرة؟');
const clock = toolStep(timeTurn, 'datetime.now');
assert(clock.timezone === 'Africa/Cairo' && Boolean(clock.local) && Boolean(clock.utc), 'current time came from real clock tool', clock);

const weatherTurn = await turn(4, 'الجو في القاهرة دلوقتي عامل إيه؟');
const weather = toolStep(weatherTurn, 'weather.lookup');
assert(Number.isFinite(Number(weather?.current?.temperature_c)), 'weather came from live provider with temperature', weather);
assert(Boolean(weather?.location?.name), 'weather result has resolved location', weather?.location);

const hidden = q(`SELECT source_update_id,status,error FROM sand_v2_operations WHERE chat_id='${esc(CHAT)}' AND source_update_id BETWEEN ${base + 1} AND ${base + 4} AND status<>'done'`);
assert(hidden.length === 0, 'no hidden failed/partial tool operation', hidden);
console.log('SAND_AGENT_OS_V2_TOOLS_GATE_OK');
