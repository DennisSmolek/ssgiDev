import { startApp } from './harness/app';
import { demoRegistry } from './demos/index';
import { sceneRegistry } from './scenes/index';

startApp({ demos: demoRegistry, scenes: sceneRegistry }).catch((e) => {
  const msg = document.getElementById('error-msg');
  const el = document.getElementById('error');
  if (msg) msg.textContent = String(e?.stack ?? e);
  el?.classList.add('show');
  console.error(e);
});
