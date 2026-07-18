import {
  AmbientLight,
  Box3,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three/webgpu';
import type { Mesh } from 'three/webgpu';
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
    const sun = new DirectionalLight(0xfff4e0, 3.0);
    sun.position.set(6, 14, 3); // high, angled across the atrium
    sun.target.position.set(-4, 0, -1);
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

    const state = { sunIntensity: 3.0 };
    const folder = ctx.pane.addFolder({ title: 'Scene (Sponza)' });
    folder
      .addBinding(state, 'sunIntensity', { label: 'sun', min: 0, max: 8, step: 0.1 })
      .on('change', () => (sun.intensity = state.sunIntensity));
    const status = { loaded: false };
    folder.addBinding(status, 'loaded', { readonly: true, label: 'model loaded' });
    const statusTimer = setInterval(() => (status.loaded = loaded), 250);

    return {
      scene,
      camera,
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
