// A tiny ASCII cat that wanders along the bottom of the screen and sometimes sits.
// Side-profile, drawn facing right; CSS scaleX(-1) flips it when walking left.
const WALK = [
  '  ∧,,,∧\n' +
  ' ( ̳•·• ̳)~\n' +
  '  /   づ',

  '  ∧,,,∧\n' +
  ' ( ̳•·• ̳)~\n' +
  '  ノ   ヽ'
];

const SIT =
  '  ∧,,,∧\n' +
  ' ( ̳-ﻌ- ̳)\n' +
  '  づ づ~';

const SIT_BLINK =
  '  ∧,,,∧\n' +
  ' ( ̳•ﻌ• ̳)\n' +
  '  づ づ~';

export function startCat() {
  const el = document.createElement('pre');
  el.id = 'cat';
  document.getElementById('app').appendChild(el);

  let x = 40;              // px from left
  let dir = 1;             // 1 → right, -1 → left
  let frame = 0;
  let mode = 'walk';       // 'walk' | 'sit'
  let modeTicks = 0;

  const tick = () => {
    modeTicks--;
    if (modeTicks <= 0) {
      if (mode === 'walk' && Math.random() < 0.35) {
        mode = 'sit';
        modeTicks = 8 + Math.floor(Math.random() * 16);   // sit a while
      } else {
        mode = 'walk';
        modeTicks = 10 + Math.floor(Math.random() * 20);
        if (Math.random() < 0.3) dir = -dir;
      }
    }

    if (mode === 'walk') {
      frame ^= 1;
      x += dir * 10;
      const max = window.innerWidth - 150;
      if (x <= 4) { x = 4; dir = 1; }
      if (x >= max) { x = max; dir = -1; }
      el.textContent = WALK[frame];
    } else {
      el.textContent = (frame ^= 1) && Math.random() < 0.15 ? SIT_BLINK : SIT;
    }

    el.style.left = x + 'px';
    el.style.transform = dir === -1 ? 'scaleX(-1)' : '';
  };

  setInterval(tick, 400);
  tick();
}
