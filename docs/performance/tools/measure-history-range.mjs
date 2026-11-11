// Run from repository root: node docs/performance/tools/measure-history-range.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(resolve('bluemap-addon/package.json'));
const { build } = require('esbuild');
const dir = mkdtempSync(join(tmpdir(), 'history-range-'));
const baseline = process.argv[2] || '1fa0b72';
const probe = `
import { loadRangeEvents } from './loader.mjs';
let reads = 0;
const event = { point: { time: 0, player: 1, world: 0, x: 0, y: 0, z: 0, flags: 0 }, type: 'CUSTOM', payload: {} };
const before = performance.now();
let rejected = false;
try { await loadRangeEvents({ from: 0, to: 5000, concurrency: 3,
  chunkStarts: () => Array.from({ length: 5000 }, (_, i) => i),
  readChunk: async () => { reads++; return { events: Array(1000).fill(event) }; }
}); } catch (error) { if (!/Too many events/.test(error.message)) throw error; rejected = true; }
if (!rejected) throw Error('Browser event limit was not enforced');
console.log(JSON.stringify({ requests: reads, elapsedMs: performance.now() - before, maxRssKiB: process.resourceUsage().maxRSS }));
`;
try {
  for (const label of ['before', 'after']) {
    const output = join(dir, label);
    const { mkdirSync } = await import('node:fs');
    mkdirSync(output);
    if (label === 'before') {
      for (const name of ['history-loading.ts', 'range-events-loader.ts'])
        writeFileSync(join(output, name), execFileSync('git', ['show', `${baseline}:bluemap-addon/src/${name}`]));
    }
    await build({ entryPoints: [label === 'before' ? join(output, 'range-events-loader.ts') : resolve('bluemap-addon/src/range-events-loader.ts')], bundle: true, format: 'esm', platform: 'node', outfile: join(output, 'loader.mjs') });
    writeFileSync(join(output, 'probe.mjs'), probe);
    const result = spawnSync(process.execPath, [join(output, 'probe.mjs')], { encoding: 'utf8' });
    if (result.status !== 0) throw Error(result.stderr);
    console.log(label, result.stdout.trim());
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
