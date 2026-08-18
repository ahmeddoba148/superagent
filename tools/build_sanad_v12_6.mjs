import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const run = (args) => execFileSync(process.execPath, args, { stdio: 'inherit' });
run(['tools/build_sanad_v12_5.mjs']);
run(['tools/patch_sanad_v12_5_life_grounding.mjs']);

const baseFile = new URL('../Sanad_V12_5_FULL.js', import.meta.url);
const packFile = new URL('./sanad_v12_6_parity_pack.jsfrag', import.meta.url);
const outFile = new URL('../Sanad_V12_6_ULTIMATE_PARITY.js', import.meta.url);
let src = fs.readFileSync(baseFile, 'utf8');

function replaceOnce(label, needle, replacement) {
  if (!src.includes(needle)) throw new Error(`${label}: marker missing`);
  src = src.replace(needle, replacement);
}
function renameFunction(name, renamed) {
  const asyncNeedle = `async function ${name}(`;
  const syncNeedle = `function ${name}(`;
  if (src.includes(asyncNeedle)) return replaceOnce(`rename ${name}`, asyncNeedle, `async function ${renamed}(`);
  if (src.includes(syncNeedle)) return replaceOnce(`rename ${name}`, syncNeedle, `function ${renamed}(`);
  throw new Error(`rename ${name}: declaration missing`);
}

src = src.replaceAll('V12.5', 'V12.6');
replaceOnce('version', 'const VERSION = "12.5.0";', 'const VERSION = "12.6.0";');
replaceOnce('name', 'const NAME = "سند — Sanad V12.6";', 'const NAME = "سند — Sanad V12.6 Ultimate Parity";');

replaceOnce(
  'diagnostics route',
  '    if (request.method === "GET" && url.pathname === "/ready") return ready(request, env);',
  '    if (request.method === "GET" && url.pathname === "/ready") return ready(request, env);\n    if (request.method === "GET" && url.pathname === "/diagnostics") return diagnosticsV126(request, env);'
);

replaceOnce(
  'tomorrow and list commands',
  '    if (text === "/today") return showToday(env,chatId,user);\n    if (text === "/week") return showRangeV125(env,chatId,user,7);',
  '    if (text === "/today") return showToday(env,chatId,user);\n    if (text === "/tomorrow") return showTomorrowV126(env,chatId,user);\n    if (text === "/list") return showAllScheduleV126(env,chatId,user);\n    if (text === "/week") return showRangeV125(env,chatId,user,7);'
);
replaceOnce(
  'inbox settings commands',
  '    if (text === "/waiting") return showWaitingV125(env,chatId);\n    if (text === "/where") return showWhereV125(env,chatId,user);',
  '    if (text === "/waiting") return showWaitingV125(env,chatId);\n    if (text === "/inbox") return showLifeInboxV126(env,chatId);\n    if (text === "/settings") return showSettingsV126(env,chatId);\n    if (text === "/where") return showWhereV125(env,chatId,user);'
);
replaceOnce(
  'prayer direct panel',
  '    if (text === "/prayer") {const r=await toolPrayerTimesV125(env,chatId,{},user);return sendText(env,chatId,formatPrayerV125(r));}',
  '    if (text === "/prayer") return showPrayerPanelV126(env,chatId,user);'
);
replaceOnce(
  'live direct reality',
  '    if (text === "/live") return sendText(env,chatId,"🛰️ ابعتلي طبيعي: تابعلي أخبار ... أو آخر أخبار ... وسند هيتصرف.");',
  '    if (text === "/live") return showLiveRealityV126(env,chatId,user);'
);
replaceOnce(
  'fast casual path',
  '    if(!(await consumeRateV125(env,chatId))){await sendText(env,chatId,"طلبات كتير جدًا في وقت قصير 😅 اديني ثواني وجرب تاني.");return;}',
  '    const fastReply=fastCasualReplyV126(text);if(fastReply){await saveMsg(env,chatId,"user",text,{fast_path:true});await sendText(env,chatId,fastReply);await saveMsg(env,chatId,"assistant",fastReply,{fast_path:true});return;}\n    if(!(await consumeRateV125(env,chatId))){await sendText(env,chatId,"طلبات كتير جدًا في وقت قصير 😅 اديني ثواني وجرب تاني.");return;}'
);

