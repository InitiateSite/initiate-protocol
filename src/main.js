import './fonts.css';
import './tokens.css';
import './styles.css';

import { renderCA, renderSocials, renderLauncher, renderRecords } from './ui/slots.js';
import { initReveal, initScroll, initTilt, initTopHeight, initSpy, initMenu } from './ui/effects.js';
import { initGrid } from './ui/grid.js';
import { initVeil } from './ui/veil.js';
import { initPairs } from './ui/pairs.js';
import { initLiveView } from './ui/liveview.js';
import { startLive } from './live.js';
import { $ } from './ui/dom.js';

// the register-driven slots first, so the contract address is on screen before anything else moves
renderCA();
renderSocials();
renderLauncher();
renderRecords();

initTopHeight();
initMenu();
initSpy();
initLiveView();
initPairs();
initVeil();

const grid = initGrid($('[data-grid]'));
initTilt((x, y) => grid?.lean(x, y));
initScroll();
initReveal();

startLive();
