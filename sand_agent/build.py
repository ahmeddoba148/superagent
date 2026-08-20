from pathlib import Path
import hashlib
import subprocess

ROOT = Path(__file__).resolve().parent
CORE_FILE = ROOT.parent / "SAND_CORE_V2.js"
OUT = ROOT.parent / "SAND_AGENT_OS_V2.js"
EXPECTED_CORE_SHA = "bc4c33f7ea0f7dfae073d81684b4ad7f60c48bddcf8dcfb7acf4d4bdba36eb80"

subprocess.run(["node", str(ROOT.parent / "sand_v2" / "assemble.mjs")], cwd=ROOT.parent, check=True)
source = CORE_FILE.read_text(encoding="utf-8")
core_sha = hashlib.sha256(source.encode()).hexdigest()
if core_sha != EXPECTED_CORE_SHA:
    raise SystemExit(f"Certified Core V2 mismatch: {core_sha}")

source = source.replace(
    'const APP_NAME = "SAND PRIME Core V2";\nconst APP_VERSION = "2.0.0-core-v2";',
    'const APP_NAME = "SAND PRIME Agent OS V2";\nconst APP_VERSION = "2.1.0-agent-os-v2";',
    1,
)
source = source.replace('  "memory.forget",\n]);', '  "memory.forget",\n  "tool.call",\n]);', 1)

object_kinds = '''const ALLOWED_OBJECT_KINDS = new Set([\n  "commitment",\n  "task",\n  "note",\n  "contact",\n  "list",\n  "project",\n  "preference",\n  "generic",\n]);\n'''
tool_registry = object_kinds + r'''
const TOOL_RISK = Object.freeze({ READ: "read", LOW: "low", EXTERNAL: "external", HIGH: "high" });

const BUILTIN_TOOLS = Object.freeze([
  Object.freeze({
    name: "weather.lookup",
    risk: TOOL_RISK.READ,
    description: "Get live current weather and a short forecast for a named place or coordinates from Open-Meteo.",
    schema: Object.freeze({ required: [], properties: Object.freeze({ location: "string", latitude: "number", longitude: "number", days: "number" }) }),
  }),
  Object.freeze({
    name: "datetime.now",
    risk: TOOL_RISK.READ,
    description: "Get the real current date, time, weekday and UTC value for an IANA timezone; defaults to Africa/Cairo.",
    schema: Object.freeze({ required: [], properties: Object.freeze({ timezone: "string" }) }),
  }),
  Object.freeze({
    name: "calculator.evaluate",
    risk: TOOL_RISK.READ,
    description: "Safely evaluate arithmetic with + - * / parentheses, percentages and exponentiation without eval.",
    schema: Object.freeze({ required: Object.freeze(["expression"]), properties: Object.freeze({ expression: "string" }) }),
  }),
  Object.freeze({
    name: "unit.convert",
    risk: TOOL_RISK.READ,
    description: "Convert common length, mass, volume and temperature units deterministically.",
    schema: Object.freeze({ required: Object.freeze(["value", "from", "to"]), properties: Object.freeze({ value: "number", from: "string", to: "string" }) }),
  }),
  Object.freeze({
    name: "currency.convert",
    risk: TOOL_RISK.READ,
    description: "Convert currencies using a live public exchange-rate source. Input uses ISO 4217 codes such as USD, EGP, EUR.",
    schema: Object.freeze({ required: Object.freeze(["amount", "from", "to"]), properties: Object.freeze({ amount: "number", from: "string", to: "string" }) }),
  }),
]);

/** @type {Map<string, any>} */
const BUILTIN_TOOL_MAP = new Map(BUILTIN_TOOLS.map((tool) => [tool.name, tool]));
'''
if object_kinds not in source:
    raise SystemExit("object kinds anchor missing")
source = source.replace(object_kinds, tool_registry, 1)

