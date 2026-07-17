// All access to three.js r185 semi-private WebGPU internals lives here.
// Version bumps touch ONLY this file. Verified against three@0.185.1.
//
// Accessors used (source locations in node_modules/three/src as of 0.185.1):
//   renderer.backend.device                      -> GPUDevice
//     (WebGPUBackend.device, set in init(); renderers/webgpu/WebGPUBackend.js)
//   renderer.backend.get(threeTexture).texture   -> GPUTexture
//     (Backend.get() data map; GPUTexture stored as `.texture` by
//      WebGPUTextureUtils.createTexture, renderers/webgpu/utils/WebGPUTextureUtils.js)
//   renderer.backend.get(threeTexture).textureDescriptorGPU.format -> GPUTextureFormat
//   renderer.initRenderTarget(rt)                 -> forces GPU texture allocation
//     (Renderer.initRenderTarget, renderers/common/Renderer.js)
//
// three's WebGPUBackend requests EVERY adapter-supported feature at device
// creation (WebGPUBackend.init builds requiredFeatures from adapter.features),
// so `timestamp-query` and `rg11b10ufloat-renderable` are enabled automatically
// when present. We only report support via renderer.hasFeature().

import type { RenderTarget, Texture, WebGPURenderer } from 'three/webgpu';

// three's backend types are not exported; describe the narrow surface we touch.
interface BackendTextureData {
  texture?: GPUTexture;
  textureDescriptorGPU?: { format: GPUTextureFormat };
  initialized?: boolean;
}
interface WebGPUBackendLike {
  device: GPUDevice;
  get(object: object): BackendTextureData;
}

function backend(renderer: WebGPURenderer): WebGPUBackendLike {
  const b = (renderer as unknown as { backend: WebGPUBackendLike }).backend;
  if (!b || !b.device) {
    throw new Error('three-internals: renderer.backend not initialized. await renderer.init() first.');
  }
  return b;
}

export function getDevice(renderer: WebGPURenderer): GPUDevice {
  return backend(renderer).device;
}

// Returns the native GPUTexture backing a three Texture. Forces allocation for
// render-target textures that three has not lazily created yet.
export function getGPUTexture(renderer: WebGPURenderer, texture: Texture): GPUTexture {
  const data = backend(renderer).get(texture);
  const gpu = data.texture;
  if (!gpu) {
    throw new Error('three-internals: GPUTexture not allocated. Render the pass, or call ensureRenderTarget, first.');
  }
  return gpu;
}

// The GPU format three assigned to a texture. Used to build raw pipelines whose
// color-attachment format must match exactly (avoids srgb/format guessing).
export function getGPUTextureFormat(renderer: WebGPURenderer, texture: Texture): GPUTextureFormat {
  const data = backend(renderer).get(texture);
  const fmt = data.textureDescriptorGPU?.format;
  if (!fmt) {
    throw new Error('three-internals: texture descriptor not available; texture not initialized.');
  }
  return fmt;
}

// Force allocation of a RenderTarget's GPU textures so a raw pass can write into
// them before three itself has sampled them.
export function ensureRenderTarget(renderer: WebGPURenderer, rt: RenderTarget): void {
  renderer.initRenderTarget(rt);
}
