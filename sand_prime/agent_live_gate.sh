#!/usr/bin/env bash
set -euo pipefail

: "${DB:?DB required}"
: "${CFG:?CFG required}"
: "${URL:?URL required}"
: "${W:?W required}"
: "${CHAT:?CHAT required}"

sql_json() {
  local sql="$1" out="$2"
  npx wrangler d1 execute "$DB" --remote --config "$CFG" --command "$sql" --json > "$out"
}

scalar() {
  local file="$1" field="$2"
  FILE="$file" FIELD="$field" node - <<'NODE'
const fs=require('fs');
const x=JSON.parse(fs.readFileSync(process.env.FILE,'utf8'));
const row=(x?.[0]?.results||[])[0]||{};
const v=row[process.env.FIELD];
process.stdout.write(v===undefined||v===null?'':String(v));
NODE
}

send_update() {
  local id="$1" text="$2"
  ID="$id" TEXT="$text" CHAT_ID="$CHAT" node - <<'NODE' > /tmp/sand-update.json
const id=Number(process.env.ID), chat=Number(process.env.CHAT_ID), text=process.env.TEXT;
process.stdout.write(JSON.stringify({update_id:id,message:{message_id:id,date:Math.floor(Date.now()/1000),chat:{id:chat,type:'private'},from:{id:chat,is_bot:false,first_name:'PrimeGate'},text}}));
NODE
  local code
  code=$(curl -sS -o /tmp/accepted.json -w '%{http_code}' -X POST -H 'content-type: application/json' -H "X-Telegram-Bot-Api-Secret-Token: $W" --data-binary @/tmp/sand-update.json "$URL/telegram" || true)
  if [[ "$code" != "200" ]]; then
    echo "WEBHOOK_ACCEPT_FAIL id=$id http=$code" >&2
    cat /tmp/accepted.json >&2 || true
    sql_json "SELECT key,value FROM sand_core_meta WHERE key='schema_version';SELECT update_id,status,last_error FROM sand_core_inbox WHERE chat_id='$CHAT' ORDER BY update_id;SELECT chat_id,owner,lease_until,updated_at FROM sand_core_chat_leases WHERE chat_id='$CHAT';SELECT chat_id,settle_until_ms,last_seen_update_id,updated_at FROM sand_core_chat_ingress WHERE chat_id='$CHAT';" /tmp/webhook-fail-state.json || true
    cat /tmp/webhook-fail-state.json >&2 || true
    return 1
  fi
  wait_update "$id"
}

wait_update() {
  local id="$1"
  for i in {1..45}; do
    sql_json "SELECT status,last_error FROM sand_core_inbox WHERE update_id=$id LIMIT 1;" /tmp/state.json
    local state err
    state=$(scalar /tmp/state.json status)
    err=$(scalar /tmp/state.json last_error)
    if [[ "$state" == "done" ]]; then return 0; fi
    if [[ "$state" == "failed" ]]; then echo "UPDATE_FAILED id=$id error=$err" >&2; cat /tmp/state.json >&2; return 1; fi
    if (( i % 6 == 0 )); then
      CHAT_BODY="$CHAT" node -e 'process.stdout.write(JSON.stringify({chat_id:process.env.CHAT_BODY}))' >/tmp/drain.json
      curl -sS -X POST -H 'content-type: application/json' -H "X-Sand-Internal: $W" --data-binary @/tmp/drain.json "$URL/internal/drain" >/dev/null || true
    fi
    sleep 2
  done
  echo "Timed out waiting for update $id" >&2
  cat /tmp/state.json >&2 || true
  return 1
}

assert_js() {
  local file="$1" expr="$2" label="$3"
  FILE="$file" EXPR="$expr" LABEL="$label" node - <<'NODE'
const fs=require('fs');
const x=JSON.parse(fs.readFileSync(process.env.FILE,'utf8'));
const sets=x.map(r=>r.results||[]);
let ok=false;
try { ok=Function('sets',`return (${process.env.EXPR})`)(sets); } catch(e) { console.error(e); }
if(!ok){console.error('ASSERT_FAIL:',process.env.LABEL);console.error(JSON.stringify(sets,null,2));process.exit(1)}
console.log('PASS:',process.env.LABEL);
NODE
}

BASE=$((1500000000 + GITHUB_RUN_NUMBER * 100))
MEM1=$((BASE+1)); MEM2=$((BASE+2)); REM1=$((BASE+3)); REM2=$((BASE+4)); MULTI=$((BASE+5)); WEATHER=$((BASE+6)); CONTACT=$((BASE+7)); SEND=$((BASE+8))

