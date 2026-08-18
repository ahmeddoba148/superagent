from pathlib import Path
p=Path('.github/workflows/release-v11-5-2-final.yml')
s=p.read_text(encoding='utf-8')
old='''          curl -fsS "$URL/health" > /tmp/health.json
          node -e 'const x=require("/tmp/health.json");if(!x.ok||x.version!=="11.5.2"||!x.db||!x.omniai_service)throw Error(JSON.stringify(x))'
          curl -fsS -H "Authorization: Bearer $SETUP_KEY" "$URL/selftest" > /tmp/selfendpoint.json
          node -e 'const x=require("/tmp/selfendpoint.json");if(!x.ok||x.version!=="11.5.2"||!x.v10?.ok||!x.v11?.ok||!x.v113?.ok||!x.v114?.ok||!x.v115?.ok)throw Error(JSON.stringify(x))'
'''
new='''          endpoint_retry(){ name="$1"; shift; for i in 1 2 3 4 5 6 7 8; do code=$(curl -sS -o "/tmp/$name.json" -w '%{http_code}' "$@" || true); if [ "$code" = 200 ]; then return 0; fi; echo "$name propagation attempt $i HTTP=$code"; sleep 3; done; echo "$name final body:"; cat "/tmp/$name.json" || true; return 1; }
          endpoint_retry ready -H "X-SuperAgent-Key: $SETUP_KEY" "$URL/ready"
          endpoint_retry health "$URL/health"
          node -e 'const x=require("/tmp/health.json");if(!x.ok||x.version!=="11.5.2"||!x.db||!x.omniai_service)throw Error(JSON.stringify(x))'
          endpoint_retry selfendpoint -H "X-SuperAgent-Key: $SETUP_KEY" "$URL/selftest"
          node -e 'const x=require("/tmp/selfendpoint.json");if(!x.ok||x.version!=="11.5.2"||!x.v10?.ok||!x.v11?.ok||!x.v113?.ok||!x.v114?.ok||!x.v115?.ok)throw Error(JSON.stringify(x))'
'''
if old not in s:
    raise SystemExit('target block not found')
p.write_text(s.replace(old,new,1),encoding='utf-8')
print('patched release-v11-5-2-final.yml')
