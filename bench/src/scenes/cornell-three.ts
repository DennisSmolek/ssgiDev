import {
  AmbientLight,
  BoxGeometry,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
} from 'three/webgpu';
import type { SceneContext, SceneDef, SceneHandle } from '../harness/types';

// Faithful replica of the scene in three.js's official SSGI example
// (examples/webgpu_postprocessing_ssgi.html, dev branch, fetched 2026-07-18).
// Purpose: apples-to-apples comparison between demo 01 and the official demo —
// same room (20 wide × 15 high × 20 deep, floor y=0), same shadow-casting
// point light, same materials. SSGINode's default params are tuned for THIS
// scale, not our 5.5-unit `cornell` scene (radius ~12 on the small box is why
// it looked far noisier than the official demo).
// WORLD SCALE: room 20×15×20. Thickness/radius params tuned per-scene.

function surface(color: number): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({ color });
}

export const cornellThreeScene: SceneDef = {
  id: 'cornell3',
  label: 'Cornell (three.js example)',
  create(ctx: SceneContext): SceneHandle {
    // The official example renders with shadow maps on.
    ctx.renderer.shadowMap.enabled = true;

    const scene = new Scene();

    const addWall = (geo: PlaneGeometry, color: number): Mesh => {
      const m = new Mesh(geo, surface(color));
      m.receiveShadow = true;
      scene.add(m);
      return m;
    };

    const left = addWall(new PlaneGeometry(20, 15), 0xff0000);
    left.rotation.y = Math.PI / 2;
    left.position.set(-10, 7.5, 0);

    const right = addWall(new PlaneGeometry(20, 15), 0x00ff00);
    right.rotation.y = -Math.PI / 2;
    right.position.set(10, 7.5, 0);

    const floor = addWall(new PlaneGeometry(20, 20), 0xffffff);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);

    const back = addWall(new PlaneGeometry(20, 15), 0xffffff);
    back.position.set(0, 7.5, -10);

    const ceiling = addWall(new PlaneGeometry(20, 20), 0xffffff);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 15, 0);

    const tall = new Mesh(new BoxGeometry(5, 7, 5), surface(0xffffff));
    tall.position.set(-3, 3.5, -2);
    tall.rotation.y = Math.PI / 4;
    tall.castShadow = tall.receiveShadow = true;
    scene.add(tall);

    const short = new Mesh(new BoxGeometry(4, 4, 4), surface(0xffffff));
    short.position.set(4, 2, 4);
    short.rotation.y = -Math.PI / 10;
    short.castShadow = short.receiveShadow = true;
    scene.add(short);

    // Ceiling light fixture (unlit white cylinder, like the example).
    const fixture = new Mesh(new CylinderGeometry(2.5, 2.5, 1), new MeshBasicMaterial());
    fixture.position.set(0, 15, 0);
    scene.add(fixture);

    const light = new PointLight(0xffffff, 100, 100);
    light.position.set(0, 13, 0);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    scene.add(light);

    scene.add(new AmbientLight(0x0c0c0c));

    const camera = new PerspectiveCamera(40, ctx.aspect, 0.1, 100);
    camera.position.set(0, 10, 30);

    // Same velocity/temporal test toggle as the 5.5-unit cornell scene.
    const state = { rotate: false };
    const folder = ctx.pane.addFolder({ title: 'Scene (Cornell three.js)' });
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