replaceOnce(
  'telegram command aliases',
  '{command:"start",description:"تشغيل سند"},{command:"menu",description:"كل اختصارات سند"},\n    {command:"today",description:"مواعيد النهاردة"},{command:"week",description:"جدول الأسبوع"},{command:"month",description:"جدول الشهر"},{command:"recurring",description:"التكرارات"},\n    {command:"shopping",description:"قائمة المشتريات"},{command:"projects",description:"المشاريع"},{command:"waiting",description:"الحاجات اللي مستنيها"},',
  '{command:"start",description:"تشغيل سند"},{command:"menu",description:"كل اختصارات سند"},\n    {command:"today",description:"مواعيد النهاردة"},{command:"tomorrow",description:"مواعيد بكرة"},{command:"week",description:"جدول الأسبوع"},{command:"month",description:"جدول الشهر"},{command:"list",description:"كل المواعيد القادمة"},{command:"recurring",description:"التكرارات"},\n    {command:"shopping",description:"قائمة المشتريات"},{command:"projects",description:"المشاريع"},{command:"waiting",description:"الحاجات اللي مستنيها"},{command:"inbox",description:"صندوق الوارد"},{command:"settings",description:"إعدادات سند"},'
);

for (const [name, renamed] of [
  ['ensureSchema','ensureSchemaV125Base'],
  ['health','healthV125Base'],
  ['buildContext','buildContextV125Base'],
  ['callModels','callModelsV125Base'],
  ['sendText','sendTextV125Base'],
  ['transcribeVoice','transcribeVoiceV125Base'],
  ['handleCallback','handleCallbackV125Base'],
  ['showShopping','showShoppingV125Base'],
  ['showRecurrencesV125','showRecurrencesV125Base'],
  ['toolShoppingRead','toolShoppingReadV125Base'],
  ['toolShoppingUpdate','toolShoppingUpdateV125Base'],
  ['toolShoppingProgressV125','toolShoppingProgressV125Base'],
  ['toolReminderCreate','toolReminderCreateV125Base'],
  ['normalizeRuleV125','normalizeRuleV125Base'],
  ['generateRecurrenceOccurrencesV125','generateRecurrenceOccurrencesV125Base'],
  ['toolRecurrenceUpdateV125','toolRecurrenceUpdateV125Base'],
  ['toolScheduleShiftV125','toolScheduleShiftV125Base'],
  ['toolDependencyCreateV125','toolDependencyCreateV125Base'],
  ['propagateDependenciesV125','propagateDependenciesV125Base'],
  ['toolWorldUpsertV125','toolWorldUpsertV125Base'],
  ['toolWorldLinkV125','toolWorldLinkV125Base'],
  ['fetchPrayerTimesV125','fetchPrayerTimesV125Base'],
  ['toolHolidaysV125','toolHolidaysV125Base'],
  ['toolWeatherV125','toolWeatherV125Base'],
  ['toolLiveNewsV125','toolLiveNewsV125Base'],
  ['toolSystemClearAllV125','toolSystemClearAllV125Base'],
  ['snapshotUserStateV125','snapshotUserStateV125Base'],
  ['restoreUserStateV125','restoreUserStateV125Base'],
  ['augmentExplicitLifeStepsV125','augmentExplicitLifeStepsV125Base'],
  ['sendOnceV125','sendOnceV125Base'],
  ['formatPrayerV125','formatPrayerV125Base'],
  ['dispatchTool','dispatchToolV125Base']
]) renameFunction(name, renamed);

const pack = fs.readFileSync(packFile, 'utf8');
src += `\n\n/* ================= SANAD V12.6 ULTIMATE PARITY PACK ================= */\n${pack.trim()}\n`;

const buf = Buffer.from(src, 'utf8');
fs.writeFileSync(outFile, buf);
console.log(JSON.stringify({
  ok: true,
  version: '12.6.0',
  bytes: buf.length,
  lines: src.split('\n').length,
  sha256: crypto.createHash('sha256').update(buf).digest('hex')
}));
