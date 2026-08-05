# ssgiDev

> **⚠️ Debug / test repository.** This is a research and experimentation workbench, not a library or production code. Demos are numbered experiments in various states of working, broken, and abandoned. Expect rough edges, dead ends, and verbose logs — that's the point of the repo.

Screen-space global illumination (SSGI) research for **three.js WebGPU**. This repo is where rendering approaches get prototyped, benchmarked, and torn apart before anything ships elsewhere.

## What's in here

- **[bench/](bench/)** — the test bench: numbered demos exploring GI sampling, temporal accumulation, and denoising strategies (e.g. Demo 19 is the current "v1 ship stack" candidate: oneOverN accumulation + spatial denoise).
- **[research/](research/)** — notes, references, and background material.
- **[publication/](publication/)** — write-ups and material being prepared for sharing.
- Root `*.md` files — experiment logs, specs, roadmaps, and session summaries. [EXPERIMENTS.md](EXPERIMENTS.md) and [WORKLOG.md](WORKLOG.md) are the best entry points for what's been tried and why.

## Running the bench

```sh
pnpm install
pnpm assets   # fetch demo assets (not checked in)
pnpm dev
```

Requires a browser with WebGPU support.

## Status

Actively evolving. Results documented in the experiment logs are candidates until they've passed a human visual review — metrics alone don't count as "solved" here.