source = source.replace('architecture: "semantic-conversation-workspace",\n          semantic_routing: true,', 'architecture: "agent-os-semantic-workspace",\n          semantic_routing: true,', 1)
source = source.replace('models: AI_MODELS.map((x) => x.id),\n        });', 'models: AI_MODELS.map((x) => x.id),\n          tools: BUILTIN_TOOLS.map((x) => x.name),\n        });', 1)
source = source.replace(
    '"Allowed actions: object.create, object.patch, object.archive, focus.set, focus.clear, reminder.set, reminder.cancel, memory.upsert, memory.forget.",',
    '"Allowed actions: object.create, object.patch, object.archive, focus.set, focus.clear, reminder.set, reminder.cancel, memory.upsert, memory.forget, tool.call.",',
    1,
)
source = source.replace(
    '"Memory upsert args contain subject, predicate, value, and optional confidence, sensitivity, expires_at.",',
    '"Memory upsert args contain subject, predicate, value, and optional confidence, sensitivity, expires_at.",\n'
    '    "For live/current external facts, calculations, conversions, or real clock time, use tool.call instead of guessing. tool.call args are {name,input}; name MUST be one of the declared Built-in Tools and input MUST follow that tool schema.",\n'
    '    "Read-only tool calls are observations, not durable mutations, so use effect answer unless the same plan also contains a real state mutation.",\n'
    '    "Built-in Tools JSON follows:",\n'
    '    JSON.stringify(BUILTIN_TOOLS),',
    1,
)

memory_validator = '    if (type === "memory.upsert") {\n'
tool_validator = '''    if (type === "tool.call") {\n      const name = compactText(args.name, 100);\n      if (!BUILTIN_TOOL_MAP.has(name)) throw new SandPlanError("TOOL_UNAVAILABLE", `Tool not available: ${name}`);\n      const input = args.input && typeof args.input === "object" && !Array.isArray(args.input) ? sanitizeJsonValue(args.input, 4) : {};\n      validateBuiltinToolInput(name, input);\n      return { type, args: { name, input } };\n    }\n\n'''
if memory_validator not in source:
    raise SystemExit("memory validator anchor missing")
source = source.replace(memory_validator, tool_validator + memory_validator, 1)

memory_executor = '  if (action.type === "memory.upsert") {\n'
tool_executor = '''  if (action.type === "tool.call") {\n    const result = await executeBuiltinTool(action.args.name, action.args.input ?? {});\n    if (!result || result.ok !== true) throw new Error(`Tool verification failed: ${action.args.name}`);\n    return { ok: true, tool_name: action.args.name, tool_result: result, message: compactText(result.message, AI_MAX_REPLY_CHARS) };\n  }\n\n'''
if memory_executor not in source:
    raise SystemExit("memory executor anchor missing")
source = source.replace(memory_executor, tool_executor + memory_executor, 1)

old_reply = '''function buildVerifiedReply(plan, execution) {\n  if (plan.clarification) return plan.clarification.question;\n  if (!execution.ok) return "حصلت مشكلة وأنا بنفذ آخر خطوة، فمش هأكدلك إن التعديل تم. حاول تاني بعد شوية.";\n  const reply = compactText(plan.reply, AI_MAX_REPLY_CHARS);\n  return reply || "تمام، اتعملت ✅";\n}\n'''
new_reply = '''function buildVerifiedReply(plan, execution) {\n  if (plan.clarification) return plan.clarification.question;\n  if (!execution.ok) return "حصلت مشكلة وأنا بنفذ آخر خطوة، فمش هأكدلك إن التعديل تم. حاول تاني بعد شوية.";\n  const toolMessages = (execution.steps ?? [])\n    .filter((step) => step?.tool_name && step?.tool_result?.ok === true)\n    .map((step) => compactText(step.message || step.tool_result?.message, AI_MAX_REPLY_CHARS))\n    .filter(Boolean);\n  if (toolMessages.length) return compactText(toolMessages.join("\\n"), AI_MAX_REPLY_CHARS);\n  const reply = compactText(plan.reply, AI_MAX_REPLY_CHARS);\n  return reply || "تمام، اتعملت ✅";\n}\n'''
if old_reply not in source:
    raise SystemExit("reply anchor missing")
source = source.replace(old_reply, new_reply, 1)

source = source.replace('architecture: "semantic-conversation-workspace",\n      semantic_routing: true,', 'architecture: "agent-os-semantic-workspace",\n      semantic_routing: true,', 1)
source = source.replace('models: AI_MODELS.map((x) => x.id),\n      bindings,', 'models: AI_MODELS.map((x) => x.id),\n      tools: BUILTIN_TOOLS.map((x) => x.name),\n      bindings,', 1)

