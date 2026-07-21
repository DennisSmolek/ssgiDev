import {
  AmbientLight,
  Box3,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { SceneContext, SceneDef, SceneHandle } from '../harness/types';
// Vite `?url`: emits the (gitignored) asset and returns a served URL. The glb is
// self-contained (KTX2 textures embedded), so only this one file is fetched at
// runtime; the KTX2/Draco *decoders* are served from /decoders/ (fetch-assets.sh).
import sponzaUrl from '../../assets/Sponza-KTX-Draco.glb?url';

// Decoders staged into bench/public/decoders by scripts/fetch-assets.sh, copied
// from the pinned three@0.185.1 package so transcoder/three versions always match.
const DRACO_PATH = '/decoders/draco/gltf/';
const BASIS_PATH = '/decoders/basis/';

// WORLD SCALE (MEASURED 2026-07-18 from the loaded bounding box — logged fresh on
// every load; see the [sponza] console line). toji/sponza-optimized
// `Sponza-KTX-Draco.glb` is authored in METERS (~1 unit == 1 metre):
//   bounds  min=(-15.4, -1.0, -9.5)  max=(14.4, 11.4, 8.8)
//   size    = (29.8 wide X, 12.4 tall Y, 18.3 deep Z)   longest edge ≈ 29.8 units
//   center  = (-0.5, 5.2, -0.3)      atrium floor at y ≈ 0 (min.y ≈ -1.0)
// X is the long atrium axis (~30 units). This is ~5.4x the Cornell box's 5.5-unit
// interior — WORLD-SPACE THICKNESS params (SSGINode.thickness, radius) must be
// retuned per scene: a 1.0 thickness that is "one wall" in Cornell is a thin sliver
// here. (PLAN.md trap: thickness is world-space.)
const SPONZA_LONGEST_EDGE = 29.8; // world units (measured)

export const sponzaScene: SceneDef = {
  id: 'sponza',
  label: 'Sponza',
  create(ctx: SceneContext): SceneHandle {
    const scene = new Scene();

    // --- Lighting (Sponza ships no lights) ------------------------------------
    // Directional "sun" angled down through the atrium's long axis so the atrium
    // floor and one row of columns catch direct light while the arcades fall into
    // shadow — GI-relevant contrast for AO/GI to fill.
    // Scene v2 (2026-07-21): steepened so a visible sun shaft strikes the
    // atrium floor inside the S-hall/S-column framings — the corridor was
    // almost entirely in shadow before, starving screen-space GI of bright
    // beauty content to bounce (weak signal in every sponza grid cell).
    // `?sun=px,py,pz,tx,ty,tz[,intensity]` overrides for deterministic capture
    // and lighting experiments (same spirit as `?cam=`).
    const sun = new DirectionalLight(0xfff4e0, 4.0);
    sun.position.set(8, 19, 4); // v2c: shaft lands mid-corridor, right colonnade lit
    sun.target.position.set(4, 0, 0);
    const sunParam = new URLSearchParams(window.location.search).get('sun');
    if (sunParam) {
      const n = sunParam.split(',').map(Number);
      if (n.length >= 6 && n.slice(0, 6).every((x) => Number.isFinite(x))) {
        sun.position.set(n[0], n[1], n[2]);
        sun.target.position.set(n[3], n[4], n[5]);
        if (n.length >= 7 && Number.isFinite(n[6])) sun.intensity = n[6];
      }
    }
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // Bounds cover the whole ~30x18x12 atrium from the sun's angle.
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 45;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    scene.add(sun.target);

    // Low sky/ground hemisphere + a faint ambient so nothing crushes to pure
    // black before GI is added (keeps the beauty pass legible as an SSGI input).
    const hemi = new HemisphereLight(0xbcd0ff, 0x2b2115, 0.35);
    scene.add(hemi);
    scene.add(new AmbientLight(0xffffff, 0.06));

    // --- Torches (scene v2) ---------------------------------------------------
    // Static warm emitters at colonnade bases near the S-column pose: strong
    // LOCAL bounce sources the sun can't provide — they stress firefly clamps,
    // GI leak/halo behavior around small bright emitters, and the lightmask
    // multibounce path. STATIC by default: flicker would corrupt the
    // still-camera stability metric and the oracle's accumulation, so it is an
    // opt-in pane toggle (deterministic sin, not random). `?torch=<intensity>`
    // overrides (0 disables) for deterministic capture.
    const TORCH_POS: Array<[number, number, number]> = [
      [4.5, 0, -2.9],
      [7.5, 0, -2.9],
      [6.0, 0, 2.9],
    ];
    const torchGroup = new Group();
    const torchLights: PointLight[] = [];
    const torchBowls: MeshStandardMaterial[] = [];
    const poleGeo = new CylinderGeometry(0.04, 0.06, 1.0, 8);
    const bowlGeo = new SphereGeometry(0.12, 16, 12);
    const poleMat = new MeshStandardMaterial({ color: 0x2a2118, roughness: 0.9, metalness: 0.3 });
    for (const [tx, ty, tz] of TORCH_POS) {
      const bowlMat = new MeshStandardMaterial({
        color: 0x140a04,
        emissive: 0xff7722,
        emissiveIntensity: 6,
        roughness: 1,
      });
      const pole = new Mesh(poleGeo, poleMat);
      pole.position.set(tx, ty + 0.5, tz);
      pole.castShadow = pole.receiveShadow = true;
      const bowl = new Mesh(bowlGeo, bowlMat);
      bowl.position.set(tx, ty + 1.1, tz);
      const light = new PointLight(0xff8844, 10, 8, 2);
      light.position.set(tx, ty + 1.25, tz);
      light.castShadow = false; // local pools only; shadow cost not worth it
      torchGroup.add(pole, bowl, light);
      torchLights.push(light);
      torchBowls.push(bowlMat);
    }
    scene.add(torchGroup);
    const torchParam = new URLSearchParams(window.location.search).get('torch');
    const torchBase = torchParam !== null && Number.isFinite(Number(torchParam)) ? Number(torchParam) : 1;

    // --- Camera (eye-level at one end of the atrium, looking down the long X
    //     axis — the classic Sponza corridor shot) ---------------------------
    const camera = new PerspectiveCamera(60, ctx.aspect, 0.1, 100);
    camera.position.set(11, 1.8, -0.3);
    camera.lookAt(-10, 2.6, -0.3);

    // --- Async load -----------------------------------------------------------
    const ktx2 = new KTX2Loader().setTranscoderPath(BASIS_PATH).detectSupport(ctx.renderer);
    const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
    const gltf = new GLTFLoader().setKTX2Loader(ktx2).setDRACOLoader(draco);

    let loaded = false;
    gltf.load(
      sponzaUrl,
      (result) => {
        const model = result.scene;
        model.traverse((o) => {
          const mesh = o as Mesh;
          if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
        });
        scene.add(model);
        loaded = true;

        // Measure + record world scale (thickness params are world-space).
        const box = new Box3().setFromObject(model);
        const size = box.getSize(new Vector3());
        const center = box.getCenter(new Vector3());
        const longest = Math.max(size.x, size.y, size.z);
        console.info(
          `[sponza] loaded. bounds min=(${fmt(box.min)}) max=(${fmt(box.max)}) ` +
            `size=(${fmt(size)}) longestEdge=${longest.toFixed(2)} center=(${fmt(center)})`,
        );
        if (Math.abs(longest - SPONZA_LONGEST_EDGE) > SPONZA_LONGEST_EDGE * 0.25) {
          console.warn(
            `[sponza] longest edge ${longest.toFixed(2)} differs from recorded ` +
              `${SPONZA_LONGEST_EDGE} — retune world-space thickness/radius params.`,
          );
        }
      },
      undefined,
      (err) => {
        console.error('[sponza] GLTF load failed:', err);
      },
    );

    const state = { sunIntensity: sun.intensity, torch: torchBase, flicker: false };
    const applyTorch = () => {
      const s = Math.max(0, state.torch);
      torchGroup.visible = s > 0;
      for (const l of torchLights) l.intensity = 10 * s;
      for (const m of torchBowls) m.emissiveIntensity = 6 * s;
    };
    applyTorch();
    const folder = ctx.pane.addFolder({ title: 'Scene (Sponza)' });
    folder
      .addBinding(state, 'sunIntensity', { label: 'sun', min: 0, max: 8, step: 0.1 })
      .on('change', () => (sun.intensity = state.sunIntensity));
    folder
      .addBinding(state, 'torch', { label: 'torches', min: 0, max: 3, step: 0.1 })
      .on('change', applyTorch);
    folder.addBinding(state, 'flicker', { label: 'torch flicker (breaks stills!)' });
    const status = { loaded: false };
    folder.addBinding(status, 'loaded', { readonly: true, label: 'model loaded' });
    const statusTimer = setInterval(() => (status.loaded = loaded), 250);

    // Deterministic flicker (opt-in): fixed-frequency sin mix per torch, phase
    // by index — repeatable, no RNG, so an intentional temporal stress test can
    // still be described exactly.
    let flickerT = 0;
    return {
      scene,
      camera,
      update(dt: number): void {
        if (!state.flicker || state.torch <= 0) return;
        flickerT += dt;
        for (let i = 0; i < torchLights.length; i++) {
          const f =
            1 +
            0.22 * Math.sin(flickerT * 9.0 + i * 2.1) +
            0.12 * Math.sin(flickerT * 23.0 + i * 4.7);
          torchLights[i].intensity = 10 * state.torch * f;
          torchBowls[i].emissiveIntensity = 6 * state.torch * f;
        }
      },
      dispose(): void {
        clearInterval(statusTimer);
        folder.dispose();
        ktx2.dispose();
        draco.dispose();
        scene.traverse((o) => {
          const mesh = o as Mesh;
          if (mesh.isMesh) {
            mesh.geometry.dispose();
            const mat = mesh.material;
            if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
            else mat.dispose();
          }
        });
      },
    };
  },
};

function fmt(v: Vector3): string {
  return `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;
}
