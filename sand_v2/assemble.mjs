import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const parts = [
  'part00.b64','part01.b64','part02.b64','part03.b64',
  'part04_00.b64','part04_01.b64','part04_02.b64','part04_03.b64','part04_04.b64',
  'part05_00.b64','part05_01.b64','part05_02.b64','part05_03.b64',
];
const b64 = parts.map((name) => readFileSync(new URL(`./source_chunks/${name}`, import.meta.url), 'utf8')).join('');
const source = gunzipSync(Buffer.from(b64, 'base64'));
const sha = createHash('sha256').update(source).digest('hex');
const expected = 'cbc0c411b4461e664f4bb622ea32d5f598967043def589c19071599378b8d634';
if (sha !== expected) throw new Error(`SAND Core V2 source SHA mismatch: ${sha}`);
writeFileSync('SAND_CORE_V2.js', source);
console.log(`SAND_CORE_V2_SOURCE_OK ${sha} ${source.length} bytes`);