self_return = '  return json({ ok: tests.every((x) => x.ok), service: APP_NAME, version: APP_VERSION, tests });\n}\n'
self_tools = '''  try {\n    const calc = await executeBuiltinTool("calculator.evaluate", { expression: "25*18+7" });\n    push("tool_calculator", calc.ok === true && calc.result === 457, calc);\n    const unit = await executeBuiltinTool("unit.convert", { value: 1, from: "km", to: "m" });\n    push("tool_unit_conversion", unit.ok === true && Math.abs(Number(unit.result) - 1000) < 1e-9, unit);\n    const clock = await executeBuiltinTool("datetime.now", { timezone: TZ });\n    push("tool_datetime", clock.ok === true && clock.timezone === TZ && Boolean(clock.local), clock);\n  } catch (error) {\n    push("builtin_tool_contract", false, safeError(error));\n  }\n\n'''
if self_return not in source:
    raise SystemExit("selftest return anchor missing")
source = source.replace(self_return, self_tools + self_return, 1)

tool_code = r'''function validateBuiltinToolInput(name, input) {
  const tool = BUILTIN_TOOL_MAP.get(name);
  if (!tool) throw new SandPlanError("TOOL_UNAVAILABLE", `Tool not available: ${name}`);
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  for (const key of tool.schema.required ?? []) {
    if (!Object.hasOwn(value, key) || value[key] === null || value[key] === "") {
      throw new SandPlanError("TOOL_ARG_REQUIRED", `Tool ${name} requires ${key}`);
    }
  }
  for (const [key, expected] of Object.entries(tool.schema.properties ?? {})) {
    if (!Object.hasOwn(value, key) || value[key] === null) continue;
    if (expected === "number" && !Number.isFinite(Number(value[key]))) throw new SandPlanError("TOOL_ARG_TYPE", `Tool ${name} expects numeric ${key}`);
    if (expected === "string" && typeof value[key] !== "string") throw new SandPlanError("TOOL_ARG_TYPE", `Tool ${name} expects string ${key}`);
  }
}

async function fetchFixedJson(url, allowedHost, timeoutMs = 8000) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== allowedHost) throw new Error("Unsafe fixed tool URL");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(u.toString(), { headers: { accept: "application/json" }, redirect: "manual", signal: controller.signal });
    if (response.status >= 300 && response.status < 400) throw new SandHttpError("Tool redirect blocked", response.status);
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new SandHttpError(`Tool HTTP ${response.status}`, response.status);
    if (!data || typeof data !== "object") throw new Error("Tool returned invalid JSON");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function weatherCodeArabic(code) {
  const n = Number(code);
  if (n === 0) return "صافي";
  if ([1, 2].includes(n)) return "غائم جزئيًا";
  if (n === 3) return "غائم";
  if ([45, 48].includes(n)) return "شبورة";
  if ([51, 53, 55, 56, 57].includes(n)) return "رذاذ";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(n)) return "مطر";
  if ([71, 73, 75, 77, 85, 86].includes(n)) return "ثلج";
  if ([95, 96, 99].includes(n)) return "عاصفة رعدية";
  return "حالة جوية متغيرة";
}

async function toolWeatherLookup(input) {
  const requested = compactText(input.location, 160);
  let latitude = Number(input.latitude);
  let longitude = Number(input.longitude);
  let place = null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    if (!requested) throw new Error("لازم تحدد مكان علشان أجيب الطقس");
    const geo = await fetchFixedJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(requested)}&count=5&language=ar&format=json`, "geocoding-api.open-meteo.com", 7000);
    const candidates = Array.isArray(geo?.results) ? geo.results : [];
    if (!candidates.length) throw new Error(`ملقتش مكان واضح باسم ${requested}`);
    const top = candidates[0];
    latitude = Number(top.latitude);
    longitude = Number(top.longitude);
    place = { name: top.name ?? requested, country: top.country ?? null, admin1: top.admin1 ?? null, latitude, longitude, timezone: top.timezone ?? null };
  } else {
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error("إحداثيات غير صالحة");
    place = { name: requested || `${latitude},${longitude}`, latitude, longitude, timezone: null };
  }
  const days = clampInt(input.days, 1, 7, 3);
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(latitude))}&longitude=${encodeURIComponent(String(longitude))}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=${days}`;
  const data = await fetchFixedJson(forecastUrl, "api.open-meteo.com", 8000);
  const current = data?.current ?? {};
  const condition = weatherCodeArabic(current.weather_code);
  const temp = Number(current.temperature_2m);
  const feels = Number(current.apparent_temperature);
  const humidity = Number(current.relative_humidity_2m);
  const wind = Number(current.wind_speed_10m);
  const rain = Number(current.precipitation);
  const daily = data?.daily ?? {};
  const forecast = Array.isArray(daily.time) ? daily.time.map((date, i) => ({
    date,
    condition: weatherCodeArabic(daily.weather_code?.[i]),
    temp_max_c: daily.temperature_2m_max?.[i] ?? null,
    temp_min_c: daily.temperature_2m_min?.[i] ?? null,
    rain_probability_max: daily.precipitation_probability_max?.[i] ?? null,
  })) : [];
  const locationLabel = [place?.name, place?.admin1, place?.country].filter(Boolean).join("، ");
  const message = `الجو دلوقتي في ${locationLabel || requested}: ${condition}، الحرارة ${Number.isFinite(temp) ? temp : "؟"}°م${Number.isFinite(feels) ? ` والمحسوسة ${feels}°م` : ""}${Number.isFinite(humidity) ? `، الرطوبة ${humidity}%` : ""}${Number.isFinite(wind) ? `، والرياح ${wind} كم/س` : ""}${Number.isFinite(rain) && rain > 0 ? `، وهطول ${rain} مم` : ""}.`;
  return { ok: true, tool: "weather.lookup", location: place, timezone: data?.timezone ?? place?.timezone ?? null, current, forecast, message };
}

function timezoneParts(date, timeZone) {
  try {
    return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "long", hourCycle: "h23",
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  } catch {
    throw new Error(`منطقة زمنية غير صالحة: ${timeZone}`);
  }
}

function toolDatetimeNow(input) {
  const timezone = compactText(input.timezone, 80) || TZ;
  const parts = timezoneParts(new Date(), timezone);
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  return { ok: true, tool: "datetime.now", timezone, local, weekday: parts.weekday, utc: nowIso(), message: `دلوقتي في ${timezone}: ${parts.hour}:${parts.minute} — ${parts.year}-${parts.month}-${parts.day}.` };
}

function tokenizeMath(expression) {
  const source = String(expression ?? "").replace(/,/g, "").replace(/٪|%/g, "/100").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/\^/g, "**");
  if (source.length > 300 || /[^0-9+\-*/().\s*]/.test(source)) throw new Error("تعبير حسابي غير مدعوم");
  return source;
}

function safeMathEvaluate(expression) {
  const source = tokenizeMath(expression);
  const tokens = source.match(/\d+(?:\.\d+)?|\*\*|[()+\-*/]/g) ?? [];
  if (tokens.join("").replace(/\s/g, "") !== source.replace(/\s/g, "")) throw new Error("تعبير حسابي غير صالح");
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  function primary() {
    const token = take();
    if (token === undefined) throw new Error("نهاية حساب غير متوقعة");
    if (token === "(") { const value = add(); if (take() !== ")") throw new Error("قوس ناقص"); return value; }
    if (token === "+") return primary();
    if (token === "-") return -primary();
    const number = Number(token);
    if (!Number.isFinite(number)) throw new Error("رقم غير صالح");
    return number;
  }
  function power() { let value = primary(); while (peek() === "**") { take(); value = value ** power(); } return value; }
  function multiply() { let value = power(); while (peek() === "*" || peek() === "/") { const op = take(); const right = power(); if (op === "/") { if (right === 0) throw new Error("قسمة على صفر"); value /= right; } else value *= right; } return value; }
  function add() { let value = multiply(); while (peek() === "+" || peek() === "-") { const op = take(); const right = multiply(); value = op === "+" ? value + right : value - right; } return value; }
  const result = add();
  if (position !== tokens.length || !Number.isFinite(result)) throw new Error("حساب غير صالح");
  return result;
}

function toolCalculator(input) {
  const expression = compactText(input.expression, 300);
  if (!expression) throw new Error("لازم تحدد العملية الحسابية");
  const result = safeMathEvaluate(expression);
  return { ok: true, tool: "calculator.evaluate", expression, result, message: `الناتج: ${result}` };
}

const UNIT_FACTORS = Object.freeze({
  mm: ["length", 0.001], cm: ["length", 0.01], m: ["length", 1], km: ["length", 1000], in: ["length", 0.0254], ft: ["length", 0.3048], yd: ["length", 0.9144], mi: ["length", 1609.344],
  mg: ["mass", 0.000001], g: ["mass", 0.001], kg: ["mass", 1], oz: ["mass", 0.028349523125], lb: ["mass", 0.45359237],
  ml: ["volume", 0.001], l: ["volume", 1], tsp: ["volume", 0.00492892159375], tbsp: ["volume", 0.01478676478125], cup: ["volume", 0.2365882365], gal: ["volume", 3.785411784],
});

function normalizeUnit(unit) {
  const raw = compactText(unit, 30).toLowerCase().replaceAll(" ", "");
  const aliases = { meter: "m", meters: "m", metre: "m", metres: "m", kilometer: "km", kilometers: "km", kilometre: "km", kilometres: "km", gram: "g", grams: "g", kilogram: "kg", kilograms: "kg", liter: "l", liters: "l", litre: "l", litres: "l", c: "c", "°c": "c", f: "f", "°f": "f", k: "k", "°k": "k" };
  return aliases[raw] ?? raw;
}

function convertTemperature(value, from, to) {
  let celsius;
  if (from === "c") celsius = value;
  else if (from === "f") celsius = (value - 32) * 5 / 9;
  else if (from === "k") celsius = value - 273.15;
  else throw new Error(`وحدة حرارة غير مدعومة: ${from}`);
  if (to === "c") return celsius;
  if (to === "f") return celsius * 9 / 5 + 32;
  if (to === "k") return celsius + 273.15;
  throw new Error(`وحدة حرارة غير مدعومة: ${to}`);
}

function toolUnitConvert(input) {
  const value = Number(input.value);
  if (!Number.isFinite(value)) throw new Error("قيمة التحويل لازم تكون رقم");
  const from = normalizeUnit(input.from);
  const to = normalizeUnit(input.to);
  const temperatureUnits = new Set(["c", "f", "k"]);
  let result;
  if (temperatureUnits.has(from) || temperatureUnits.has(to)) {
    if (!temperatureUnits.has(from) || !temperatureUnits.has(to)) throw new Error("مينفعش نخلط وحدات الحرارة بوحدات تانية");
    result = convertTemperature(value, from, to);
  } else {
    const sourceUnit = UNIT_FACTORS[from];
    const targetUnit = UNIT_FACTORS[to];
    if (!sourceUnit || !targetUnit || sourceUnit[0] !== targetUnit[0]) throw new Error(`تحويل غير مدعوم من ${from} إلى ${to}`);
    result = value * sourceUnit[1] / targetUnit[1];
  }
  const rounded = Math.abs(result) >= 1000 ? Number(result.toFixed(6)) : Number(result.toPrecision(12));
  return { ok: true, tool: "unit.convert", value, from, to, result: rounded, message: `${value} ${from} = ${rounded} ${to}` };
}

async function toolCurrencyConvert(input) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("قيمة العملة غير صالحة");
  const from = compactText(input.from, 3).toUpperCase();
  const to = compactText(input.to, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw new Error("استخدم كود عملة من 3 حروف زي USD أو EGP");
  if (from === to) return { ok: true, tool: "currency.convert", amount, from, to, rate: 1, result: amount, message: `${amount} ${from} = ${amount} ${to}` };
  const data = await fetchFixedJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`, "open.er-api.com", 8000);
  if (String(data?.result ?? "") !== "success") throw new Error(`مصدر سعر الصرف رفض العملة ${from}`);
  const rate = Number(data?.rates?.[to]);
  if (!Number.isFinite(rate)) throw new Error(`سعر ${from}/${to} مش متاح من المصدر الحالي`);
  const result = amount * rate;
  const rounded = Number(result.toFixed(4));
  return { ok: true, tool: "currency.convert", amount, from, to, rate, result: rounded, updated_at_utc: data?.time_last_update_utc ?? null, message: `${amount} ${from} ≈ ${rounded} ${to} (سعر حي من آخر تحديث متاح).` };
}

async function executeBuiltinTool(name, input) {
  validateBuiltinToolInput(name, input);
  if (name === "weather.lookup") return toolWeatherLookup(input);
  if (name === "datetime.now") return toolDatetimeNow(input);
  if (name === "calculator.evaluate") return toolCalculator(input);
  if (name === "unit.convert") return toolUnitConvert(input);
  if (name === "currency.convert") return toolCurrencyConvert(input);
  throw new Error(`Unsupported built-in tool: ${name}`);
}

'''
reply_anchor = 'function buildVerifiedReply(plan, execution) {\n'
if reply_anchor not in source:
    raise SystemExit("tool insertion anchor missing")
source = source.replace(reply_anchor, tool_code + reply_anchor, 1)

OUT.write_text(source, encoding="utf-8")
agent_sha = hashlib.sha256(source.encode()).hexdigest()
print(f"SAND_AGENT_OS_V2_SOURCE_OK {agent_sha} {len(source.encode())} bytes")
