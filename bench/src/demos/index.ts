import { Registry } from '../harness/registry';
import type { DemoDef } from '../harness/types';
import { gbufferDemo } from './00-gbuffer/index';
import { referenceDemo } from './02-reference/index';

export const demoRegistry = new Registry<DemoDef>();
demoRegistry.register(gbufferDemo);
demoRegistry.register(referenceDemo);