echo '===== Clean isolated chat state ====='
CLEAN="DELETE FROM sand_prime_operation_steps WHERE operation_id IN (SELECT id FROM sand_prime_operations WHERE chat_id='$CHAT');DELETE FROM sand_prime_list_items WHERE chat_id='$CHAT';DELETE FROM sand_prime_confirmations WHERE chat_id='$CHAT';DELETE FROM sand_prime_audit WHERE chat_id='$CHAT';DELETE FROM sand_prime_outbox WHERE chat_id='$CHAT';DELETE FROM sand_prime_forge_requests WHERE chat_id='$CHAT';DELETE FROM sand_prime_automations WHERE chat_id='$CHAT';DELETE FROM sand_prime_contacts WHERE chat_id='$CHAT';DELETE FROM sand_prime_calendar_events WHERE chat_id='$CHAT';DELETE FROM sand_prime_notes WHERE chat_id='$CHAT';DELETE FROM sand_prime_lists WHERE chat_id='$CHAT';DELETE FROM sand_prime_tasks WHERE chat_id='$CHAT';DELETE FROM sand_prime_reminders WHERE chat_id='$CHAT';DELETE FROM sand_prime_chat_state WHERE chat_id='$CHAT';DELETE FROM sand_prime_entities WHERE chat_id='$CHAT';DELETE FROM sand_prime_memories WHERE chat_id='$CHAT';DELETE FROM sand_prime_operations WHERE chat_id='$CHAT';DELETE FROM sand_prime_decisions WHERE chat_id='$CHAT';DELETE FROM sand_ai_calls WHERE chat_id='$CHAT';DELETE FROM sand_ai_messages WHERE chat_id='$CHAT';DELETE FROM sand_core_chat_leases WHERE chat_id='$CHAT';DELETE FROM sand_core_chat_ingress WHERE chat_id='$CHAT';DELETE FROM sand_core_inbox WHERE chat_id='$CHAT';"
sql_json "$CLEAN" /tmp/clean.json

echo '===== Semantic memory ====='
send_update "$MEM1" 'افتكر إن اسم مراتي مرام'
sql_json "SELECT COUNT(*) n FROM sand_prime_memories WHERE chat_id='$CHAT' AND active=1 AND value LIKE '%مرام%';" /tmp/memory.json
assert_js /tmp/memory.json "Number(sets[0]?.[0]?.n||0)>=1" 'natural Egyptian memory write persisted'

send_update "$MEM2" 'اسم مراتي إيه؟'
sql_json "SELECT content FROM sand_ai_messages WHERE chat_id='$CHAT' AND update_id=$MEM2 AND role='assistant' LIMIT 1;" /tmp/recall.json
assert_js /tmp/recall.json "String(sets[0]?.[0]?.content||'').includes('مرام')" 'memory recalled without re-explaining context'

echo '===== Indirect reminder + contextual follow-up ====='
send_update "$REM1" 'يوم 20 سبتمبر 2026 الساعة 6 المغرب عندي دكتور ومش عاوز أنسى، نبهني قبلها بساعة'
sql_json "SELECT id,title,due_at_utc,status FROM sand_prime_reminders WHERE chat_id='$CHAT' AND status='pending';" /tmp/rem1.json
assert_js /tmp/rem1.json "sets[0].length===1 && String(sets[0][0].due_at_utc).startsWith('2026-09-20T14:00')" 'indirect reminder intent + one-hour prealert semantics'

send_update "$REM2" 'خليه ٥ ونص بدل ٥'
sql_json "SELECT id,title,due_at_utc,status FROM sand_prime_reminders WHERE chat_id='$CHAT' AND status='pending';" /tmp/rem2.json
assert_js /tmp/rem2.json "sets[0].length===1 && String(sets[0][0].due_at_utc).startsWith('2026-09-20T14:30')" 'contextual pronoun updated same reminder, no duplicate'

