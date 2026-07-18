import { Clock, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Pane } from 'tweakpane';
import { getDevice } from './three-internals';
import { probeCapabilities } from './capabilities';
import { Timing } from './timing';
import { CameraBookmarks } from './camera';
import { Registry } from './registry';
import type { CapabilityReport } from './capabilities';
import type { Demo, DemoDef, HarnessContext, SceneDef, SceneHandle, Size } from './types';

const MAX_PIXEL_RATIO = 2;

function showError(message: string): void {
  const el = document.getElementById('error');
  const msg = document.getElementById('error-msg');
  if (msg) msg.textContent = message;
  el?.classList.add('show');
}

function urlParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function setUrlAndReload(key: string, value: string): void {
  const p = urlParams();
  p.set(key, value);
  window.location.search = p.toString();
}

export interface AppConfig {
  demos: Registry<DemoDef>;
  scenes: Registry<SceneDef>;
}

export async function startApp(config: AppConfig): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    showError('navigator.gpu is undefined. This browser/environment has no WebGPU support.');
    return;
  }

  const mount = document.getElementById('app')!;
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  // Shadow maps on for every scene: SSGI gathers from the beauty buffer, so a
  // shadowless beauty hands every GI technique a physically wrong input.
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  mount.appendChild(renderer.domElement);

  try {
    await renderer.init();
  } catch (e) {
    showError(`renderer.init() failed:\n${String(e)}`);
    return;
  }

  const capabilities: CapabilityReport = probeCapabilities(renderer);
  const device = getDevice(renderer);

  // --- resolve scene + demo from URL ---
  const params = urlParams();
  const sceneDef = config.scenes.resolve(params.get('scene'));
  const demoDef = config.demos.resolve(params.get('demo'));

  // --- state: render scale ---
  const state = { renderScale: 1.0 };
  const scaleParam = params.get('scale');
  if (scaleParam) {
    const v = Number(scaleParam);
    if (v >= 0.25 && v <= 1.0) state.renderScale = v;
  }

  const canvasSize = (): Size => ({
    width: renderer.domElement.width,
    height: renderer.domElement.height,
  });
  const renderSize = (): Size => {
    const c = canvasSize();
    return {
      width: Math.max(1, Math.floor(c.width * state.renderScale)),
      height: Math.max(1, Math.floor(c.height * state.renderScale)),
    };
  };

  // --- Tweakpane root ---
  const pane = new Pane({ title: 'SSGI Bench' });
  // Tweakpane's injected container (.tp-dfwv) is position:fixed with no height
  // cap, so long demo panels run off-screen with no way to reach them.
  const paneRoot = pane.element.parentElement;
  if (paneRoot) {
    paneRoot.style.maxHeight = 'calc(100vh - 16px)';
    paneRoot.style.overflowY = 'auto';
  }

  // --- scene + camera + controls ---
  const scene: SceneHandle = sceneDef.create({
    aspect: window.innerWidth / window.innerHeight,
    pane,
    renderer,
  });
  const controls = new OrbitControls(scene.camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, scene.camera.position.y, 0);
  controls.update();

  // Deterministic camera override for headless lab captures (added M5/lab 07):
  // `?cam=px,py,pz,tx,ty,tz`. Isolated, additive; other demos ignore it.
  const camParam = params.get('cam');
  if (camParam) {
    const n = camParam.split(',').map(Number);
    if (n.length === 6 && n.every((x) => Number.isFinite(x))) {
      scene.camera.position.set(n[0], n[1], n[2]);
      controls.target.set(n[3], n[4], n[5]);
      controls.update();
    }
  }

  const timing = new Timing(capabilities.hasTimestampQuery);

  const ctx: HarnessContext = {
    renderer,
    device,
    scene,
    controls,
    pane,
    timing,
    capabilities,
    renderSize,
    canvasSize,
  };

  // --- demo (created before panels so render-scale changes can resize it) ---
  const demo: Demo = demoDef.create();
  await demo.init(ctx);
  demo.resize(ctx);

  buildTopPanels(pane, config, sceneDef, demoDef, state, ctx, () => demo.resize(ctx));
  buildCameraPanel(pane, sceneDef.id, scene, controls);

  // --- resize handling ---
  const onResize = (): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(window.innerWidth, window.innerHeight);
    scene.camera.aspect = window.innerWidth / window.innerHeight;
    scene.camera.updateProjectionMatrix();
    demo.resize(ctx);
  };
  window.addEventListener('resize', onResize);

  // --- loop ---
  const clock = new Clock();
  const loop = (): void => {
    requestAnimationFrame(loop);
    timing.frameStart();
    const dt = clock.getDelta();
    scene.update?.(dt);
    controls.update();
    void demo.frame(ctx, dt);
    timing.frameEnd();
  };
  loop();
}

