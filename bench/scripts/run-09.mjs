// Lab 09 bandwidth bench (NEXTGEN P0). Reproduces the core cost table in
// bench/src/demos/09-bandwidth/README.md ("Measurement methodology" + Axis
// 1/3 findings) by driving window.__bench09 directly (config/march/chain/
// down/up — a plain synchronous+async API, not the __benchParams JSON hook).
//
// Matrix: scene x config(rc/sc) x marchScale x dispatchMode. dispatchMode is
// paired back-to-back (compute, fragment) per (scene, config, scale) cell so
// the pair shares thermal state — that ratio is the robust signal per the
// README caveat (absolutes drift +-15%).
//
// Run: node scripts/run-09.mjs [--quick] [--out <name>]

import { launchBrowser, openDemo, settle, minOfBursts, writeResults } from './lib/harness.mjs';

const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const outIdx = argv.indexOf('--out');
const outName = outIdx !== -1 ? argv[outIdx + 1] : 'lab09-bandwidth';

const SCENES = quick ? ['cornell'] : ['cornell', 'sponza'];
const CONFIGS = [
  { name: 'default', rc: 2, sc: 12 },
  { name: 'heavy', rc: 4, sc: 32 },
];
const SCALES = ['1', '0.5', '0.25'];
const MODES = ['compute', 'fragment']; // axis 3; 'shared' (axis 2) is out of scope for this table

const burstOpts = quick ? { bursts: 1, iters: 10 } : { bursts: 3, iters: 40 };

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const rows = [];

for (const scene of SCENES) {
  await openDemo(page, { demo: '09', scene });
  await settle(2000); // pipeline warm-up

  for (const cfg of CONFIGS) {
    for (const scale of SCALES) {
      // mode is the paired axis — measured back-to-back at fixed scene/config/scale.
      for (const mode of MODES) {
        const sizes = await page.evaluate(
          (c) => window.__bench09.config(c),
          { scale, mode, rc: cfg.rc, sc: cfg.sc },
        );
        await settle(200); // let the resize (applyScale/ensureTexture) land before fencing

        const march = await minOfBursts(
          (n) => page.evaluate((iters) => window.__bench09.march(iters), n),
          burstOpts,
        );
        await settle(100);
        const chain = await minOfBursts(
          (n) => page.evaluate((iters) => window.__bench09.chain(iters), n),
          burstOpts,
        );
        await settle(100);
        const down = await minOfBursts(
          (n) => page.evaluate((iters) => window.__bench09.down(iters), n),
          burstOpts,
        );
        // upsample only runs in the real pipeline when the march is sub-full-res.
        let up = null;
        if (scale !== '1') {
          await settle(100);
          up = await minOfBursts(
            (n) => page.evaluate((iters) => window.__bench09.up(iters), n),
            burstOpts,
          );
        }

        const row = {
          scene,
          config: cfg.name,
          rc: cfg.rc,
          sc: cfg.sc,
          marchScale: scale,
          dispatchMode: mode,
          marchW: sizes.marchW,
          marchH: sizes.marchH,
          march_ms: march,
          chain_ms: chain,
          down_ms: down,
          up_ms: up,
        };
        rows.push(row);
        const upStr = up !== null ? `, up ${up.toFixed(3)}ms` : '';
        console.log(
          `[09] ${scene}/${cfg.name} rc${cfg.rc}sc${cfg.sc} scale=${scale} ${mode} -> ` +
            `march ${march.toFixed(3)}ms, chain ${chain.toFixed(3)}ms, down ${down.toFixed(3)}ms${upStr}`,
        );
      }
    }
  }
}

await browser.close();

const meta = {
  viewport: '1280x800',
  bursts: burstOpts.bursts,
  itersPerBurst: burstOpts.iters,
  ...(quick ? { note: 'quick smoke run — not a recorded number' } : {}),
};
const { jsonPath, mdPath } = writeResults(outName, rows, meta);
console.log(`wrote ${jsonPath}`);
console.log(`wrote ${mdPath}`);
