import fs from 'node:fs';

const path = process.argv[2] || 'SAND.js';
let src = fs.readFileSync(path, 'utf8');

function replaceOnce(oldText, newText, label) {
  const first = src.indexOf(oldText);
  if (first < 0) throw new Error(`Missing transform anchor: ${label}`);
  if (src.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`Non-unique transform anchor: ${label}`);
  src = src.slice(0, first) + newText + src.slice(first + oldText.length);
}

replaceOnce(
  'const CORE_SCHEMA_VERSION = "3";',
  'const CORE_SCHEMA_VERSION = "5";',
  'core version',
);

replaceOnce(
`async function ensureCoreSchema(env) {
  requireBinding(env, "DB");
  const exists = await env.DB.prepare(\`SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1\`).bind(TABLES.coreMeta).first();
  if (!exists) await migrateCoreV1(env);
  const row = await env.DB.prepare(\`SELECT value FROM \${TABLES.coreMeta} WHERE key='schema_version' LIMIT 1\`).first();
  const current = String(row?.value ?? "0");
  if (current === CORE_SCHEMA_VERSION) return;
  if (current === "1") { await migrateCoreV2(env); await migrateCoreV3(env); }
  else if (current === "2") await migrateCoreV3(env);
  else if (current !== "3") throw new Error(\`Unsupported core schema version: \${current || "missing"}\`);
}`,
`async function ensureCoreSchema(env) {
  requireBinding(env, "DB");
  const exists = await env.DB.prepare(\`SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1\`).bind(TABLES.coreMeta).first();
  if (!exists) await migrateCoreV1(env);
  const row = await env.DB.prepare(\`SELECT value FROM \${TABLES.coreMeta} WHERE key='schema_version' LIMIT 1\`).first();
  const current = String(row?.value ?? "0");
  if (current === CORE_SCHEMA_VERSION) return;
  if (current === "1") { await migrateCoreV2(env); await migrateCoreV3(env); await migrateCoreV5(env); }
  else if (current === "2") { await migrateCoreV3(env); await migrateCoreV5(env); }
  else if (current === "3" || current === "4") await migrateCoreV5(env);
  else throw new Error(\`Unsupported core schema version: \${current || "missing"}\`);
  const verify = await env.DB.prepare(\`SELECT value FROM \${TABLES.coreMeta} WHERE key='schema_version' LIMIT 1\`).first();
  if (String(verify?.value ?? "") !== CORE_SCHEMA_VERSION) throw new Error("Core schema normalization verification failed");
}`,
  'ensureCoreSchema',
);

const v3 = `async function migrateCoreV3(env) {
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare(\`CREATE TABLE IF NOT EXISTS \${TABLES.chatIngress} (chat_id TEXT PRIMARY KEY,settle_until_ms INTEGER NOT NULL,last_seen_update_id INTEGER NOT NULL,updated_at TEXT NOT NULL)\`),
    env.DB.prepare(\`INSERT INTO \${TABLES.coreMeta}(key,value,updated_at) VALUES('schema_version','3',?) ON CONFLICT(key) DO UPDATE SET value='3',updated_at=excluded.updated_at\`).bind(at),
  ]);
}`;

