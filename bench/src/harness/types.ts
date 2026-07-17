import type { PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Pane } from 'tweakpane';
import type { CapabilityReport } from './capabilities';
import type { Timing } from './timing';

export interface Size {
  width: number;
  height: number;
}

// A scene instance produced by a SceneDef.create(). Owns its three.Scene +
// camera and any per-frame animation (e.g. the rotating box for velocity tests).
export interface SceneHandle {
  scene: Scene;
  camera: PerspectiveCamera;
  // Called once per frame with delta seconds before rendering.
  update?(dt: number): void;
  dispose(): void;
}

export interface SceneDef {
  id: string;
  label: string;
  create(ctx: SceneContext): SceneHandle;
}

export interface SceneContext {
  aspect: number;
  pane: Pane;
  // Renderer is needed by scenes that load compressed textures (KTX2Loader
  // requires `.detectSupport(renderer)`). Procedural scenes may ignore it.
  renderer: WebGPURenderer;
}

// The shared services every demo receives. The demo owns its render loop body
// (M0 demo 00 needs a custom multi-pass sequence), the harness owns everything
// around it.
export interface HarnessContext {
  renderer: WebGPURenderer;
  device: GPUDevice;
  scene: SceneHandle;
  controls: OrbitControls;
  pane: Pane;
  timing: Timing;
  capabilities: CapabilityReport;
  // Internal render resolution (canvas backing size * renderScale).
  renderSize(): Size;
  // Canvas backing size (drawingBuffer size).
  canvasSize(): Size;
}

export interface Demo {
  init(ctx: HarnessContext): void | Promise<void>;
  frame(ctx: HarnessContext, dt: number): void | Promise<void>;
  // Called when render or canvas size changes.
  resize(ctx: HarnessContext): void;
  dispose(): void;
}

export interface DemoDef {
  id: string;
  label: string;
  // Demos build their own Tweakpane folder in Demo.init(ctx) via ctx.pane.
  create(): Demo;
}
