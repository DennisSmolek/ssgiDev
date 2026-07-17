import type { PerspectiveCamera } from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface CameraBookmark {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

// Named camera poses, persisted to localStorage per scene. JSON-exportable so
// future Blender/Cycles ground-truth renders can consume the exact poses.
export class CameraBookmarks {
  private bookmarks: CameraBookmark[] = [];
  private readonly key: string;

  constructor(
    sceneId: string,
    private readonly camera: PerspectiveCamera,
    private readonly controls: OrbitControls,
  ) {
    this.key = `ssgi-bench:bookmarks:${sceneId}`;
    this.load();
  }

  get names(): string[] {
    return this.bookmarks.map((b) => b.name);
  }

  save(name: string): void {
    const c = this.camera;
    const t = this.controls.target;
    const entry: CameraBookmark = {
      name,
      position: [c.position.x, c.position.y, c.position.z],
      target: [t.x, t.y, t.z],
      fov: c.fov,
    };
    const idx = this.bookmarks.findIndex((b) => b.name === name);
    if (idx >= 0) this.bookmarks[idx] = entry;
    else this.bookmarks.push(entry);
    this.persist();
  }

  restore(name: string): boolean {
    const b = this.bookmarks.find((x) => x.name === name);
    if (!b) return false;
    this.camera.position.set(b.position[0], b.position[1], b.position[2]);
    this.controls.target.set(b.target[0], b.target[1], b.target[2]);
    this.camera.fov = b.fov;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    return true;
  }

  delete(name: string): void {
    this.bookmarks = this.bookmarks.filter((b) => b.name !== name);
    this.persist();
  }

  exportJSON(): string {
    return JSON.stringify(this.bookmarks, null, 2);
  }

  importJSON(json: string): void {
    const parsed = JSON.parse(json) as CameraBookmark[];
    if (Array.isArray(parsed)) {
      this.bookmarks = parsed;
      this.persist();
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) this.bookmarks = JSON.parse(raw) as CameraBookmark[];
    } catch {
      this.bookmarks = [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.bookmarks));
    } catch {
      /* localStorage unavailable; bookmarks are session-only */
    }
  }
}
