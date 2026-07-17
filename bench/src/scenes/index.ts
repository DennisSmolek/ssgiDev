import { Registry } from '../harness/registry';
import type { SceneDef } from '../harness/types';
import { cornellScene } from './cornell';

export const sceneRegistry = new Registry<SceneDef>();
sceneRegistry.register(cornellScene);