echo '===== Multi-step secretary task ====='
send_update "$MULTI" 'جهزلي قائمة اسمها سفر وحط فيها جواز السفر وشاحن الموبايل، وكمان ضيفلي مهمة أراجع الحجز'
sql_json "SELECT (SELECT COUNT(*) FROM sand_prime_lists WHERE chat_id='$CHAT' AND name='سفر') lists_n,(SELECT COUNT(*) FROM sand_prime_list_items i JOIN sand_prime_lists l ON l.id=i.list_id WHERE l.chat_id='$CHAT' AND l.name='سفر') items_n,(SELECT COUNT(*) FROM sand_prime_tasks WHERE chat_id='$CHAT' AND title LIKE '%حجز%' AND status='open') tasks_n,(SELECT COUNT(*) FROM sand_prime_operation_steps s JOIN sand_prime_operations o ON o.id=s.operation_id WHERE o.source_update_id=$MULTI AND s.status='succeeded') steps_n,(SELECT status FROM sand_prime_operations WHERE source_update_id=$MULTI LIMIT 1) op_status;" /tmp/multi.json
assert_js /tmp/multi.json "Number(sets[0]?.[0]?.lists_n||0)===1 && Number(sets[0]?.[0]?.items_n||0)>=2 && Number(sets[0]?.[0]?.tasks_n||0)>=1 && Number(sets[0]?.[0]?.steps_n||0)>=2 && String(sets[0]?.[0]?.op_status)==='succeeded'" 'multi-step plan executed and verified across tools'

BEFORE=$(node -e "const x=require('/tmp/multi.json');const r=x[0].results[0];process.stdout.write([r.lists_n,r.items_n,r.tasks_n,r.steps_n].join(':'))")
send_update "$MULTI" 'جهزلي قائمة اسمها سفر وحط فيها جواز السفر وشاحن الموبايل، وكمان ضيفلي مهمة أراجع الحجز'
sql_json "SELECT (SELECT COUNT(*) FROM sand_prime_lists WHERE chat_id='$CHAT' AND name='سفر') lists_n,(SELECT COUNT(*) FROM sand_prime_list_items i JOIN sand_prime_lists l ON l.id=i.list_id WHERE l.chat_id='$CHAT' AND l.name='سفر') items_n,(SELECT COUNT(*) FROM sand_prime_tasks WHERE chat_id='$CHAT' AND title LIKE '%حجز%') tasks_n,(SELECT COUNT(*) FROM sand_prime_operation_steps s JOIN sand_prime_operations o ON o.id=s.operation_id WHERE o.source_update_id=$MULTI) steps_n;" /tmp/dup.json
AFTER=$(node -e "const x=require('/tmp/dup.json');const r=x[0].results[0];process.stdout.write([r.lists_n,r.items_n,r.tasks_n,r.steps_n].join(':'))")
[[ "$BEFORE" == "$AFTER" ]] || { echo "IDEMPOTENCY_FAIL before=$BEFORE after=$AFTER" >&2; exit 1; }
echo 'PASS: duplicate Telegram update caused no duplicate side effects'

echo '===== Live weather tool, not model guessing ====='
send_update "$WEATHER" 'الجو في اسكندرية عامل إيه دلوقتي؟ متخمنش، هاته حي'
sql_json "SELECT COUNT(*) n FROM sand_prime_operation_steps s JOIN sand_prime_operations o ON o.id=s.operation_id WHERE o.source_update_id=$WEATHER AND s.tool_name='weather.lookup' AND s.status='succeeded';" /tmp/weather.json
assert_js /tmp/weather.json "Number(sets[0]?.[0]?.n||0)>=1" 'live weather capability was actually executed'

echo '===== External side-effect permission gate ====='
send_update "$CONTACT" 'سجل عندك محمود زميلي وتليجرام آي دي بتاعه 123456789'
sql_json "SELECT COUNT(*) n FROM sand_prime_contacts WHERE chat_id='$CHAT' AND name LIKE '%محمود%' AND telegram_chat_id='123456789';" /tmp/contact.json
assert_js /tmp/contact.json "Number(sets[0]?.[0]?.n||0)>=1" 'contact saved semantically'

send_update "$SEND" 'ابعت لمحمود على تيليجرام وقوله الاجتماع اتأجل لبكرة'
sql_json "SELECT o.id,o.status,(SELECT COUNT(*) FROM sand_prime_confirmations c WHERE c.operation_id=o.id AND c.status='pending') pending_confirmations,(SELECT COUNT(*) FROM sand_prime_outbox b WHERE b.idempotency_key LIKE ('tool:'||o.id||':%')) tool_outbox FROM sand_prime_operations o WHERE o.source_update_id=$SEND LIMIT 1;" /tmp/permission.json
assert_js /tmp/permission.json "String(sets[0]?.[0]?.status)==='awaiting_confirmation' && Number(sets[0]?.[0]?.pending_confirmations||0)===1 && Number(sets[0]?.[0]?.tool_outbox||0)===0" 'external Telegram send blocked until explicit confirmation'

echo 'SAND_PRIME_SEMANTIC_AGENT_LIVE_GATE_OK'
