# Shadertoy Capture Status

**All 14 shaders are captured in full, live from Shadertoy, as of 2026-07-17.** Shadertoy blocks headless/programmatic fetching (Cloudflare), but the pages load normally in a real Chrome session; the code was extracted from Shadertoy's own editor state (`gShaderToy`) via browser automation — every render pass, current revision, saved under `research/sources/shadertoy/<ID>/`.

Author handles: **TinyTexel = Mirko Salm**, **bjornornorn = Björn Ottosson**, **Mathis** (dsGBzW).

| ID | Name | Author | Published | Capture |
|---|---|---|---|---|
| XXGSDd | GT-VBAO | TinyTexel | 2024-07 | live 2026-07-17 |
| Xc3yzs | GT-VBAO (unidirectional) | TinyTexel | 2024-11 | live 2026-07-17 |
| lctBzH | GTAO+ | TinyTexel | 2024-11 | live 2026-07-17 |
| 4ctBRH | GTAO+ (unidirectional) | TinyTexel | 2024-11 | live 2026-07-17 |
| lfdBWn | GT-VBGI (diffuse) | TinyTexel | 2024-11 | live 2026-07-17 |
| 4cdfzf | GT-VBAO (uniformly weighted) | TinyTexel | 2024-12 | live 2026-07-17 |
| XcdBWf | GT-VBGI (diffuse) (unidir) | TinyTexel | 2024-12 | live 2026-07-17 |
| XfcBDl | GT-VBGI (uniformly weighted) | TinyTexel | 2024-12 | live 2026-07-17 |
| wcfGWB | GT-VBAO distant light sampling | bjornornorn | 2025-02 | live 2026-07-17 |
| 3clGWB | GT-VBAO thickness heuristic | bjornornorn | 2025-02 | live 2026-07-17 |
| wcBGRz | GT-VBAO Light&Occluder Heuristic | bjornornorn | 2025-02 | live 2026-07-17 |
| dsGBzW | Screen Space Horizon GI | Mathis | 2023-10-30 | live 2026-07-17 |
| wc2SzR | GT-VBAO [Distant Light Sampling] | TinyTexel | ~2025 | live 2026-07-17 |
| wcsXDN | Slice-Rel Dir Mapping [GT-VBAO] | TinyTexel | ~2025 | live 2026-07-17 |

## Provenance history

1. **First pass (archive recovery):** 11/14 recovered from the [GabeRundlett/shadertoy-api-shaders](https://github.com/GabeRundlett/shadertoy-api-shaders) API dump (snapshots 2024-07 → 2025-02); `dsGBzW`, `wc2SzR`, `wcsXDN` were missing.
2. **Second pass (live refresh):** all 14 captured live via Chrome. The 11 archive copies were replaced with live code and audited against the snapshots — see **[live-refresh-2026-07-17.md](live-refresh-2026-07-17.md)** for the exact diffs. Notable drift found: Salm rolled a `GetQuaternion` reference-direction fix (+z → −z, `#if 1` block) across 8 shaders after the archive snapshots; Ottosson's three were unchanged.

## Re-capture recipe (if ever needed again)

Live pages expose the full editor state at `gShaderToy.mEffect.mPasses[i]` (`.mDocs.getValue()` or `.mSource`) plus metadata at `gShaderToy.mInfo`. Chrome-automation note: returning shader source through the extension's JS-result channel trips its data-loss filter, so POST the JSON from the page to a localhost receiver instead (needs `Access-Control-Allow-Private-Network: true` on the preflight for Chrome's Private Network Access check).
