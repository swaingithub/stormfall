import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const menu = $('menu');
const howto = $('howto');
const pauseEl = $('pause');
const endEl = $('end');
const clickPlay = $('click-to-play');
const loader = $('loader');
const hud = $('hud');
const optMute = $('opt-mute');
const optMute2 = $('opt-mute2');
const optShadows = $('opt-shadows');
const optBots = $('opt-bots');

const game = new Game(canvas, {
  bots: parseInt(optBots.value, 10),
  shadows: optShadows.checked,
  mute: optMute.checked,
});
window.game = game;

let inMatch = false;

function syncMute(m) {
  optMute.checked = m; optMute2.checked = m;
  game.audio.setMuted(m);
}
optMute.addEventListener('change', () => syncMute(optMute.checked));
optMute2.addEventListener('change', () => syncMute(optMute2.checked));

function updateBotLabel() {
  const total = parseInt(optBots.value, 10) + 1;
  const btn = $('btn-play');
  btn.textContent = `DEPLOY (${total} PLAYERS)`;
}
optBots.addEventListener('input', updateBotLabel);
updateBotLabel();

const modes = [...document.querySelectorAll('.mode')];
for (const m of modes) {
  m.addEventListener('click', () => {
    modes.forEach((x) => x.classList.remove('active'));
    m.classList.add('active');
    optBots.value = m.dataset.bots;
    updateBotLabel();
  });
}

function beginMatch() {
  loader.classList.remove('hidden');
  game.opts.shadows = optShadows.checked;
  game.opts.mute = optMute.checked;

  // Defer heavy build one frame so the loader paints.
  requestAnimationFrame(() => {
    setTimeout(() => {
      game.renderer.shadowMap.enabled = optShadows.checked;
      game.startMatch(parseInt(optBots.value, 10));
      inMatch = true;
      menu.classList.add('hidden');
      endEl.classList.add('hidden');
      pauseEl.classList.add('hidden');
      hud.classList.remove('hidden');
      loader.classList.add('hidden');
      clickPlay.classList.add('hidden');
      game.lockPointer();
    }, 30);
  });
}

$('btn-play').addEventListener('click', beginMatch);
$('btn-again').addEventListener('click', () => { endEl.classList.add('hidden'); beginMatch(); });
$('btn-howto').addEventListener('click', () => howto.classList.remove('hidden'));
$('btn-howto-close').addEventListener('click', () => howto.classList.add('hidden'));

$('btn-resume').addEventListener('click', () => {
  pauseEl.classList.add('hidden');
  game.resume();
});
$('btn-quit').addEventListener('click', () => {
  pauseEl.classList.add('hidden');
  endEl.classList.add('hidden');
  hud.classList.add('hidden');
  menu.classList.remove('hidden');
  game.disposeMatch();
  game.state = 'menu';
  inMatch = false;
  document.exitPointerLock && document.exitPointerLock();
});

// pause when pointer lock is lost
window.addEventListener('request-pause', () => {
  if (!inMatch || game.state !== 'playing') return;
  game.pause();
  pauseEl.classList.remove('hidden');
});

// click canvas to (re)lock
canvas.addEventListener('click', () => {
  if (game.state === 'playing' && !game.locked) game.lockPointer();
});
document.addEventListener('pointerlockchange', () => {
  if (game && game.locked) clickPlay.classList.add('hidden');
});

// end of match
window.addEventListener('match-end', (e) => {
  const d = e.detail;
  inMatch = false;
  document.exitPointerLock && document.exitPointerLock();
  $('end-title').textContent = d.victory ? '#1 VICTORY' : 'ELIMINATED';
  $('end-title').className = d.victory ? 'win' : 'lose';
  $('end-sub').textContent = d.victory ? `Winner out of ${d.total}` : `#${d.place} out of ${d.total}`;
  $('es-kills').textContent = d.kills;
  $('es-damage').textContent = d.damage;
  $('es-time').textContent = d.time;
  $('es-place').textContent = '#' + d.place;
  endEl.classList.remove('hidden');
});

// ensure audio resumes on first gesture
window.addEventListener('pointerdown', () => game.audio.resume(), { once: true });
window.addEventListener('keydown', () => game.audio.resume(), { once: true });

// warn on reload mid-match
window.addEventListener('beforeunload', (e) => {
  if (inMatch) { e.preventDefault(); e.returnValue = ''; }
});
