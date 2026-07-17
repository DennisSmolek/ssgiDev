# Sponza glTF Asset Comparison — M1 Test Scene

Research date: 2026-07-18. Web research only (GitHub API file trees + LFS pointer sizes + partial-byte glb header fetches to read the JSON chunk; no full asset downloads, no clones). Goal: pick ONE Sponza glTF for the SSGI test bench that loads in stock three.js r185 `GLTFLoader` with standard extensions only, prioritizing small download + fast parse over fidelity.

## TL;DR recommendation

**Fetch `toji/sponza-optimized`, variant `Sponza-KTX-Draco.glb` (9.7 MB, direct raw GitHub URL below).** It is the only candidate that is both small and 100% standard glTF (`KHR_draco_mesh_compression` + `KHR_texture_basisu`/KTX2 — both first-party three.js extensions, no custom runtime). If KTX2's ETC1S artifacting (see below) turns out to matter for the SSGI test bench, fall back to `Sponza-Draco.glb` (40.3 MB, raw JPG/PNG, still 100% standard). Do **not** use `ludicon/sponza-gltf`'s AVIF variants — they require a non-standard `EXT_texture_AVIF` extension and Castaño's own "Spark" GPU-side AVIF runtime, which stock `GLTFLoader` cannot handle.

Direct download URL (no LFS/clone needed, this repo has no LFS — plain blobs):
```
https://github.com/toji/sponza-optimized/raw/main/Sponza-KTX-Draco.glb
```
Fallback (no KTX2, largest but zero-risk on texture quality):
```
https://github.com/toji/sponza-optimized/raw/main/Sponza-Draco.glb
```

## Source lineage (settled)

Both `toji/sponza-optimized` and `ludicon/sponza-gltf` trace to the **same classic Crytek Sponza** (Marko Dabrovic 2002, updated by Frank Meinl), by way of the Khronos `glTF-Sample-Models`/`glTF-Sample-Assets` Sponza, which itself repacked Hans-Kristian Arntzen's / Alexandre Pestana's PBR texture pass. Confirmed by:
- Identical numeric texture-hash filenames (`5061699253647017043.png`, `8006627369776289000.png`, etc.) present in **both** repos' texture folders — same source texture set.
- ludicon's README states verbatim: "an updated version of the Sponza scene provided by the Khronos Group ... using the uncompressed textures from Hans-Kristian Arntzen ... created by Frank Meinl. The original Sponza model was created by Marko Dabrovic."
- Castaño's blog explicitly says the demo he was comparing against ("Tojiro's" clustered-shading demo, i.e. toji's) "appears to be based on the Sponza model in Khronos' sample model repository."

**Neither candidate derives from Intel/Frostbite's "New Sponza."** That is a separate, unrelated, much heavier asset (see baseline row below) — nobody has produced a small web-ready glTF from it.

License for the whole Crytek-derived lineage (per Khronos Sample-Assets README): **© 2016 Crytek, under the CryEngine Limited License Agreement** (not MIT/CC — free to use/redistribute for the sample-asset purpose Khronos/toji/ludicon use it for, but not a permissive OSS license). Neither `toji/sponza-optimized` nor `ludicon/sponza-gltf` carries its own LICENSE file (GitHub API reports `license: null` for both) — they inherit the Crytek terms via the Khronos chain.

## Comparison table