const v5 = `${v3}
async function migrateCoreV5(env) {
  const at = nowIso();
  const leaseInfo = await env.DB.prepare(\`PRAGMA table_info(\${TABLES.chatLeases})\`).all();
  const leaseColumns = new Set((leaseInfo?.results ?? []).map((row) => String(row.name)));
  if (!leaseColumns.has("updated_at")) {
    if (!leaseColumns.has("acquired_at")) throw new Error("Unsupported chat lease schema: missing timestamp column");
    await env.DB.batch([
      env.DB.prepare(\`DROP TABLE IF EXISTS sand_core_chat_leases_v5_legacy\`),
      env.DB.prepare(\`ALTER TABLE \${TABLES.chatLeases} RENAME TO sand_core_chat_leases_v5_legacy\`),
      env.DB.prepare(\`CREATE TABLE \${TABLES.chatLeases} (chat_id TEXT PRIMARY KEY,owner TEXT NOT NULL,lease_until INTEGER NOT NULL,updated_at TEXT NOT NULL)\`),
      env.DB.prepare(\`INSERT INTO \${TABLES.chatLeases}(chat_id,owner,lease_until,updated_at) SELECT chat_id,owner,lease_until,acquired_at FROM sand_core_chat_leases_v5_legacy\`),
      env.DB.prepare(\`DROP TABLE sand_core_chat_leases_v5_legacy\`),
    ]);
  }

  const messageDef = await env.DB.prepare(\`SELECT sql FROM sqlite_master WHERE type='table' AND name=? LIMIT 1\`).bind(TABLES.messages).first();
  const messageSql = String(messageDef?.sql ?? "");
  if (!messageSql || !/[\"']system[\"']/.test(messageSql)) {
    await env.DB.batch([
      env.DB.prepare(\`DROP TABLE IF EXISTS sand_ai_messages_v5_legacy\`),
      env.DB.prepare(\`ALTER TABLE \${TABLES.messages} RENAME TO sand_ai_messages_v5_legacy\`),
      env.DB.prepare(\`CREATE TABLE \${TABLES.messages} (id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,update_id INTEGER NOT NULL,role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),content TEXT NOT NULL,model_id TEXT,created_at TEXT NOT NULL,UNIQUE(chat_id,update_id,role))\`),
      env.DB.prepare(\`INSERT INTO \${TABLES.messages}(id,chat_id,update_id,role,content,model_id,created_at) SELECT id,chat_id,update_id,role,content,model_id,created_at FROM sand_ai_messages_v5_legacy\`),
      env.DB.prepare(\`DROP TABLE sand_ai_messages_v5_legacy\`),
      env.DB.prepare(\`CREATE INDEX IF NOT EXISTS idx_sand_ai_messages_chat ON \${TABLES.messages}(chat_id,id DESC)\`),
    ]);
  }

  await env.DB.batch([
    env.DB.prepare(\`CREATE INDEX IF NOT EXISTS idx_sand_core_inbox_pending ON \${TABLES.inbox}(status,process_lease_until,update_id)\`),
    env.DB.prepare(\`CREATE INDEX IF NOT EXISTS idx_sand_core_inbox_chat ON \${TABLES.inbox}(chat_id,status,update_id)\`),
    env.DB.prepare(\`CREATE INDEX IF NOT EXISTS idx_sand_ai_messages_chat ON \${TABLES.messages}(chat_id,id DESC)\`),
    env.DB.prepare(\`CREATE INDEX IF NOT EXISTS idx_sand_ai_calls_update ON \${TABLES.aiCalls}(update_id,id)\`),
    env.DB.prepare(\`INSERT INTO \${TABLES.coreMeta}(key,value,updated_at) VALUES('schema_version','5',?) ON CONFLICT(key) DO UPDATE SET value='5',updated_at=excluded.updated_at\`).bind(at),
  ]);

  const normalizedLeaseInfo = await env.DB.prepare(\`PRAGMA table_info(\${TABLES.chatLeases})\`).all();
  const normalizedLeaseColumns = new Set((normalizedLeaseInfo?.results ?? []).map((row) => String(row.name)));
  if (!normalizedLeaseColumns.has("updated_at")) throw new Error("Core v5 lease normalization failed");
  const normalizedMessages = await env.DB.prepare(\`SELECT sql FROM sqlite_master WHERE type='table' AND name=? LIMIT 1\`).bind(TABLES.messages).first();
  if (!/[\"']system[\"']/.test(String(normalizedMessages?.sql ?? ""))) throw new Error("Core v5 message role normalization failed");
}`;

replaceOnce(v3, v5, 'migrateCoreV3');
fs.writeFileSync(path, src);
console.log('SAND_PRIME_CORE_SCHEMA_V5_TRANSFORM_OK');