function buildTopPanels(
  pane: Pane,
  config: AppConfig,
  sceneDef: SceneDef,
  demoDef: DemoDef,
  state: { renderScale: number },
  ctx: HarnessContext,
  onScaleChange: () => void,
): void {
  const sel = pane.addFolder({ title: 'Bench', expanded: true });

  const demoOpts: Record<string, string> = {};
  for (const d of config.demos.list()) demoOpts[d.label] = d.id;
  const demoState = { demo: demoDef.id };
  sel
    .addBinding(demoState, 'demo', { label: 'demo', options: demoOpts })
    .on('change', (ev: { value: string }) => {
      if (ev.value !== demoDef.id) setUrlAndReload('demo', ev.value);
    });

  const sceneOpts: Record<string, string> = {};
  for (const s of config.scenes.list()) sceneOpts[s.label] = s.id;
  const sceneState = { scene: sceneDef.id };
  sel
    .addBinding(sceneState, 'scene', { label: 'scene', options: sceneOpts })
    .on('change', (ev: { value: string }) => {
      if (ev.value !== sceneDef.id) setUrlAndReload('scene', ev.value);
    });

  sel
    .addBinding(state, 'renderScale', { label: 'render scale', min: 0.25, max: 1.0, step: 0.05 })
    .on('change', () => onScaleChange());

  // --- stats ---
  const stats = pane.addFolder({ title: 'Stats', expanded: true });
  stats.addBinding(ctx.timing.readout, 'fps', { readonly: true });
  stats.addBinding(ctx.timing.readout, 'cpuMs', { readonly: true, label: 'cpu ms' });
  stats.addBinding(ctx.timing.readout, 'gpuMs', { readonly: true, label: 'gpu ms (render)' });
  stats.addBinding(ctx.timing.readout, 'rawMs', { readonly: true, label: 'raw ms (cpu)' });
  stats.addBinding(ctx.timing.readout, 'gpuAvailable', { readonly: true, label: 'timestamp?' });

  // --- capabilities ---
  const caps = pane.addFolder({ title: 'Capabilities', expanded: false });
  const capObj: Record<string, boolean> = { ...ctx.capabilities.features };
  for (const [name, ok] of Object.entries(ctx.capabilities.features)) {
    caps.addBinding(capObj, name, { readonly: true });
    capObj[name] = ok;
  }
  if (ctx.capabilities.missingRequired.length > 0) {
    caps.addBlade({
      view: 'text',
      label: 'MISSING',
      parse: (v: string) => v,
      value: ctx.capabilities.missingRequired.join(', '),
    });
  }
}

function buildCameraPanel(
  pane: Pane,
  sceneId: string,
  scene: SceneHandle,
  controls: OrbitControls,
): void {
  const bookmarks = new CameraBookmarks(sceneId, scene.camera, controls);
  const folder = pane.addFolder({ title: 'Camera bookmarks', expanded: false });
  const nameState = { name: 'default' };
  folder.addBinding(nameState, 'name', { label: 'name' });
  folder.addButton({ title: 'save pose' }).on('click', () => bookmarks.save(nameState.name));
  folder.addButton({ title: 'restore pose' }).on('click', () => bookmarks.restore(nameState.name));
  folder.addButton({ title: 'delete pose' }).on('click', () => bookmarks.delete(nameState.name));
  folder.addButton({ title: 'copy all poses (JSON)' }).on('click', () => {
    void navigator.clipboard?.writeText(bookmarks.exportJSON());
  });
}
