import {
  AmbientLight,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from 'three/webgpu';
import type { SceneContext, SceneDef, SceneHandle } from '../harness/types';

// Artifact zoo — a small procedural scene of VBAO's headline hard cases, built so
// thin-geometry AO wins/losses and thickness-heuristic behaviour become VISIBLE
// instead of anecdotal (PLAN.md scene 3).
//
// WORLD SCALE: authored in the same ~metre scale as the Cornell box so world-space
// thickness params carry over (ground plane 16x12 units, objects 0.02–0.5 thick).
// Ground at y=0, camera looks along -z toward the wall at z=-5.
//
// The four cases, left-to-right on the ground:
//   1. THIN PLATES at graded thickness — five upright plates, thickness stepped
//      0.02 / 0.06 / 0.14 / 0.30 / 0.50 units. The thin end is where a too-large
//      thickness heuristic lets light bleed through / AO vanish; the thick end is
//      where AO should be solid. A single knob (SSGINode.thickness) can't be right
//      for all five at once — that's the point.
//   2. FENCE / RAILING — a row of 10 thin square posts (0.05 units) under a top
//      rail. Classic thin-occluder contact-shadow + inter-post AO test.
//   3. CHAIR-LEG CONTACT POINTS — four thin cylindrical legs (r=0.04) meeting the
//      ground; the tiny contact-point AO ring is the headline VBAO win case.
//   4. CAMERA-FACING WALL — a flat wall section filling frame, for reading AO/GI
//      falloff and denoiser behaviour on a large uniform surface.

const GROUND_W = 16;
const GROUND_D = 12;
const WALL_Z = -5;

// graded plate thicknesses (world units) — the headline thickness-heuristic axis
const PLATE_THICKNESSES = [0.02, 0.06, 0.14, 0.3, 0.5];

function mat(color: number, opts: { rough?: number; metal?: number } = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.85,
    metalness: opts.metal ?? 0,
  });
}

export const artifactZooScene: SceneDef = {
  id: 'artifact-zoo',
  label: 'Artifact Zoo',
  create(ctx: SceneContext): SceneHandle {
    const scene = new Scene();

    // --- Ground plane ---------------------------------------------------------
    const ground = new Mesh(new PlaneGeometry(GROUND_W, GROUND_D), mat(0xb8b8b8));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 0);
    scene.add(ground);

    // --- Camera-facing back wall (case 4) -------------------------------------
    const wall = new Mesh(new PlaneGeometry(GROUND_W, 6), mat(0xa8a8b0));
    wall.position.set(0, 3, WALL_Z);
    scene.add(wall);
    // short return wall on the left to create a concave corner (AO in the crease)
    const sideWall = new Mesh(new PlaneGeometry(Math.abs(WALL_Z) * 2, 6), mat(0xa8a8b0));
    sideWall.rotation.y = Math.PI / 2;
    sideWall.position.set(-GROUND_W / 2, 3, WALL_Z + Math.abs(WALL_Z));
    scene.add(sideWall);

    // --- Case 1: graded thin plates -------------------------------------------
    // Five upright plates, each 1.2 wide x 2.0 tall, thickness stepped per array.
    // Spread across x on the left-center, standing on the ground.
    const plateH = 2.0;
    const plateW = 1.2;
    PLATE_THICKNESSES.forEach((t, i) => {
      const plate = new Mesh(new BoxGeometry(plateW, plateH, t), mat(0xcc7755));
      plate.position.set(-5.5 + i * 1.6, plateH / 2, -1.5);
      scene.add(plate);
    });

    // --- Case 2: fence / railing (thin posts + top rail) ----------------------
    // 10 posts, 0.05 x 1.1 x 0.05, spaced 0.5 apart; a thin top rail across them.
    const postT = 0.05;
    const postH = 1.1;
    const postCount = 10;
    const postSpacing = 0.5;
    const fenceX0 = 1.2;
    const fenceZ = 1.5;
    for (let i = 0; i < postCount; i++) {
      const post = new Mesh(new BoxGeometry(postT, postH, postT), mat(0x88aa99));
      post.position.set(fenceX0 + i * postSpacing, postH / 2, fenceZ);
      scene.add(post);
    }
    const railLen = (postCount - 1) * postSpacing + postT;
    const rail = new Mesh(new BoxGeometry(railLen, 0.08, 0.06), mat(0x88aa99));
    rail.position.set(fenceX0 + ((postCount - 1) * postSpacing) / 2, postH - 0.06, fenceZ);
    scene.add(rail);

    // --- Case 3: chair-leg contact points -------------------------------------
    // A flat seat on four thin cylindrical legs; the leg/ground contact is the
    // small-radius AO-ring case. Legs r=0.04, h=0.9.
    const legR = 0.04;
    const legH = 0.9;
    const seatY = legH;
    // Front-and-centre, in front of the plate row, so the leg/ground contact rings
    // (the headline VBAO win case) are unobstructed and closest to camera.
    const chairX = -1.4;
    const chairZ = 2.6;
    const legMat = mat(0x666a70, { rough: 0.7 });
    const legHalf = 0.35;
    for (const [dx, dz] of [
      [-legHalf, -legHalf],
      [legHalf, -legHalf],
      [-legHalf, legHalf],
      [legHalf, legHalf],
    ]) {
      const leg = new Mesh(new CylinderGeometry(legR, legR, legH, 12), legMat);
      leg.position.set(chairX + dx, legH / 2, chairZ + dz);
      scene.add(leg);
    }
    const seat = new Mesh(new BoxGeometry(0.9, 0.06, 0.9), mat(0x8a6a48));
    seat.position.set(chairX, seatY, chairZ);
    scene.add(seat);

    // --- Lighting -------------------------------------------------------------
    // Angled key light so every thin object casts a contact shadow toward camera.
    const sun = new DirectionalLight(0xfff2e0, 3.2);
    sun.position.set(4, 8, 6);
    sun.target.position.set(0, 0, -1);
    scene.add(sun, sun.target);
    scene.add(new HemisphereLight(0xcdd8ff, 0x2a2620, 0.3));
    scene.add(new AmbientLight(0xffffff, 0.06));

    // --- Camera ---------------------------------------------------------------
    const camera = new PerspectiveCamera(50, ctx.aspect, 0.1, 100);
    camera.position.set(0, 2.6, 7.5);
    camera.lookAt(0, 1.2, -1);

    ctx.pane.addFolder({ title: 'Scene (Artifact Zoo)' }).addBlade({
      view: 'text',
      label: 'plate mm',
      parse: (v: string) => v,
      value: PLATE_THICKNESSES.map((t) => (t * 1000).toFixed(0)).join(' / '),
    });

    return {
      scene,
      camera,
      dispose(): void {
        scene.traverse((o) => {
          const mesh = o as Mesh;
          if (mesh.isMesh) {
            mesh.geometry.dispose();
            const m = mesh.material;
            if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
            else m.dispose();
          }
        });
      },
    };
  },
};
