import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import crypto from 'node:crypto';

const dir = new URL('../source_parts/', import.meta.url);
const files = fs.readdirSync(dir).filter(x => x.startsWith('sanad125.part')).sort();
if (!files.length) throw new Error('Sanad V12.5 source parts are missing');
const b64 = files.map(f => fs.readFileSync(new URL(f, dir), 'utf8')).join('').trim();
const src = gunzipSync(Buffer.from(b64, 'base64'));
const sha = crypto.createHash('sha256').update(src).digest('hex');
const expected = '8afea4bbd5d3429feb3db537a0298462dbbf7b15950f207f66903ce8bfce5310';
if (sha !== expected) throw new Error(`source SHA mismatch: ${sha}`);
fs.writeFileSync(new URL('../Sanad_V12_5_FULL.js', import.meta.url), src);
console.log(JSON.stringify({ok:true,parts:files.length,bytes:src.length,sha256:sha}));
