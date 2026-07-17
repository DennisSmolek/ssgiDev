import { Registry } from '../harness/registry';
import type { DemoDef } from '../harness/types';
import { gbufferDemo } from './00-gbuffer/index';
import { stockThreeDemo } from './01-stock-three/index';
import { referenceDemo } from './02-reference/index';
import { sshgiDemo } from './06-sshgi-mathis/index';

export const demoRegistry = new Registry<DemoDef>();
demoRegistry.register(gbufferDemo);
demoRegistry.register(stockThreeDemo);
demoRegistry.register(referenceDemo);
demoRegistry.register(sshgiDemo);
