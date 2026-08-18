import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const parts = [
  'part00.js.txt','part01.js.txt','part02.js.txt','part03.js.txt',
  'part04.js.txt','part05.js.txt','part06.js.txt','part07.js.txt',
];
const source = Buffer.from(parts.map((name) =>
  readFileSync(new URL(`./source_parts/${name}`, import.meta.url), 'utf8')
).join(''), 'utf8');
const sha = createHash('sha256').update(source).digest('hex');
const expected = '3d274bba7f7de151842158d16185ef5358415da48c73da46fa7fb2155c729052';
if (sha !== expected) throw new Error(`SAND Core V2 source SHA mismatch: ${sha}`);
writeFileSync('SAND_CORE_V2.js', source);
console.log(`SAND_CORE_V2_SOURCE_OK ${sha} ${source.length} bytes`);
