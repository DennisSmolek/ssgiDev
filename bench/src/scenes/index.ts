import { Registry } from '../harness/registry';
import type { SceneDef } from '../harness/types';
import { cornellScene } from './cornell';
import { sponzaScene } from './sponza';
import { artifactZooScene } from './artifact-zoo';

export const sceneRegistry = new Registry<SceneDef>();
sceneRegistry.register(cornellScene);
sceneRegistry.register(sponzaScene);
sceneRegistry.register(artifactZooScene);
