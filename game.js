(() => {
  'use strict';

  // ================= Canvas setup =================
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  const WORLD_VIEW_WIDTH = 380;
  const scaleFactor = () => W / WORLD_VIEW_WIDTH;
  const chickenScreenY = () => H * 0.6;

  // ================= Helpers =================
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rand = mulberry32((Date.now() ^ 0x9e3779b9) & 0xffffffff);

  function worldToScreen(x, z) {
    return {
      sx: W / 2 + (x - camera.x) * scaleFactor(),
      sy: chickenScreenY() - (z - camera.z) * scaleFactor(),
    };
  }

  // ================= Game modes =================
  const MODE_PARAMS = {
    story: {
      startHalfWidth: 118,
      minHalfWidth: 44,
      narrowRate: 0.02,
      turnBase: 22,
      turnMax: 38,
      difficultyDist: 1600,
      elbowChance: 0.14,
      elbowMul: 1.7,
      pinchChance: 0,
      // A hop of 44 used to exactly equal the narrowest path's half-width,
      // so a single sideways hop could span the *entire* width there with
      // zero margin for error. Shortened for finer control; Difícil keeps
      // the tighter, harder-to-control original.
      hopSide: 34,
    },
    random: {
      startHalfWidth: 108,
      minHalfWidth: 34,
      narrowRate: 0.034,
      turnBase: 30,
      turnMax: 52,
      difficultyDist: 900,
      elbowChance: 0.22,
      elbowMul: 2.1,
      pinchChance: 0.16,
      hopSide: 44,
    },
  };
  let gameMode = 'story';
  const modeParams = () => MODE_PARAMS[gameMode];

  // Jump length: an independent preference layered on top of whichever
  // path/time mode is selected, so "more control" or "more challenge" is
  // available no matter what else you're playing. Expressed as a multiplier
  // on that mode's own hopSide, not a fixed value — this keeps Difícil
  // reliably harder than Historia at every jump-length setting instead of
  // flattening the difference.
  const JUMP_MULTIPLIERS = { short: 0.75, medium: 1, long: 1.3 };
  let jumpLength = 'medium';

  // ================= Path (procedural) =================
  const SEGMENT_LEN = 46;
  const MAX_DRIFT = 128;

  let controlPoints = [];
  let decorations = [];
  let lastGenZ = 0;
  let themeOrder = [0, 1, 2];

  function narrowWidthAt(z) {
    const p = modeParams();
    return Math.max(p.minHalfWidth, p.startHalfWidth - z * p.narrowRate);
  }

  function findSegmentIndex(z) {
    for (let i = 0; i < controlPoints.length - 1; i++) {
      if (z >= controlPoints[i].z && z <= controlPoints[i + 1].z) return i;
    }
    if (controlPoints.length < 2) return 0;
    return z < controlPoints[0].z ? 0 : controlPoints.length - 2;
  }

  function centerAt(z) {
    const i = findSegmentIndex(z);
    const a = controlPoints[i], b = controlPoints[i + 1];
    const t = smoothstep((z - a.z) / (b.z - a.z));
    return lerp(a.x, b.x, t);
  }

  function halfWidthAt(z) {
    const i = findSegmentIndex(z);
    const a = controlPoints[i], b = controlPoints[i + 1];
    const t = smoothstep((z - a.z) / (b.z - a.z));
    return lerp(a.hw, b.hw, t);
  }

  function shuffledThemeOrder() {
    const arr = [0, 1, 2];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function seedPath() {
    const p = modeParams();
    controlPoints = [
      { z: -200, x: 0, hw: p.startHalfWidth },
      { z: 0, x: 0, hw: p.startHalfWidth },
    ];
    decorations = [];
    lastGenZ = 0;
    themeOrder = gameMode === 'random' ? shuffledThemeOrder() : [0, 1, 2];
    extendPathTo(900);
  }

  function extendPathTo(targetZ) {
    const p = modeParams();
    while (lastGenZ < targetZ) {
      const prev = controlPoints[controlPoints.length - 1];
      const z = prev.z + SEGMENT_LEN;
      let hw = narrowWidthAt(z);
      const difficulty = Math.min(1, z / p.difficultyDist);
      const maxTurn = p.turnBase + difficulty * p.turnMax;
      let turn = (rand() * 2 - 1) * maxTurn;
      if (rand() < p.elbowChance) turn *= p.elbowMul;
      let x = prev.x + turn;
      const limit = MAX_DRIFT - hw * 0.2;
      x = clamp(x, -limit, limit);
      if (p.pinchChance && z > 200 && rand() < p.pinchChance) {
        hw = Math.max(p.minHalfWidth * 0.72, hw * (0.55 + rand() * 0.25));
      }
      controlPoints.push({ z, x, hw });
      lastGenZ = z;

      const decoCount = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < decoCount; i++) {
        const dz = prev.z + rand() * SEGMENT_LEN;
        const side = rand() < 0.5 ? -1 : 1;
        const cx = centerAt(dz);
        const hwAt = halfWidthAt(dz);
        decorations.push({
          z: dz,
          x: cx + side * (hwAt + 8 + rand() * 20),
          type: 'bush',
          r: 6 + rand() * 7,
          seed: rand(),
        });
      }
      if (rand() < 0.55) {
        const dz = prev.z + rand() * SEGMENT_LEN;
        const cx = centerAt(dz);
        const hwAt = halfWidthAt(dz);
        decorations.push({
          z: dz,
          x: cx + (rand() * 2 - 1) * hwAt * 0.72,
          type: 'mark',
          seed: rand(),
        });
      }
      // Hearts are placed one per "window" of distance rather than rolled
      // per-segment — a per-segment chance let two spawn right next to each
      // other by pure luck. Window 0 is [1000, 2000), window 1 is
      // [3500, 4500), and it keeps going every HEART_WINDOW_SPACING after
      // that, so a long run always has a chance at more later on. Exactly
      // one random, reachable spot is chosen inside each window as soon as
      // path generation has fully covered it.
      if (gameMode === 'story') {
        const winStart = HEART_WINDOW_START + nextHeartWindowIdx * HEART_WINDOW_SPACING;
        const winEnd = winStart + HEART_WINDOW_WIDTH;
        if (z >= winEnd) {
          const firstLanding = Math.ceil(winStart / HOP_FORWARD) * HOP_FORWARD;
          const lastLanding = Math.floor(winEnd / HOP_FORWARD) * HOP_FORWARD;
          const steps = Math.max(0, Math.round((lastLanding - firstLanding) / HOP_FORWARD));
          const dz = firstLanding + Math.floor(rand() * (steps + 1)) * HOP_FORWARD;
          const cx = centerAt(dz);
          const hwAt = halfWidthAt(dz);
          decorations.push({
            z: dz,
            x: cx + (rand() * 2 - 1) * hwAt * 0.4,
            type: 'heart',
            seed: rand(),
            collected: false,
          });
          nextHeartWindowIdx++;
        }
      }
    }
    // garbage collect old data behind the camera (kept well beyond the
    // largest dynamic render-behind distance used in render(), so tall
    // screens never try to draw a stretch that's already been discarded)
    const behindLimit = chicken.worldZ - 550;
    decorations = decorations.filter((d) => d.z > behindLimit);
    while (controlPoints.length > 3 && controlPoints[1].z < behindLimit) {
      controlPoints.shift();
    }
  }

  // ================= Biomes =================
  const THEMES = [
    { // grass
      outside: '#2a1c10', outside2: '#20150c',
      path: '#7fb257', path2: '#729f4c',
      border: '#8a5a34', borderDark: '#6e4527',
      deco: '#4f8a3a', mark: '#ffffff',
    },
    { // river
      outside: '#122522', outside2: '#0d1c1a',
      path: '#3f97a0', path2: '#357f88',
      border: '#8a5a34', borderDark: '#6e4527',
      deco: '#2f6e73', mark: '#dff3f4',
    },
    { // canyon
      outside: '#2c1810', outside2: '#20110b',
      path: '#d9a35f', path2: '#c48f4e',
      border: '#6b4a3a', borderDark: '#4f362a',
      deco: '#8a5f3a', mark: '#f4e0b8',
    },
  ];
  const BIOME_LEN = 150;
  const BIOME_BLEND = 30;

  function lerpColor(c1, c2, t) {
    const p1 = parseInt(c1.slice(1), 16), p2 = parseInt(c2.slice(1), 16);
    const r1 = (p1 >> 16) & 255, g1 = (p1 >> 8) & 255, b1 = p1 & 255;
    const r2 = (p2 >> 16) & 255, g2 = (p2 >> 8) & 255, b2 = p2 & 255;
    const r = Math.round(lerp(r1, r2, t)), g = Math.round(lerp(g1, g2, t)), b = Math.round(lerp(b1, b2, t));
    return `rgb(${r},${g},${b})`;
  }

  function themeAt(z) {
    const zc = Math.max(0, z);
    const idx = Math.floor(zc / BIOME_LEN);
    const posInBiome = zc - idx * BIOME_LEN;
    const a = THEMES[themeOrder[idx % themeOrder.length]];
    const b = THEMES[themeOrder[(idx + 1) % themeOrder.length]];
    if (posInBiome > BIOME_LEN - BIOME_BLEND) {
      const t = (posInBiome - (BIOME_LEN - BIOME_BLEND)) / BIOME_BLEND;
      return blendTheme(a, b, t);
    }
    return a;
  }

  function blendTheme(a, b, t) {
    const out = {};
    for (const k in a) out[k] = lerpColor(a[k], b[k], t);
    return out;
  }

  // ================= Game state =================
  const chicken = {
    worldX: 0, worldZ: 0,
    fromX: 0, fromZ: 0, toX: 0, toZ: 0,
    animT: 1, facing: -1, alive: true,
  };
  const camera = { x: 0, z: 0 };
  const HOP_FORWARD = 30;
  const HOP_DURATION = 0.15;
  const HOP_HEIGHT = 15;

  // Extra lives (Historia mode only): hearts appear on the path as you play.
  // Landing on one banks a life (up to MAX_EXTRA_LIVES); falling off the
  // path with a life banked consumes one and respawns you in place instead
  // of ending the run.
  const MAX_EXTRA_LIVES = 2;
  let extraLives = 0;
  let damageFlash = 0; // 0..1, fades out after losing a life

  const HEART_WINDOW_START = 1000; // first window: [1000, 2000)
  const HEART_WINDOW_WIDTH = 1000;
  const HEART_WINDOW_SPACING = 2500; // next window starts 2500 later: [3500, 4500), ...
  let nextHeartWindowIdx = 0;

  let hopping = false;
  let pendingDir = 0;
  let hopCount = 0;
  let distance = 0;
  let timeMode = 'normal'; // normal | time
  let timeLimit = 30; // seconds, only relevant when timeMode === 'time'
  let remainingTime = 0;
  let endReason = 'fell'; // 'fell' | 'timeup', decides the game-over heading
  const bestCache = {};

  function bestKey() {
    return timeMode === 'time' ? `${gameMode}_t${timeLimit}` : gameMode;
  }
  function getBest(key) {
    if (!(key in bestCache)) {
      bestCache[key] = Number(localStorage.getItem('chickenHopBest_' + key) || 0);
    }
    return bestCache[key];
  }
  function setBest(key, value) {
    bestCache[key] = value;
    localStorage.setItem('chickenHopBest_' + key, String(value));
  }

  let state = 'start'; // start | playing | dead
  let deathT = 0;
  let particles = [];
  let lastTime = performance.now();

  // "Mejor" in the HUD shows the *global* leaderboard's best for the current
  // mode, not just this device's — more meaningful to compare against.
  // getBest()/setBest() (this device's own history) still drive the
  // "¡Nuevo récord!" badge on the game-over screen, which is deliberately
  // personal and works offline; only the HUD number changes here.
  const globalBestCache = {};

  function updateBestUI() {
    const key = bestKey();
    const val = key in globalBestCache ? globalBestCache[key] : getBest(key);
    document.getElementById('best').textContent = `Mejor: ${Math.floor(val)} m`;
  }
  updateBestUI();

  async function refreshGlobalBest() {
    if (!window.ChickenLeaderboard) return;
    const key = bestKey();
    const mode = gameMode, tMode = timeMode, tLimit = timeLimit;
    const category = window.ChickenLeaderboard.categoryOf(mode, tMode);
    try {
      const top = await window.ChickenLeaderboard.fetchTop(category, 50);
      const matching = top.filter((s) =>
        s.mode === mode && s.timeMode === tMode && (tMode !== 'time' || s.timeLimit === tLimit)
      );
      globalBestCache[key] = matching.length ? Math.floor(matching[0].score) : 0;
    } catch (e) { /* offline or unreachable — keep whatever was cached, if anything */ }
    if (bestKey() === key) updateBestUI();
  }
  refreshGlobalBest();

  function formatTime(t) {
    const s = Math.max(0, Math.ceil(t));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' : ''}${r}`;
  }

  function updateTimerUI() {
    const el = document.getElementById('timer');
    if (timeMode !== 'time' || state !== 'playing') {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.textContent = formatTime(remainingTime);
    el.classList.toggle('urgent', remainingTime <= 10);
  }

  function updateLivesUI() {
    const el = document.getElementById('lives');
    if (gameMode !== 'story' || state !== 'playing') {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    let hearts = '';
    for (let i = 0; i < MAX_EXTRA_LIVES; i++) hearts += i < extraLives ? '❤️' : '🤍';
    el.textContent = hearts;
  }

  function resetGame() {
    chicken.worldX = 0; chicken.worldZ = 0;
    chicken.fromX = 0; chicken.fromZ = 0; chicken.toX = 0; chicken.toZ = 0;
    chicken.animT = 1; chicken.facing = -1; chicken.alive = true;
    camera.x = 0; camera.z = 0;
    hopping = false; pendingDir = 0; hopCount = 0;
    distance = 0; deathT = 0;
    remainingTime = timeLimit;
    endReason = 'fell';
    extraLives = 0; damageFlash = 0; nextHeartWindowIdx = 0;
    particles = [];
    rand = mulberry32((Date.now() ^ 0x9e3779b9) & 0xffffffff);
    seedPath();
    updateDistanceUI(true);
    updateTimerUI();
    updateLivesUI();
  }

  function startHop(dir) {
    hopping = true;
    chicken.fromX = chicken.worldX;
    chicken.fromZ = chicken.worldZ;
    chicken.toX = chicken.worldX + dir * modeParams().hopSide * JUMP_MULTIPLIERS[jumpLength];
    chicken.toZ = chicken.worldZ + HOP_FORWARD;
    chicken.facing = dir;
    chicken.animT = 0;
    beep(520, 0.05, 0.03);
    hopCount++;
    if (hopCount % 2 === 0) cluck();
  }

  function tryHop(dir) {
    if (state !== 'playing') return;
    if (!chicken.alive) return;
    if (hopping) { pendingDir = dir; return; }
    startHop(dir);
  }

  function checkAlive() {
    const c = centerAt(chicken.worldZ);
    const hw = halfWidthAt(chicken.worldZ);
    if (chicken.worldX < c - hw || chicken.worldX > c + hw) {
      die();
    }
  }

  function die() {
    if (!chicken.alive) return;
    if (gameMode === 'story' && extraLives > 0) {
      respawnWithLostLife();
      return;
    }
    chicken.alive = false;
    deathT = 0;
    endReason = 'fell';
    beep(160, 0.25, 0.08);
    navigator.vibrate && navigator.vibrate(60);
  }

  // Falling off the path with a banked life: snap back to the safe center
  // of the path at the same point instead of ending the run.
  function respawnWithLostLife() {
    extraLives--;
    updateLivesUI();
    chicken.worldX = centerAt(chicken.worldZ);
    spawnDust(chicken.worldX, chicken.worldZ);
    damageFlash = 0.5;
    beep(220, 0.2, 0.07);
    navigator.vibrate && navigator.vibrate([30, 40, 30]);
  }

  function checkHeartPickup() {
    for (const d of decorations) {
      if (d.type !== 'heart' || d.collected) continue;
      const dx = d.x - chicken.worldX;
      const dz = d.z - chicken.worldZ;
      if (dx * dx + dz * dz < 18 * 18) {
        d.collected = true;
        extraLives = Math.min(MAX_EXTRA_LIVES, extraLives + 1);
        updateLivesUI();
        beep(760, 0.1, 0.05);
      }
    }
  }

  function spawnDust(x, z) {
    for (let i = 0; i < 5; i++) {
      particles.push({
        x: x + (rand() * 2 - 1) * 8,
        z: z + (rand() * 2 - 1) * 8,
        vx: (rand() * 2 - 1) * 30,
        vz: (rand() * 2 - 1) * 30,
        life: 0.35 + rand() * 0.15,
        t: 0,
        r: 3 + rand() * 3,
      });
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
    }
    particles = particles.filter((p) => p.t < p.life);
  }

  function updateDistanceUI(force) {
    const shown = Math.floor(distance);
    const el = document.getElementById('distance');
    if (force || el.dataset.val !== String(shown)) {
      el.textContent = shown + ' m';
      el.dataset.val = String(shown);
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    }
  }

  // ================= Input =================
  document.getElementById('zoneLeft').addEventListener('pointerdown', (e) => { e.preventDefault(); tryHop(-1); }, { passive: false });
  document.getElementById('zoneRight').addEventListener('pointerdown', (e) => { e.preventDefault(); tryHop(1); }, { passive: false });

  // iOS Safari can still trigger zoom on fast alternating left/right taps
  // even with touch-action:none. Guarded in two ways:
  //
  // 1) Genuine two-finger pinch: caught by the CSS touch-action:none already
  //    on the tap zones (which blocks native pinch-zoom/pan from starting
  //    there at all) plus these legacy WebKit gesture events as a backstop.
  //    An earlier version also cancelled touchstart/touchmove whenever two
  //    touches were simultaneously active, to catch a left finger not fully
  //    lifted before the right one lands — but that punished exactly the
  //    rapid alternating taps this game requires: cancelling that touchstart
  //    could suppress the second finger's tap from registering as a hop at
  //    all, not just block the zoom. Gameplay responsiveness matters more
  //    than that edge case, so it's gone.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());

  // 2) Double-tap-to-zoom: iOS sometimes commits to this gesture a moment
  //    after the tap that triggered it (the zoom visibly lands after you've
  //    already lifted your finger). Guessing its internal timing window is
  //    unreliable, so instead: taps here are only ever read via pointerdown,
  //    nothing depends on the browser's own touchend/click handling of them,
  //    so it's safe to unconditionally swallow every touchend in this zone.
  document.getElementById('tapZones').addEventListener('touchend', (e) => {
    e.preventDefault();
  }, { passive: false });

  // 3) Same double-tap-to-zoom, but on ordinary <button> elements (JUGAR,
  //    the scroll arrows, category tabs...). Those rely on the browser's own
  //    'click' event, so they can't unconditionally swallow every touchend
  //    the way #tapZones does (that would silently kill every tap, since
  //    preventDefault() on touchend suppresses the synthetic click that
  //    follows it). Instead, only swallow a touchend that lands within the
  //    OS's double-tap window of the previous one on that same button — the
  //    first tap's click still fires normally, only a genuine rapid second
  //    tap (the actual zoom trigger) gets cancelled.
  document.querySelectorAll('button').forEach((btn) => {
    let lastTouchEnd = 0;
    btn.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouchEnd < 400) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') tryHop(-1);
    if (e.code === 'ArrowRight' || e.code === 'KeyD') tryHop(1);
    if (e.code === 'Space' && state !== 'playing') {
      if (state === 'start') beginGame();
      else if (state === 'dead') beginGame();
    }
  });

  function beginGame() {
    resetGame();
    state = 'playing';
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    updateTimerUI();
    updateLivesUI();
    updateBestUI();
    refreshGlobalBest();
  }

  document.getElementById('startBtn').addEventListener('click', beginGame);
  document.getElementById('retryBtn').addEventListener('click', beginGame);
  document.getElementById('menuBtn').addEventListener('click', () => {
    state = 'start';
    document.getElementById('gameOverScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
    updateBestUI();
  });

  // ---- Share card (drawn on an offscreen canvas, no external libraries) ----
  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawShareChicken(c, cx, cy, bodyR) {
    c.save();
    c.translate(cx, cy);

    c.globalAlpha = 0.22;
    c.fillStyle = '#000000';
    c.beginPath();
    c.ellipse(0, bodyR * 0.95, bodyR * 0.8, bodyR * 0.28, 0, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;

    c.fillStyle = '#2b2b3a';
    c.beginPath();
    c.moveTo(bodyR * 0.55, -bodyR * 0.25);
    c.lineTo(bodyR * 1.35, 0);
    c.lineTo(bodyR * 0.55, bodyR * 0.35);
    c.closePath();
    c.fill();

    c.beginPath();
    c.ellipse(0, 0, bodyR, bodyR, 0, 0, Math.PI * 2);
    c.fillStyle = '#ffffff';
    c.fill();
    c.lineWidth = bodyR * 0.1;
    c.strokeStyle = '#231a12';
    c.stroke();

    c.save();
    c.beginPath();
    c.ellipse(bodyR * 0.28, bodyR * 0.05, bodyR * 0.42, bodyR * 0.26, -0.15, 0, Math.PI * 2);
    c.fillStyle = '#ded2bd';
    c.fill();
    c.lineWidth = bodyR * 0.06;
    c.strokeStyle = '#231a12';
    c.stroke();
    c.restore();

    c.fillStyle = '#e8432c';
    for (let k = -1; k <= 1; k++) {
      c.beginPath();
      c.arc(-bodyR * 0.28 + k * bodyR * 0.24, -bodyR * 0.82, bodyR * 0.22, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = '#231a12';
    c.lineWidth = bodyR * 0.055;
    for (let k = -1; k <= 1; k++) {
      c.beginPath();
      c.arc(-bodyR * 0.28 + k * bodyR * 0.24, -bodyR * 0.82, bodyR * 0.22, 0, Math.PI * 2);
      c.stroke();
    }

    c.fillStyle = '#e8432c';
    c.beginPath();
    c.arc(-bodyR * 0.62, bodyR * 0.28, bodyR * 0.16, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#231a12';
    c.lineWidth = bodyR * 0.045;
    c.stroke();

    c.fillStyle = '#f4a83c';
    c.beginPath();
    c.moveTo(-bodyR * 0.62, -bodyR * 0.05);
    c.lineTo(-bodyR * 1.05, bodyR * 0.08);
    c.lineTo(-bodyR * 0.6, bodyR * 0.22);
    c.closePath();
    c.fill();
    c.strokeStyle = '#231a12';
    c.lineWidth = bodyR * 0.055;
    c.stroke();

    c.fillStyle = '#1c1c1c';
    c.beginPath();
    c.arc(-bodyR * 0.32, -bodyR * 0.18, bodyR * 0.11, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(-bodyR * 0.29, -bodyR * 0.22, bodyR * 0.04, 0, Math.PI * 2);
    c.fill();

    c.strokeStyle = '#f4a83c';
    c.lineWidth = bodyR * 0.11;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-bodyR * 0.15, bodyR * 0.85);
    c.lineTo(-bodyR * 0.15, bodyR * 1.12);
    c.moveTo(bodyR * 0.2, bodyR * 0.85);
    c.lineTo(bodyR * 0.2, bodyR * 1.12);
    c.stroke();

    c.restore();
  }

  async function buildShareCard(finalM, titleText, modeText, isRecord) {
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (e) { /* ignore */ }
    }
    const W2 = 1000, H2 = 1250;
    const cv = document.createElement('canvas');
    cv.width = W2; cv.height = H2;
    const c = cv.getContext('2d');
    const FONT = '"Baloo 2", "Arial Rounded MT Bold", sans-serif';

    const grad = c.createLinearGradient(0, 0, 0, H2);
    grad.addColorStop(0, '#8ec766');
    grad.addColorStop(1, '#4f8a3a');
    c.fillStyle = grad;
    c.fillRect(0, 0, W2, H2);

    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';

    c.font = `800 60px ${FONT}`;
    c.lineWidth = 10;
    c.strokeStyle = '#3a1d0e';
    c.fillStyle = '#fffaf0';
    c.strokeText('CHICKEN HOP', W2 / 2, 110);
    c.fillText('CHICKEN HOP', W2 / 2, 110);

    const panelX = 70, panelY = 160, panelW = W2 - 140, panelH = 940;
    roundRectPath(c, panelX, panelY, panelW, panelH, 50);
    c.fillStyle = '#fffaf0';
    c.fill();
    c.lineWidth = 9;
    c.strokeStyle = '#2b1d13';
    c.stroke();

    drawShareChicken(c, W2 / 2, panelY + 190, 140);

    c.font = `800 48px ${FONT}`;
    c.fillStyle = '#2b1d13';
    c.fillText(titleText, W2 / 2, panelY + 400);

    c.font = `700 26px ${FONT}`;
    c.fillStyle = '#8a7a68';
    c.fillText('TU DISTANCIA', W2 / 2, panelY + 460);

    c.font = `800 150px ${FONT}`;
    c.fillStyle = '#2b1d13';
    c.fillText(finalM + ' m', W2 / 2, panelY + 630);

    let nextY = panelY + 710;
    if (isRecord) {
      const label = '¡Nuevo récord!';
      c.font = `700 30px ${FONT}`;
      const tw = c.measureText(label).width;
      const bw = tw + 70, bh = 62;
      roundRectPath(c, W2 / 2 - bw / 2, nextY - 44, bw, bh, 30);
      c.fillStyle = '#4a3520';
      c.fill();
      c.fillStyle = '#ffb400';
      c.fillText(label, W2 / 2, nextY);
      nextY += 90;
    }

    c.font = `700 34px ${FONT}`;
    c.fillStyle = '#4a3a2c';
    c.fillText(modeText, W2 / 2, nextY);

    c.font = `700 26px ${FONT}`;
    c.fillStyle = '#fffaf0';
    c.globalAlpha = 0.9;
    c.fillText('¡Juega tú también! 🐔', W2 / 2, H2 - 50);
    c.globalAlpha = 1;

    return cv;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  function modeLabelOf(mode) {
    return mode === 'random' ? 'Difícil' : 'Historia';
  }
  function modeTextOf(mode, tMode, tLimit) {
    const timeLabel = tMode === 'time' ? ` · ⏱️ ${formatTime(tLimit)}` : '';
    return `${modeLabelOf(mode)}${timeLabel}`;
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  const shareBtn = document.getElementById('shareBtn');
  if (navigator.share) {
    shareBtn.classList.remove('hidden');
    shareBtn.addEventListener('click', async () => {
      const finalM = Math.floor(distance);
      const modeText = modeTextOf(gameMode, timeMode, timeLimit);
      const titleText = document.getElementById('gameOverTitle').textContent;
      const isRecord = !document.getElementById('newRecord').classList.contains('hidden');
      const shareText = `🐔 ¡Llegué a ${finalM} m en Chicken Hop! (${modeText}) ¿Puedes superarlo?`;

      let payload = { title: 'Chicken Hop', text: shareText, url: location.href };
      try {
        const canvas = await buildShareCard(finalM, titleText, modeText, isRecord);
        const blob = await canvasToBlob(canvas);
        if (blob) {
          const file = new File([blob], 'chicken-hop.png', { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            payload = { title: 'Chicken Hop', text: shareText, files: [file] };
          }
        }
      } catch (e) { /* image generation failed, fall back to text+url share */ }

      try {
        await navigator.share(payload);
      } catch (e) { /* user cancelled the share sheet, nothing to do */ }
    });
  }

  // ---- Global leaderboard (Firebase, see leaderboard.js) ----
  document.getElementById('submitScoreBtn').addEventListener('click', async () => {
    const btn = document.getElementById('submitScoreBtn');
    const nameInput = document.getElementById('playerName');
    const name = nameInput.value.trim() || 'Anónimo';
    localStorage.setItem('chickenHopPlayerName', name);

    if (!window.ChickenLeaderboard) {
      btn.textContent = '⚠️ Sin conexión al ranking';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
      await window.ChickenLeaderboard.submitScore({
        name,
        score: distance,
        mode: gameMode,
        timeMode,
        timeLimit,
        jumpLength,
      });
      btn.textContent = '✓ ¡Publicado!';
      refreshGlobalBest();
    } catch (e) {
      btn.textContent = '⚠️ Error al enviar';
      btn.disabled = false;
    }
  });

  async function loadLeaderboard(category) {
    document.querySelectorAll('.lbCatBtn').forEach((b) => {
      b.classList.toggle('active', b.dataset.category === category);
    });
    const listEl = document.getElementById('leaderboardList');
    listEl.innerHTML = '<p class="loadingText">Cargando...</p>';
    listEl.scrollTop = 0;

    if (!window.ChickenLeaderboard) {
      listEl.innerHTML = '<p class="loadingText">Sin conexión al ranking.</p>';
      updateLbScrollButtons();
      return;
    }
    try {
      const scores = await window.ChickenLeaderboard.fetchTop(category, 10);
      if (!scores.length) {
        listEl.innerHTML = '<p class="loadingText">Todavía no hay puntuaciones. ¡Sé el primero!</p>';
        updateLbScrollButtons();
        return;
      }
      listEl.innerHTML = scores.map((s, i) => `
        <div class="leaderboardRow">
          <span class="rank">${i + 1}</span>
          <span class="lbInfo">
            <span class="lbName">${escapeHtml(s.name)}</span>
            <span class="lbMode">${escapeHtml(modeTextOf(s.mode, s.timeMode, s.timeLimit))}${s.jumpLength ? ' · ' + escapeHtml(JUMP_LABELS[s.jumpLength] || s.jumpLength) : ''}</span>
          </span>
          <span class="lbScore">${Math.floor(s.score)} m</span>
        </div>
      `).join('');
    } catch (e) {
      listEl.innerHTML = '<p class="loadingText">No se pudo cargar el ranking.</p>';
    }
    updateLbScrollButtons();
  }

  // Clamp to the list's actual scrollable range instead of trusting the
  // browser to clamp an out-of-range smooth-scroll request — asking it to
  // scroll past the end repeatedly was what made the list glitch/vanish.
  function scrollLeaderboardBy(delta) {
    const el = document.getElementById('leaderboardList');
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    const target = Math.max(0, Math.min(maxScroll, el.scrollTop + delta));
    el.scrollTo({ top: target, behavior: 'smooth' });
  }

  function updateLbScrollButtons() {
    const el = document.getElementById('leaderboardList');
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    document.getElementById('lbScrollUp').disabled = el.scrollTop <= 0;
    document.getElementById('lbScrollDown').disabled = el.scrollTop >= maxScroll - 1;
  }

  document.querySelectorAll('.lbCatBtn').forEach((btn) => {
    btn.addEventListener('click', () => loadLeaderboard(btn.dataset.category));
  });

  document.getElementById('viewLeaderboardBtn').addEventListener('click', () => {
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('leaderboardScreen').classList.remove('hidden');
    const defaultCategory = window.ChickenLeaderboard
      ? window.ChickenLeaderboard.categoryOf(gameMode, timeMode)
      : 'story';
    loadLeaderboard(defaultCategory);
  });

  document.getElementById('closeLeaderboardBtn').addEventListener('click', () => {
    document.getElementById('leaderboardScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
  });

  document.getElementById('lbScrollUp').addEventListener('click', () => scrollLeaderboardBy(-160));
  document.getElementById('lbScrollDown').addEventListener('click', () => scrollLeaderboardBy(160));
  document.getElementById('leaderboardList').addEventListener('scroll', updateLbScrollButtons);

  const MODE_DESCRIPTIONS = {
    story: 'Camino clásico, dificultad progresiva.',
    random: 'Curvas cerradas y estrechones impredecibles.',
  };
  document.querySelectorAll('#modeToggle .modeBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      gameMode = btn.dataset.mode;
      document.querySelectorAll('#modeToggle .modeBtn').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('modeDesc').textContent = MODE_DESCRIPTIONS[gameMode];
      updateBestUI();
      refreshGlobalBest();
    });
  });

  document.querySelectorAll('#timeToggle .modeBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      timeMode = btn.dataset.timemode;
      document.querySelectorAll('#timeToggle .modeBtn').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('timeLimits').classList.toggle('hidden', timeMode !== 'time');
      updateBestUI();
      refreshGlobalBest();
    });
  });

  document.querySelectorAll('.timeBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      timeLimit = Number(btn.dataset.time);
      document.querySelectorAll('.timeBtn').forEach((b) => b.classList.toggle('active', b === btn));
      updateBestUI();
      refreshGlobalBest();
    });
  });

  const JUMP_DESCRIPTIONS = {
    short: 'Saltos cortos: más control y precisión.',
    medium: 'Equilibrado — el salto tal y como está pensado el juego.',
    long: 'Saltos largos: más difícil de controlar.',
  };
  const JUMP_LABELS = { short: 'Corto', medium: 'Medio', long: 'Largo' };
  document.querySelectorAll('.jumpBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      jumpLength = btn.dataset.jump;
      document.querySelectorAll('.jumpBtn').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('jumpDesc').textContent = JUMP_DESCRIPTIONS[jumpLength];
    });
  });

  function showGameOver() {
    state = 'dead';
    const finalM = Math.floor(distance);
    document.getElementById('finalScore').textContent = finalM + ' m';
    document.getElementById('gameOverTitle').textContent =
      endReason === 'timeup' ? '¡SE ACABÓ EL TIEMPO!' : '¡BIEN JUGADO!';

    // Local personal best: your own device's history, always available.
    const key = bestKey();
    const isPersonalRecord = finalM > getBest(key);
    if (isPersonalRecord) setBest(key, finalM);
    updateBestUI();
    updateTimerUI();
    updateLivesUI();
    document.getElementById('newRecord').classList.toggle('hidden', !isPersonalRecord);

    // Global leaderboard: separate concern, checked against the actual
    // database (would this score place in that category's top 10?) rather
    // than against your local best, which can easily be out of sync with
    // what's really in the shared board.
    document.getElementById('submitScore').classList.add('hidden');
    checkLeaderboardQualification(finalM, gameMode, timeMode);

    document.getElementById('gameOverScreen').classList.remove('hidden');
  }

  async function checkLeaderboardQualification(finalM, mode, tMode) {
    if (!window.ChickenLeaderboard) return;
    const category = window.ChickenLeaderboard.categoryOf(mode, tMode);
    try {
      const qualifies = await window.ChickenLeaderboard.qualifiesForTop(category, finalM, 10);
      // The player may have already started a new run by the time this
      // resolves — only reveal the prompt if we're still on that same run's
      // game-over screen.
      if (qualifies && state === 'dead' && Math.floor(distance) === finalM) {
        const submitBtn = document.getElementById('submitScoreBtn');
        document.getElementById('playerName').value = localStorage.getItem('chickenHopPlayerName') || '';
        submitBtn.disabled = false;
        submitBtn.textContent = '🏆 Subir al ranking';
        document.getElementById('submitScore').classList.remove('hidden');
      }
    } catch (e) { /* leaderboard unreachable, just don't offer to submit */ }
  }

  // ================= Audio (tiny synth, no assets) =================
  let actx = null;
  function beep(freq, duration, vol) {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g); g.connect(actx.destination);
      const now = actx.currentTime;
      g.gain.setValueAtTime(vol, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + duration);
      o.start(now);
      o.stop(now + duration);
    } catch (e) { /* audio not available */ }
  }

  function cluck() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      const now = actx.currentTime;

      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(780, now);
      o.frequency.exponentialRampToValueAtTime(260, now + 0.085);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.055, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      o.connect(g); g.connect(actx.destination);
      o.start(now);
      o.stop(now + 0.14);

      const bufSize = Math.floor(actx.sampleRate * 0.05);
      const buf = actx.createBuffer(1, bufSize, actx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      const noise = actx.createBufferSource();
      noise.buffer = buf;
      const nf = actx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 500;
      const ng = actx.createGain();
      ng.gain.setValueAtTime(0.04, now);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
      noise.connect(nf); nf.connect(ng); ng.connect(actx.destination);
      noise.start(now);
    } catch (e) { /* audio not available */ }
  }

  // ================= Update =================
  function update(dt) {
    if (state !== 'playing') return;

    if (chicken.alive) {
      if (hopping) {
        chicken.animT += dt / HOP_DURATION;
        if (chicken.animT >= 1) {
          chicken.animT = 1;
          chicken.worldX = chicken.toX;
          chicken.worldZ = chicken.toZ;
          hopping = false;
          spawnDust(chicken.worldX, chicken.worldZ);
          checkAlive();
          if (chicken.alive && gameMode === 'story') checkHeartPickup();
          if (chicken.alive && pendingDir !== 0) {
            const d = pendingDir; pendingDir = 0; startHop(d);
          } else {
            pendingDir = 0;
          }
        } else {
          const t = smoothstep(chicken.animT);
          chicken.worldX = lerp(chicken.fromX, chicken.toX, t);
          chicken.worldZ = lerp(chicken.fromZ, chicken.toZ, t);
        }
      }
      distance = Math.max(distance, chicken.worldZ);
      updateDistanceUI(false);
      extendPathTo(chicken.worldZ + 900);
      if (damageFlash > 0) damageFlash = Math.max(0, damageFlash - dt * 2);

      const camSmooth = 1 - Math.pow(0.001, dt);
      camera.x += (chicken.worldX - camera.x) * camSmooth;
      camera.z += (chicken.worldZ - camera.z) * camSmooth;

      if (timeMode === 'time') {
        remainingTime -= dt;
        updateTimerUI();
        if (remainingTime <= 0) {
          remainingTime = 0;
          endReason = 'timeup';
          showGameOver();
        }
      }
    } else {
      deathT += dt;
      camera.z += (chicken.worldZ - camera.z) * 0.08;
      if (deathT > 0.9) {
        showGameOver();
      }
    }
    updateParticles(dt);
  }

  // ================= Drawing =================
  function drawPath(behind, ahead) {
    const theme = themeAt(camera.z);
    ctx.fillStyle = theme.outside;
    ctx.fillRect(0, 0, W, H);

    const step = 8;
    const zStart = camera.z - behind;
    const zEnd = camera.z + ahead;

    const leftPts = [], rightPts = [];
    for (let z = zStart; z <= zEnd; z += step) {
      const c = centerAt(z);
      const hw = halfWidthAt(z);
      const l = worldToScreen(c - hw, z);
      const r = worldToScreen(c + hw, z);
      leftPts.push(l);
      rightPts.push(r);
    }

    // path fill
    ctx.beginPath();
    ctx.moveTo(leftPts[0].sx, leftPts[0].sy);
    for (let i = 1; i < leftPts.length; i++) ctx.lineTo(leftPts[i].sx, leftPts[i].sy);
    for (let i = rightPts.length - 1; i >= 0; i--) ctx.lineTo(rightPts[i].sx, rightPts[i].sy);
    ctx.closePath();
    ctx.fillStyle = theme.path;
    ctx.fill();

    // borders (planks)
    drawBorder(leftPts, theme, -1);
    drawBorder(rightPts, theme, 1);
  }

  function drawBorder(pts, theme, side) {
    const s = scaleFactor();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = Math.max(4, 16 * s);
    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
    ctx.stroke();

    ctx.strokeStyle = theme.borderDark;
    ctx.lineWidth = Math.max(2, 5 * s);
    ctx.setLineDash([Math.max(4, 10 * s), Math.max(4, 10 * s)]);
    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawHeartShape(cx, cy, size) {
    const x = cx, y = cy - size * 0.6;
    const top = size * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, y + top);
    ctx.bezierCurveTo(x, y, x - size / 2, y, x - size / 2, y + top);
    ctx.bezierCurveTo(x - size / 2, y + (size + top) / 2, x, y + (size + top) / 2, x, y + size);
    ctx.bezierCurveTo(x, y + (size + top) / 2, x + size / 2, y + (size + top) / 2, x + size / 2, y + top);
    ctx.bezierCurveTo(x + size / 2, y, x, y, x, y + top);
    ctx.closePath();
    ctx.fillStyle = '#e8432c';
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.14);
    ctx.strokeStyle = '#231a12';
    ctx.stroke();
  }

  function drawDecorations(behind, ahead) {
    const theme = themeAt(camera.z);
    const s = scaleFactor();
    for (const d of decorations) {
      if (d.z < camera.z - behind || d.z > camera.z + ahead) continue;
      const p = worldToScreen(d.x, d.z);
      if (p.sy < -40 || p.sy > H + 40) continue;
      if (d.type === 'bush') {
        ctx.fillStyle = theme.deco;
        const r = d.r * s;
        ctx.beginPath();
        ctx.arc(p.sx - r * 0.5, p.sy, r * 0.7, 0, Math.PI * 2);
        ctx.arc(p.sx + r * 0.5, p.sy, r * 0.7, 0, Math.PI * 2);
        ctx.arc(p.sx, p.sy - r * 0.4, r * 0.75, 0, Math.PI * 2);
        ctx.fill();
      } else if (d.type === 'mark') {
        ctx.fillStyle = theme.mark;
        ctx.globalAlpha = 0.85;
        const r = 3.2 * s;
        for (let k = 0; k < 4; k++) {
          const ang = (Math.PI / 2) * k + d.seed * 6;
          ctx.beginPath();
          ctx.ellipse(p.sx + Math.cos(ang) * r, p.sy + Math.sin(ang) * r * 0.7, r * 0.65, r * 0.4, ang, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (d.type === 'heart' && !d.collected) {
        const bob = Math.sin(performance.now() / 260 + d.seed * 10) * 3 * s;
        drawHeartShape(p.sx, p.sy + bob, 17 * s);
      }
    }
  }

  function drawParticles() {
    const s = scaleFactor();
    for (const p of particles) {
      const pos = worldToScreen(p.x, p.z);
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = a * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(pos.sx, pos.sy, p.r * s * a, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawChicken() {
    const s = scaleFactor();
    let x = chicken.worldX, z = chicken.worldZ;
    const t = chicken.animT;
    const bob = chicken.alive ? Math.sin(clamp(t, 0, 1) * Math.PI) * HOP_HEIGHT : 0;

    let squashX = 1, squashY = 1, tilt = 0;
    if (chicken.alive) {
      if (t < 0.18) { const k = 1 - t / 0.18; squashY = 1 - 0.22 * k; squashX = 1 + 0.18 * k; }
      else if (t > 0.82) { const k = (t - 0.82) / 0.18; squashY = 1 - 0.22 * k; squashX = 1 + 0.18 * k; }
      else { squashY = 1.08; squashX = 0.94; }
      tilt = Math.sin(clamp(t, 0, 1) * Math.PI) * 0.18 * chicken.facing;
    }

    const pos = worldToScreen(x, z);
    const sy = pos.sy - bob * s;
    const R = 17 * s;

    let deathScale = 1, deathAlpha = 1, deathRot = 0;
    if (!chicken.alive) {
      const dt2 = clamp(deathT / 0.9, 0, 1);
      deathScale = 1 - dt2 * 0.5;
      deathAlpha = 1 - dt2;
      deathRot = dt2 * 2.2 * (chicken.facing || 1);
    }

    // shadow
    ctx.globalAlpha = 0.28 * deathAlpha;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(pos.sx, pos.sy + R * 0.65, R * 0.85 * squashX, R * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(pos.sx, sy + (chicken.alive ? R * 0.62 * (1 - squashY) : 0));
    ctx.rotate(tilt + deathRot);
    ctx.scale((chicken.facing >= 0 ? 1 : -1) * deathScale, deathScale);
    ctx.globalAlpha = deathAlpha;

    const bodyR = R;

    // tail (dark triangle)
    ctx.fillStyle = '#2b2b3a';
    ctx.beginPath();
    ctx.moveTo(bodyR * 0.55, -bodyR * 0.25);
    ctx.lineTo(bodyR * 1.35, 0);
    ctx.lineTo(bodyR * 0.55, bodyR * 0.35);
    ctx.closePath();
    ctx.fill();

    // body
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyR * squashX, bodyR * squashY, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = Math.max(1.4, bodyR * 0.11);
    ctx.strokeStyle = '#231a12';
    ctx.stroke();

    // wing marking
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(bodyR * 0.28, bodyR * 0.05, bodyR * 0.42, bodyR * 0.26, -0.15, 0, Math.PI * 2);
    ctx.fillStyle = '#ded2bd';
    ctx.fill();
    ctx.lineWidth = Math.max(1, bodyR * 0.07);
    ctx.strokeStyle = '#231a12';
    ctx.stroke();
    ctx.restore();

    // comb
    ctx.fillStyle = '#e8432c';
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.arc(-bodyR * 0.28 + k * bodyR * 0.24, -bodyR * 0.82, bodyR * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#231a12';
    ctx.lineWidth = Math.max(1, bodyR * 0.06);
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.arc(-bodyR * 0.28 + k * bodyR * 0.24, -bodyR * 0.82, bodyR * 0.22, 0, Math.PI * 2);
      ctx.stroke();
    }

    // wattle
    ctx.fillStyle = '#e8432c';
    ctx.beginPath();
    ctx.arc(-bodyR * 0.62, bodyR * 0.28, bodyR * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#231a12';
    ctx.lineWidth = Math.max(1, bodyR * 0.05);
    ctx.stroke();

    // beak
    ctx.fillStyle = '#f4a83c';
    ctx.beginPath();
    ctx.moveTo(-bodyR * 0.62, -bodyR * 0.05);
    ctx.lineTo(-bodyR * 1.05, bodyR * 0.08);
    ctx.lineTo(-bodyR * 0.6, bodyR * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#231a12';
    ctx.lineWidth = Math.max(1, bodyR * 0.06);
    ctx.stroke();

    // eye
    ctx.fillStyle = '#1c1c1c';
    ctx.beginPath();
    ctx.arc(-bodyR * 0.32, -bodyR * 0.18, bodyR * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-bodyR * 0.29, -bodyR * 0.22, bodyR * 0.04, 0, Math.PI * 2);
    ctx.fill();

    // feet
    ctx.strokeStyle = '#f4a83c';
    ctx.lineWidth = Math.max(1.4, bodyR * 0.12);
    ctx.lineCap = 'round';
    const legLift = chicken.alive ? Math.sin(clamp(t, 0, 1) * Math.PI) : 0;
    ctx.beginPath();
    ctx.moveTo(-bodyR * 0.15, bodyR * 0.85);
    ctx.lineTo(-bodyR * 0.15 - legLift * bodyR * 0.25, bodyR * 1.15);
    ctx.moveTo(bodyR * 0.2, bodyR * 0.85);
    ctx.lineTo(bodyR * 0.2 + legLift * bodyR * 0.25, bodyR * 1.15);
    ctx.stroke();

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function render() {
    if (state === 'start') {
      ctx.fillStyle = THEMES[0].outside;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    // How far behind/ahead of the chicken the path needs to be drawn to
    // fully cover the screen. Fixed distances broke on tall phone aspect
    // ratios (esp. with Safari's chrome eating vertical space): the chicken
    // sits at a fixed screen-height fraction, but the world-space distance
    // from it to the bottom edge grows with the screen's actual height, so
    // the path ran out and left a flat cut-off below the chicken.
    const s = scaleFactor();
    const behind = Math.max(90, (H - chickenScreenY()) / s + 50);
    const ahead = Math.max(480, chickenScreenY() / s + 60);
    drawPath(behind, ahead);
    drawDecorations(behind, ahead);
    drawParticles();
    drawChicken();

    if (damageFlash > 0) {
      ctx.fillStyle = `rgba(200, 30, 30, ${damageFlash * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ================= Main loop =================
  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  resetGame();
  requestAnimationFrame(frame);
})();

// ================= PWA: service worker =================
if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
  });
}
