import type { WebGPURenderer } from 'three/webgpu';

// Features the bench cares about. SSGINode requires rg11b10ufloat-renderable
// (it errors without it); timestamp-query drives GPU timing.
export const REQUIRED_FEATURES = ['rg11b10ufloat-renderable'] as const;
export const OPTIONAL_FEATURES = [
  'timestamp-query',
  'float32-filterable',
  'shader-f16',
  'depth32float-stencil8',
] as const;

export interface CapabilityReport {
  adapterOk: boolean;
  features: Record<string, boolean>;
  missingRequired: string[];
  hasTimestampQuery: boolean;
}

// Must be called after `await renderer.init()`.
export function probeCapabilities(renderer: WebGPURenderer): CapabilityReport {
  const features: Record<string, boolean> = {};
  const all = [...REQUIRED_FEATURES, ...OPTIONAL_FEATURES];
  for (const name of all) {
    features[name] = renderer.hasFeature(name);
  }
  const missingRequired = REQUIRED_FEATURES.filter((f) => !features[f]);
  return {
    adapterOk: true,
    features,
    missingRequired,
    hasTimestampQuery: features['timestamp-query'] === true,
  };
}
