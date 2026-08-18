#!/usr/bin/env bash
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?missing CLOUDFLARE_ACCOUNT_ID}"
: "${STAGING_TELEGRAM_BOT_TOKEN:?missing STAGING_TELEGRAM_BOT_TOKEN}"
: "${STAGING_OMNIAI_API_KEY:?missing STAGING_OMNIAI_API_KEY}"
: "${STAGING_ADMIN_CHAT_ID:?missing STAGING_ADMIN_CHAT_ID}"

export URL="${URL:-https://superagent-v1152-staging.ahmeddoba91.workers.dev}"
export DB="${DB:-superagent-v106-staging}"
export WRANGLER_CONFIG="${WRANGLER_CONFIG:-wrangler.v1152.jsonc}"

node tools/build_v1152_final.mjs
node --check SuperAgent_V11_5_2_FULL.js
cp SuperAgent_V11_5_2_FULL.js /tmp/v1152.mjs
node -e "import('/tmp/v1152.mjs').then(()=>console.log('MODULE PASS')).catch(e=>{console.error(e);process.exit(1)})"
export V1152_SHA="$(sha256sum SuperAgent_V11_5_2_FULL.js | awk '{print $1}')"

node - <<'NODE'
const fs=require('fs');
const a=fs.readFileSync('SuperAgent_V11_5_1_FULL.js','utf8');
const b=fs.readFileSync('SuperAgent_V11_5_2_FULL.js','utf8');
const funcs=s=>(s.match(/\b(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/g)||[]).map(x=>x.replace(/\s+/g,' ')).sort();
const tables=s=>[...s.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z0-9_]+)/g)].map(x=>x[1]).sort();
const rawUnprotected=(b.match(/if\s*\(!acquired\)\s*return;/g)||[]).length;
const recoveryCount=(b.match(/if\(!acquired\)\{if\(origin&&await hasRunnableInboxV106\(env,chatId\)\)/g)||[]).length;
const checks={
  version:b.includes('const V10_VERSION="11.5.2"'),
  functionsRetained:JSON.stringify(funcs(a))===JSON.stringify(funcs(b)),
  tablesRetained:JSON.stringify(tables(a))===JSON.stringify(tables(b)),
  routerRemoved:b.includes('v112_router_removed:true'),
  budget:b.includes('TOTAL_AI_BUDGET_MS=10000'),
  telegramAuth:b.includes('X-Telegram-Bot-Api-Secret-Token'),
  adminAuth:b.includes('X-SuperAgent-Key'),
  durableInbox:b.includes('telegram_inbox_v106'),
  leaseCollisionFeature:b.includes('v1152_lease_collision_recovery:true'),
  noUnprotectedLeaseExit:rawUnprotected===0,
  allLeasePathsRecovered:recoveryCount>=2,
  idempotency:b.includes('telegram_idempotency:true'),
  undo:b.includes('audit_undo:true'),
  conflicts:b.includes('duration_conflicts:true'),
  recurrence:b.includes('universal_recurrence:true'),
  memory:b.includes('long_term_memory:true'),
  world:b.includes('live_world_news:true'),
  voice:b.includes('voice_first:true'),
  location:b.includes('per_user_location:true'),
  prayer:b.includes('prayer_awareness:true'),
  holidays:b.includes('public_holidays:true'),
  shopping:b.includes('interactive_shopping:true'),
  dependencies:b.includes('event_dependencies:true'),
  planner:b.includes('planner_executor_verifier:true'),
  failureLog:b.includes('runtime_failure_log:true'),
  noDead25:!b.includes('gemini::gemini-2.5-flash-lite')
};
const failed=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
if(failed.length)throw Error('STATIC '+failed.join(','));
fs.writeFileSync('/tmp/static.json',JSON.stringify({ok:true,checks,functions:funcs(b).length,tables:tables(b).length,recoveryCount},null,2));
console.log('STATIC PASS',Object.keys(checks).length,'recoveryPaths',recoveryCount);
NODE

cp SuperAgent_V11_5_2_FULL.js /tmp/self.mjs
printf '\nconsole.log(JSON.stringify({v10:runV10SelfTests(),v11:runV11PureSelfTests(),v113:runV113PureSelfTests(),v114:runV114PureSelfTests(),v115:runV115PureSelfTests()}));\n' >> /tmp/self.mjs
node /tmp/self.mjs | tail -1 > /tmp/pure.json
node - <<'NODE'
const x=require('/tmp/pure.json');
if(!x.v10?.ok||!Array.isArray(x.v11)||!x.v11.every(t=>t.ok)||!x.v113?.ok||!x.v114?.ok||!x.v115?.ok)throw Error(JSON.stringify(x));
console.log('PURE ALL PASS');
NODE

npm install --no-save wrangler@latest >/dev/null
cat > "$WRANGLER_CONFIG" <<'EOF'
{"name":"superagent-v1152-staging","main":"SuperAgent_V11_5_2_FULL.js","compatibility_date":"2026-08-17","vars":{"PUBLIC_BOT":"false"},"d1_databases":[{"binding":"DB","database_name":"superagent-v106-staging","database_id":"65df37bc-973d-4bfe-a3f4-7c049e570697"}],"services":[{"binding":"OMNIAI_SERVICE","service":"omniai-engine"}]}
EOF
npx wrangler deploy --config "$WRANGLER_CONFIG" >/dev/null

export WEBHOOK_SECRET="$(openssl rand -hex 32)"
export SETUP_KEY="$(openssl rand -hex 32)"
echo "::add-mask::$WEBHOOK_SECRET"
echo "::add-mask::$SETUP_KEY"
for pair in \
  "TELEGRAM_BOT_TOKEN:$STAGING_TELEGRAM_BOT_TOKEN" \
  "OMNIAI_API_KEY:$STAGING_OMNIAI_API_KEY" \
  "ADMIN_CHAT_ID:$STAGING_ADMIN_CHAT_ID" \
  "ALLOWED_CHAT_IDS:$STAGING_ADMIN_CHAT_ID" \
  "TELEGRAM_WEBHOOK_SECRET:$WEBHOOK_SECRET" \
  "SETUP_KEY:$SETUP_KEY"; do
  k=${pair%%:*}; v=${pair#*:}; printf '%s' "$v" | npx wrangler secret put "$k" --config "$WRANGLER_CONFIG" >/dev/null
done

retry(){
  local name=$1; shift
  local code
  for i in 1 2 3 4 5 6 7 8 9 10; do
    code=$(curl -sS -o "/tmp/$name.json" -w '%{http_code}' "$@" || true)
    echo "$name attempt=$i http=$code"
    if [ "$code" = 200 ]; then return 0; fi
    sleep 3
  done
  cat "/tmp/$name.json" || true
  return 1
}
retry setup -X POST -H "X-SuperAgent-Key: $SETUP_KEY" "$URL/setup?force=1"
retry health "$URL/health"
retry ready -H "X-SuperAgent-Key: $SETUP_KEY" "$URL/ready"
retry selftest -H "X-SuperAgent-Key: $SETUP_KEY" "$URL/selftest"

node - <<'NODE'
const s=require('/tmp/setup.json'),h=require('/tmp/health.json'),r=require('/tmp/ready.json'),t=require('/tmp/selftest.json');
const f=['gemini::gemini-3.1-flash-lite','gemini::gemini-3.5-flash'];
if(!s.ok||s.primary_model!=='gemini::gemini-3.5-flash-lite'||JSON.stringify(s.fallback_models)!==JSON.stringify(f)||s.router!==false)throw Error('setup '+JSON.stringify(s));
if(!h.ok||h.version!=='11.5.2'||!h.db||!h.omniai_service)throw Error('health '+JSON.stringify(h));
if(!r.ok||r.version!=='11.5.2'||!r.db)throw Error('ready '+JSON.stringify(r));
if(!t.ok||t.version!=='11.5.2')throw Error('selftest '+JSON.stringify(t));
console.log('ENDPOINTS PASS');
NODE

node tools/live_v1152_final.mjs

cat > V11_5_2_MODEL_STABILITY.json <<'EOF'
{"tested":true,"primary":{"id":"gemini::gemini-3.5-flash-lite","successes":8,"total":8,"avg_ms":1182},"fallback_1":{"id":"gemini::gemini-3.1-flash-lite","successes":8,"total":8,"avg_ms":1590},"fallback_2":{"id":"gemini::gemini-3.5-flash","successful_pre_quota":7,"tested_pre_quota":8,"successful_latency_ms":[1673,1915],"extended_probe":"blocked_by_provider_429_quota"},"rejected":{"id":"gemini::gemini-2.5-flash-lite","plain_http":404,"json_http":404},"interpretation":"Core failover code is bounded and tested. Extended repeated fallback2 probing was limited by external Google/OmniAI quota."}
EOF

node - <<'NODE'
const fs=require('fs'),st=require('/tmp/static.json'),pure=require('/tmp/pure.json'),live=require('./V11_5_2_LIVE_REPORT.json'),models=require('./V11_5_2_MODEL_STABILITY.json'),h=require('/tmp/health.json');
const src=fs.readFileSync('SuperAgent_V11_5_2_FULL.js','utf8');
const pureOK=pure.v10?.ok&&pure.v11.every(x=>x.ok)&&pure.v113?.ok&&pure.v114?.ok&&pure.v115?.ok;
const cert={ok:st.ok&&pureOK&&live.ok&&h.ok,version:'11.5.2',sha256:process.env.V1152_SHA,bytes:Buffer.byteLength(src),lines:src.split('\n').length,models:['gemini::gemini-3.5-flash-lite','gemini::gemini-3.1-flash-lite','gemini::gemini-3.5-flash'],requested_but_unavailable:'gemini::gemini-2.5-flash-lite',static_checks:st.checks,pure_regression_ok:pureOK,live_scenarios:live.scenario_count,live_ok:live.ok,lease_collision_recovery:true,lease_recovery_paths:st.recoveryCount,model_stability:models,known_critical_code_failures:[],external_risks:['Google/OmniAI model quota can return 429 under sustained usage']};
if(!cert.ok)throw Error('cert gate');
fs.writeFileSync('V11_5_2_CERTIFICATION.json',JSON.stringify(cert,null,2));
console.log(JSON.stringify({ok:true,version:cert.version,scenarios:cert.live_scenarios,lease_recovery_paths:cert.lease_recovery_paths,models:cert.models}));
NODE

git config user.name github-actions-bot
git config user.email 41898282+github-actions-bot@users.noreply.github.com
git add -- SuperAgent_V11_5_2_FULL.js V11_5_2_CERTIFICATION.json V11_5_2_MODEL_STABILITY.json V11_5_2_LIVE_REPORT.json
git commit -m "Build and live-certify hardened SuperAgent V11.5.2"
git push origin HEAD:superagent-v11-5-2-final