| | **toji/sponza-optimized** | **ludicon/sponza-gltf** | Baseline: Khronos glTF-Sponza | Baseline: Intel/Frostbite "New Sponza" |
|---|---|---|---|---|
| Lineage | Crytek→Khronos (see above) | Crytek→Khronos (same source) | Crytek (Meinl/Dabrovic) | Independent, Intel/DICE-Frostbite, photogrammetry-matched to real Dubrovnik atrium |
| Variants & real sizes | `Sponza.gltf`+`.bin`+textures: **47.7 MB** (plain JPG/PNG, no LFS) · `Sponza-Draco.glb`: **40.3 MB** · `Sponza-KTX.glb`: **15.5 MB** · `Sponza-KTX-Draco.glb`: **9.7 MB** | `sponza-png.glb`: **~103–118 MB** (Git LFS, confirmed via LFS pointer: 117,889,600 B) · `sponza-avif-hi.glb`: **28.1 MB** (LFS) · `sponza-avif-lo.glb`: **16.5 MB** (LFS) | Textures alone ~100+ MB uncompressed; no small packaged glTF release | No official small/web glTF; full package ships 3ds Max/glTF/FBX/USD at 4K texture res, historically several hundred MB–multi‑GB, not web-optimized |
| Mesh compression | `KHR_draco_mesh_compression` on `-Draco` variants only (verified: `extensionsRequired:["KHR_draco_mesh_compression"]` in glb JSON chunk); none on plain/KTX-only | None found/mentioned | None (plain accessors) | Not glTF-web-packaged; N/A |
| Texture format | Plain: raw JPG/PNG · `-KTX*`: **KTX2 container, `KHR_texture_basisu` required** (verified via glb JSON: `mimeType:"image/ktx2"`, `extensionsRequired:["KHR_texture_basisu"]`). Basis mode not confirmed via header parse, but the aggressive size drop (15.5 MB incl. geometry vs. 47.7 MB raw) strongly implies **ETC1S**, not UASTC. | `sponza-png.glb`: raw PNG · AVIF variants: **`EXT_texture_AVIF`** (non-standard glTF extension) + images decoded via Castaño's own **Spark** GPU runtime, not a glTF-standard path | JPG/PNG only | 4K PBR texture sets, source format not glTF-native compressed |
| Material completeness | Verified by parsing glb JSON: 25 materials, standard `pbrMetallicRoughness` (baseColor + combined ORM metallic/roughness) + `normalTexture`; **`TANGENT` attribute present** on geometry (no runtime tangent generation needed); foliage/fabric-type materials use `alphaMode:"MASK"` + `doubleSided:true` — normal, no red flags | Not independently parsed (LFS-gated), but per Castaño's blog the PNG source had "unnecessary alpha channels" he cleaned up, and tangent-space normals needed **manual unpacking in a custom shader** for the AVIF path — a sign the standard three.js `MeshStandardMaterial` normal path was not the target | Standard PBR, MikkTSpace tangents per Khronos README | Full PBR, presumably complete (not glTF-native verified) |
| Custom runtime dependency | **None.** All 4 variants use only first-party glTF extensions three.js ships loaders for. | **Yes for AVIF variants**: `EXT_texture_AVIF` (unsupported by stock `GLTFLoader`) + `spark.js` GPU texture loader + custom shader tangent-unpack code, per Castaño's own change list ("Adding support for EXT_texture_AVIF in the glTF loader... Loading textures using spark.js instead of the WebGPUTextureLoader"). PNG variant has no such dependency but is the largest download of any candidate. | None | N/A |
| Known issues | KTX2/ETC1S variant: Castaño's own side-by-side screenshots call the ETC1S compression "jarring" on this specific texture set — visible artifacting vs. AVIF/PNG, worth a visual gut-check before committing to `-KTX-Draco` for the final SSGI bench (GI/AO test bench cares less about raw texture fidelity than a texture-quality demo would, but flag it). | AVIF path is fast to decode CPU-side (Chrome ~180ms glTF + ~130ms texture per Castaño's own load-time table) but architecturally incompatible with the "stock GLTFLoader, standard extensions only" requirement. `sponza-png.glb` itself has no known defects (that's the version Castaño started from after cleanup). | None reported beyond generic Sponza foliage/fabric alpha quirks common to this lineage | Reported to be very high quality but heavy; not evaluated for web-loader compatibility |
| License | Inherits Crytek CryEngine Limited License via Khronos chain (no repo LICENSE file) | Same inheritance (no repo LICENSE file) | © 2016 Crytek, CryEngine Limited License Agreement (explicit in Khronos README) | Intel: free for personal/educational use, limited commercial (marketing/print in educational or research contexts) — distinct, more restrictive terms than the Crytek lineage |

## three.js r185 loader requirements by choice

| Variant | Loaders needed | Setup notes |
|---|---|---|
| `Sponza.gltf` (toji, plain) | `GLTFLoader` only | Zero extra setup. Largest of toji's options (47.7 MB) but the safest possible baseline if you want to rule out loader issues entirely. |
| `Sponza-Draco.glb` (toji) | `GLTFLoader` + `DRACOLoader` | `DRACOLoader.setDecoderPath()` to `three/examples/jsm/libs/draco/` (or a CDN copy); attach via `gltfLoader.setDRACOLoader(dracoLoader)`. No meshopt needed — this lineage uses Draco, not `EXT_meshopt_compression`, so `MeshoptDecoder` is irrelevant here. |
| `Sponza-KTX.glb` / `Sponza-KTX-Draco.glb` (toji) | `GLTFLoader` + `KTX2Loader` (+ `DRACOLoader` for the `-Draco` variant) | `KTX2Loader.setTranscoderPath()` to `three/examples/jsm/libs/basis/` and `.detectSupport(renderer)` before use — needs the `basis_transcoder.wasm`/`.js` pair shipped in three's examples/jsm/libs. This is a standard, well-trodden three.js path (same one used by Khronos' own glTF sample viewer), not a "custom runtime." |
| `sponza-png.glb` (ludicon) | `GLTFLoader` only | Works with stock loader, but 100+ MB download defeats the "small download + fast parse" priority — only worth it if KTX2/ETC1S artifacting proves unacceptable and Draco-only (40 MB) is still deemed too heavy for some reason. |
| ludicon AVIF variants | **Not usable as-is.** Would require writing a custom `EXT_texture_AVIF` glTF extension handler for `GLTFLoader` and either replicating or vendoring Castaño's `spark.js` GPU decode path. Out of scope for "stock GLTFLoader, standard extensions only." | Excluded from consideration. |

