import { Registry } from '../harness/registry';
import type { DemoDef } from '../harness/types';
import { gbufferDemo } from './00-gbuffer/index';
import { stockThreeDemo } from './01-stock-three/index';
import { referenceDemo } from './02-reference/index';
import { ssrt3Demo } from './03-ssrt3/index';

export const demoRegistry = new Registry<DemoDef>();
demoRegistry.register(gbufferDemo);
demoRegistry.register(stockThreeDemo);
demoRegistry.register(referenceDemo);
demoRegistry.register(ssrt3Demo);
