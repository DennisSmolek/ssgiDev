import {
  AmbientLight,
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
} from 'three/webgpu';
import type { SceneContext, SceneDef, SceneHandle } from '../harness/types';

// Cornell box — SCALE: interior cube edge = 5.5 world units (classic 555mm room
// scaled /100). Floor at y=0, interior spans x,z in [-2.75, 2.75], y in [0, 5.5].
// The front face (z = +2.75) is open; the camera views from outside along -z.
// WORLD-SPACE THICKNESS HEURISTICS (M3+) are tuned against THIS 5.5-unit scale —
// Sponza uses a different scale, so thickness params are per-scene.
const S = 5.5;
const H = S / 2; // 2.75

function wall(
  geo: BoxGeometry | PlaneGeometry,
  color: number,
  rough = 1,
): Mesh {
  const m = new MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  return new Mesh(geo, m);
}

export const cornellScene: SceneDef = {
  id: 'cornell',
  label: 'Cornell Box',
  create(ctx: SceneContext): SceneHandle {
    const scene = new Scene();

    // --- Room (five planes; front open) ---
    const plane = new PlaneGeometry(S, S);

    const floor = wall(plane, 0xdddddd);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);

    const ceiling = wall(plane, 0xdddddd);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, S, 0);

    const back = wall(plane, 0xdddddd);
    back.position.set(0, H, -H);

    const left = wall(plane, 0xd02020); // red
    left.rotation.y = Math.PI / 2;
    left.position.set(-H, H, 0);

    const right = wall(plane, 0x20a020); // green
    right.rotation.y = -Math.PI / 2;
    right.position.set(H, H, 0);

    scene.add(floor, ceiling, back, left, right);

    // --- Blocks (classic proportions, scaled) ---
    const tall = wall(new BoxGeometry(1.65, 3.3, 1.65), 0xcccccc);
    tall.position.set(-0.9, 1.65, -0.85);
    tall.rotation.y = 0.29;

    const short = wall(new BoxGeometry(1.65, 1.65, 1.65), 0xcccccc);
    short.position.set(0.95, 0.825, 0.7);
    short.rotation.y = -0.3;

    scene.add(tall, short);

    // --- Ceiling area light: emissive panel + matching THREE light ---
    const panelMat = new MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveIntensity: 6,
    });
    const panel = new Mesh(new PlaneGeometry(2.2, 2.2), panelMat);
    panel.rotation.x = Math.PI / 2;
    panel.position.set(0, S - 0.02, 0);
    scene.add(panel);

    // PointLight (robust across renderers) sits just under the panel so the
    // beauty pass is lit. An area light is a later realism concern.
    const light = new PointLight(0xffffff, 40, 0, 2);
    light.position.set(0, S - 0.4, 0);
    scene.add(light);
    scene.add(new AmbientLight(0xffffff, 0.15));

    // --- Camera ---
    const camera = new PerspectiveCamera(40, ctx.aspect, 0.1, 50);
    camera.position.set(0, H, 9.2);

    // --- Toggleable slow rotation on the short box (velocity/temporal test) ---
    const state = { rotate: false };
    const folder = ctx.pane.addFolder({ title: 'Scene (Cornell)' });
    folder.addBinding(state, 'rotate', { label: 'rotate short box' });

    return {
      scene,
      camera,
      update(dt: number): void {
        if (state.rotate) short.rotation.y += dt * 0.6;
      },
      dispose(): void {
        folder.dispose();
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