## Do we still need our own gltf-transform pass?

**No, not for M1.** `toji/sponza-optimized` already ships a pre-built Draco+KTX2 combo (`Sponza-KTX-Draco.glb`, 9.7 MB) that satisfies the size/parse-speed priority and uses only extensions three.js already has first-party loaders for. Running our own `gltf-transform` pass would only be worth it later if:
- The ETC1S artifacting Castaño flagged turns out to visibly distort the SSGI test bench's shading/AO results (in which case re-encode `Sponza-Draco.glb`'s raw textures to KTX2 **UASTC** ourselves — bigger but much cleaner than ETC1S, or to a higher-quality ETC1S setting), or
- We want to add `EXT_meshopt_compression` on top of Draco for smaller/faster GPU upload (three.js supports `MeshoptDecoder` too — not needed by any current toji variant, so this would be a self-directed optimization, not a requirement).

## Sources

- https://github.com/toji/sponza-optimized (file tree + sizes via `gh api .../git/trees/HEAD?recursive=true`; JSON chunk of `Sponza-KTX.glb` and `Sponza-Draco.glb` parsed directly via partial-range `curl` fetch of the glb header, ~70 KB each — not a full download)
- https://github.com/ludicon/sponza-gltf (README via raw fetch; `.gitattributes` confirms Git LFS on `*.png`/`*.glb`/`*.bin`; real sizes read from LFS pointer files, not downloaded)
- https://www.ludicon.com/castano/blog/2026/02/an-updated-sponza-gltf/ (full article text extracted; source of the AVIF/Spark/EXT_texture_AVIF findings, the size table, and the ETC1S "jarring artifacts" quote)
- https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Sponza/README.md (lineage + Crytek/CryEngine license)
- https://www.intel.com/content/www/us/en/developer/topic-technology/graphics-research/samples.html and https://www.intel.com/content/www/us/en/content-details/830833/sponza-base-scene.html (Intel/Frostbite baseline — page itself returned 403 to direct fetch, facts via search-result snippets only, flagged as lower-confidence)
