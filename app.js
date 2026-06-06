/* =========================================================
   Breathe — app logic
   One timer (requestAnimationFrame) drives the animation,
   the per-phase countdown, and the progress ring together,
   so they can never drift apart.
   ========================================================= */
(() => {
  'use strict';

  /* ---------- Mode definitions ---------- */
  // Each phase: { label, dur (ms), from, to }  where from/to are circle scale targets.
  const SCALE_MIN = 0.55;
  const SCALE_MAX = 1.0;

  const MODES = {
    box: {
      name: 'Box Breathing',
      phases: [
        { label: 'Inhale', dur: 4000, from: SCALE_MIN, to: SCALE_MAX },
        { label: 'Hold',   dur: 4000, from: SCALE_MAX, to: SCALE_MAX },
        { label: 'Exhale', dur: 4000, from: SCALE_MAX, to: SCALE_MIN },
        { label: 'Hold',   dur: 4000, from: SCALE_MIN, to: SCALE_MIN },
      ],
    },
    coherent: {
      name: 'Coherent Breathing',
      phases: [
        { label: 'Inhale', dur: 5000, from: SCALE_MIN, to: SCALE_MAX },
        { label: 'Exhale', dur: 5000, from: SCALE_MAX, to: SCALE_MIN },
      ],
    },
  };

  const RING_CIRCUMFERENCE = 2 * Math.PI * 112; // r = 112 in viewBox

  /* ---------- Settings (persisted) ---------- */
  const DEFAULTS = {
    mode: 'box',
    cycles: 6,          // box: 5–10
    duration: 5,        // coherent: 5 or 10 (minutes)
    sound: true,
    haptic: true,
    theme: 'dark',      // 'dark' | 'light'
  };
  const STORE_KEY = 'breathe.settings.v1';

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { ...DEFAULTS };
      const s = JSON.parse(raw);
      return {
        mode: s.mode === 'coherent' ? 'coherent' : 'box',
        cycles: clamp(parseInt(s.cycles, 10) || DEFAULTS.cycles, 5, 10),
        duration: s.duration === 10 ? 10 : 5,
        sound: s.sound !== false,
        haptic: s.haptic !== false,
        theme: s.theme === 'light' ? 'light' : 'dark',
      };
    } catch {
      return { ...DEFAULTS };
    }
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch {}
  }

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const settings = loadSettings();

  /* ---------- Element refs ---------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    screenStart: $('screen-start'),
    screenSession: $('screen-session'),
    screenEnd: $('screen-end'),

    modeBox: $('mode-box'),
    modeCoherent: $('mode-coherent'),
    fieldBox: $('field-box'),
    fieldCoherent: $('field-coherent'),
    cyclesValue: $('cycles-value'),
    cyclesDec: $('cycles-dec'),
    cyclesInc: $('cycles-inc'),
    boxEstimate: $('box-estimate'),
    dur5: $('dur-5'),
    dur10: $('dur-10'),

    optSound: $('opt-sound'),
    optHaptic: $('opt-haptic'),
    optTheme: $('opt-theme'),

    startForm: $('start-form'),
    btnStart: $('btn-start'),

    cycleCounter: $('cycle-counter'),
    breath: $('breath'),
    phaseLabel: $('phase-label'),
    count: $('count'),
    ringFill: document.querySelector('.ring__fill'),
    btnPause: $('btn-pause'),
    btnStop: $('btn-stop'),

    endTime: $('end-time'),
    endCount: $('end-count'),
    endCountK: $('end-count-k'),
    btnRestart: $('btn-restart'),
    btnHome: $('btn-home'),

    srAnnounce: $('sr-announce'),
  };

  const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Theme ---------- */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }

  /* =======================================================
     START SCREEN — reflect & edit settings
     ======================================================= */
  function renderStart() {
    // Mode segmented
    const isBox = settings.mode === 'box';
    setRadio(el.modeBox, isBox);
    setRadio(el.modeCoherent, !isBox);
    el.fieldBox.hidden = !isBox;
    el.fieldCoherent.hidden = isBox;

    // Cycles
    el.cyclesValue.textContent = String(settings.cycles);
    el.cyclesDec.disabled = settings.cycles <= 5;
    el.cyclesInc.disabled = settings.cycles >= 10;
    const secs = settings.cycles * 16; // 4 phases × 4s
    el.boxEstimate.textContent = formatDuration(secs * 1000);

    // Duration
    setRadio(el.dur5, settings.duration === 5);
    setRadio(el.dur10, settings.duration === 10);

    // Toggles
    setSwitch(el.optSound, settings.sound);
    setSwitch(el.optHaptic, settings.haptic);
    setSwitch(el.optTheme, settings.theme === 'light');
  }

  function setRadio(node, on) { node.setAttribute('aria-checked', on ? 'true' : 'false'); }
  function setSwitch(node, on) { node.setAttribute('aria-checked', on ? 'true' : 'false'); }

  // Mode buttons
  el.modeBox.addEventListener('click', () => { settings.mode = 'box'; saveSettings(); renderStart(); });
  el.modeCoherent.addEventListener('click', () => { settings.mode = 'coherent'; saveSettings(); renderStart(); });

  // Cycles stepper
  el.cyclesDec.addEventListener('click', () => { settings.cycles = clamp(settings.cycles - 1, 5, 10); saveSettings(); renderStart(); });
  el.cyclesInc.addEventListener('click', () => { settings.cycles = clamp(settings.cycles + 1, 5, 10); saveSettings(); renderStart(); });

  // Duration
  el.dur5.addEventListener('click', () => { settings.duration = 5; saveSettings(); renderStart(); });
  el.dur10.addEventListener('click', () => { settings.duration = 10; saveSettings(); renderStart(); });

  // Toggles
  el.optSound.addEventListener('click', () => { settings.sound = !settings.sound; saveSettings(); renderStart(); });
  el.optHaptic.addEventListener('click', () => { settings.haptic = !settings.haptic; saveSettings(); renderStart(); });
  el.optTheme.addEventListener('click', () => {
    settings.theme = settings.theme === 'light' ? 'dark' : 'light';
    saveSettings(); applyTheme(); renderStart();
  });

  /* =======================================================
     AUDIO — must be created on a user gesture (iOS Safari)
     ======================================================= */
  let audioCtx = null;
  function initAudio() {
    if (!settings.sound) return;
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch { audioCtx = null; }
  }
  // tone: a soft sine with gentle attack/release; pitch hints the direction.
  function playTone(kind) {
    if (!settings.sound || !audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const freq = kind === 'inhale' ? 396 : kind === 'exhale' ? 297 : 352; // hold = mid
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.75);
    } catch {}
  }

  /* ---------- Haptics ---------- */
  function buzz(kind) {
    if (!settings.haptic || !('vibrate' in navigator) || prefersReducedMotion()) return;
    try { navigator.vibrate(kind === 'exhale' ? 14 : 22); } catch {}
  }

  /* ---------- Wake Lock (graceful fallback) ---------- */
  let wakeLock = null;
  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return; // unsupported — silent fallback
    try { wakeLock = await navigator.wakeLock.request('screen'); }
    catch { wakeLock = null; }
  }
  function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch {}
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && session.active && !session.paused) {
      acquireWakeLock();
    }
  });

  /* =======================================================
     SESSION ENGINE — single rAF loop
     ======================================================= */
  const session = {
    active: false,
    paused: false,
    mode: 'box',
    phases: [],
    phaseIndex: 0,
    phaseElapsed: 0,     // ms within current phase
    sessionElapsed: 0,   // ms since start (running time only)
    cycle: 0,            // completed cycles
    totalCycles: 0,
    totalDuration: 0,    // ms (coherent target; box = cycles * cycleLen)
    cycleLen: 0,
    rafId: 0,
    lastTs: 0,
    lastRingStep: -1,    // for reduced-motion stepping
  };

  const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

  function startSession() {
    const mode = MODES[settings.mode];
    session.active = true;
    session.paused = false;
    session.mode = settings.mode;
    session.phases = mode.phases;
    session.phaseIndex = 0;
    session.phaseElapsed = 0;
    session.sessionElapsed = 0;
    session.cycle = 0;
    session.cycleLen = mode.phases.reduce((a, p) => a + p.dur, 0);
    session.lastRingStep = -1;

    if (settings.mode === 'box') {
      session.totalCycles = settings.cycles;
      session.totalDuration = settings.cycles * session.cycleLen;
    } else {
      session.totalDuration = settings.duration * 60 * 1000;
      session.totalCycles = Math.round(session.totalDuration / session.cycleLen);
    }

    showScreen('session');
    updateCycleCounter();
    enterPhase(0, /*announce*/ true);
    acquireWakeLock();

    el.btnPause.textContent = 'Pause';
    el.btnPause.setAttribute('aria-label', 'Pause session');

    session.lastTs = 0;
    session.rafId = requestAnimationFrame(tick);
  }

  function enterPhase(index, announce) {
    session.phaseIndex = index;
    session.phaseElapsed = 0;
    const phase = session.phases[index];
    el.phaseLabel.textContent = phase.label;

    // Immediate-feedback countdown starts at full seconds
    const total = Math.round(phase.dur / 1000);
    el.count.textContent = String(total);

    // Cue (sound + haptic) on every phase change
    const kind = phase.label === 'Inhale' ? 'inhale'
               : phase.label === 'Exhale' ? 'exhale' : 'hold';
    playTone(kind);
    buzz(kind);

    if (announce) {
      // Screen-reader announcement (aria-live polite)
      el.srAnnounce.textContent = `${phase.label}, ${total} seconds`;
    }
  }

  function tick(ts) {
    if (!session.active) return;

    if (!session.lastTs) session.lastTs = ts;
    let dt = ts - session.lastTs;
    session.lastTs = ts;
    if (dt < 0) dt = 0;
    if (dt > 250) dt = 250; // clamp tab-throttle jumps

    if (!session.paused) {
      session.phaseElapsed += dt;
      session.sessionElapsed += dt;

      const phase = session.phases[session.phaseIndex];

      // ----- Phase rollover (single source of truth) -----
      // dt is clamped to 250ms and every phase is >= 4000ms, so at most
      // one boundary is crossed per frame.
      if (session.phaseElapsed >= phase.dur) {
        session.phaseElapsed -= phase.dur;
        let next = session.phaseIndex + 1;
        if (next >= session.phases.length) {
          next = 0;
          session.cycle += 1;
          updateCycleCounter();
        }
        // Box ends after the final cycle's last phase completes.
        if (session.mode === 'box' && session.cycle >= session.totalCycles) {
          return finishSession();
        }
        enterPhase(next, true);
        return scheduleNext(); // render the new phase on the next frame
      }

      // Coherent ends on elapsed time (durations divide evenly into the
      // total, so this lands on a phase boundary).
      if (session.mode === 'coherent' && session.sessionElapsed >= session.totalDuration) {
        return finishSession();
      }
    }

    render();
    scheduleNext();
  }

  function scheduleNext() {
    session.rafId = requestAnimationFrame(tick);
  }

  function render() {
    const phase = session.phases[session.phaseIndex];
    const t = clamp(session.phaseElapsed / phase.dur, 0, 1);

    // ----- Countdown (prominent, immediate) -----
    const remaining = Math.max(1, Math.ceil((phase.dur - session.phaseElapsed) / 1000));
    if (el.count.textContent !== String(remaining)) {
      el.count.textContent = String(remaining);
    }

    // ----- Circle -----
    if (prefersReducedMotion()) {
      // Non-scaling alternative: gentle opacity, brighter on inhale/hold-top.
      const bright = phase.to >= SCALE_MAX ? 1 : 0.6;
      const dim = phase.from >= SCALE_MAX ? 1 : 0.6;
      const op = dim + (bright - dim) * easeInOutSine(t);
      el.breath.style.opacity = op.toFixed(3);
      // size stays fixed (CSS !important locks scale)
    } else {
      const scale = phase.from + (phase.to - phase.from) * easeInOutSine(t);
      el.breath.style.transform = `scale(${scale.toFixed(4)})`;
      el.breath.style.opacity = (0.9 + 0.1 * ((scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN))).toFixed(3);
    }

    // ----- Progress ring -----
    let progress;
    if (session.mode === 'box') {
      const cycleProgress = (session.cycle + clampCycleFraction()) / session.totalCycles;
      progress = clamp(cycleProgress, 0, 1);
    } else {
      progress = clamp(session.sessionElapsed / session.totalDuration, 0, 1);
    }
    setRing(progress);
  }

  // fraction through the current cycle (sum of completed phases + current phase elapsed)
  function clampCycleFraction() {
    let done = 0;
    for (let i = 0; i < session.phaseIndex; i++) done += session.phases[i].dur;
    done += session.phaseElapsed;
    return clamp(done / session.cycleLen, 0, 1);
  }

  function setRing(progress) {
    if (prefersReducedMotion()) {
      // Step in ~2% increments instead of continuous animation.
      const step = Math.floor(progress * 50);
      if (step === session.lastRingStep) return;
      session.lastRingStep = step;
      progress = step / 50;
    }
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    el.ringFill.style.strokeDashoffset = offset.toFixed(2);
  }

  function updateCycleCounter() {
    if (session.mode === 'box') {
      const current = Math.min(session.cycle + 1, session.totalCycles);
      el.cycleCounter.textContent = `Cycle ${current} of ${session.totalCycles}`;
      el.cycleCounter.hidden = false;
    } else {
      // Coherent uses time-based progress; cycle counter not meaningful.
      el.cycleCounter.textContent = '';
      el.cycleCounter.hidden = true;
    }
  }

  /* ---------- Pause / Resume ---------- */
  function togglePause() {
    if (!session.active) return;
    session.paused = !session.paused;
    if (session.paused) {
      el.btnPause.textContent = 'Resume';
      el.btnPause.setAttribute('aria-label', 'Resume session');
      el.phaseLabel.dataset.prev = el.phaseLabel.textContent;
      el.srAnnounce.textContent = 'Paused';
      releaseWakeLock();
    } else {
      el.btnPause.textContent = 'Pause';
      el.btnPause.setAttribute('aria-label', 'Pause session');
      el.srAnnounce.textContent = `Resumed. ${session.phases[session.phaseIndex].label}`;
      acquireWakeLock();
      session.lastTs = 0; // avoid a dt spike on resume
    }
  }

  /* ---------- Stop ---------- */
  function stopSession() {
    endEngine();
    el.srAnnounce.textContent = 'Stopped';
    showScreen('start');
  }

  /* ---------- Finish ---------- */
  function finishSession() {
    const elapsed = session.sessionElapsed;
    const cyclesDone = session.mode === 'box' ? session.totalCycles : session.cycle;
    endEngine();

    el.endTime.textContent = formatDuration(
      session.mode === 'box' ? session.totalDuration : elapsed
    );
    if (session.mode === 'box') {
      el.endCountK.textContent = 'Cycles';
      el.endCount.textContent = String(cyclesDone);
    } else {
      el.endCountK.textContent = 'Breaths';
      el.endCount.textContent = String(cyclesDone);
    }
    el.srAnnounce.textContent = 'Session complete';
    showScreen('end');
  }

  function endEngine() {
    session.active = false;
    session.paused = false;
    if (session.rafId) cancelAnimationFrame(session.rafId);
    session.rafId = 0;
    releaseWakeLock();
    // reset circle to resting visual
    el.breath.style.transform = '';
    el.breath.style.opacity = '';
  }

  /* =======================================================
     Screen switching + focus management
     ======================================================= */
  function showScreen(name) {
    const map = { start: el.screenStart, session: el.screenSession, end: el.screenEnd };
    Object.entries(map).forEach(([k, node]) => { node.hidden = (k !== name); });
    // Move focus to a sensible target (keyboard / SR users)
    const focusTarget = {
      start: el.btnStart,
      session: el.btnStop,   // always-reachable control
      end: el.btnRestart,
    }[name];
    if (focusTarget) {
      // delay so the element is visible/focusable
      requestAnimationFrame(() => focusTarget.focus());
    }
  }

  /* ---------- Formatting ---------- */
  function formatDuration(ms) {
    const total = Math.round(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m === 0) return `${s}s`;
    if (s === 0) return `${m}m`;
    return `${m}m ${s}s`;
  }

  /* =======================================================
     Wiring
     ======================================================= */
  el.startForm.addEventListener('submit', (e) => {
    e.preventDefault();
    initAudio();      // unlock audio inside the user gesture
    startSession();
  });

  el.btnPause.addEventListener('click', togglePause);
  el.btnStop.addEventListener('click', stopSession);
  el.btnRestart.addEventListener('click', () => { initAudio(); startSession(); });
  el.btnHome.addEventListener('click', () => showScreen('start'));

  // Keyboard: Space toggles pause during a session; Escape stops.
  document.addEventListener('keydown', (e) => {
    if (!session.active) return;
    const tag = (e.target && e.target.tagName) || '';
    if (e.key === 'Escape') { e.preventDefault(); stopSession(); }
    else if ((e.key === ' ' || e.code === 'Space') && tag !== 'BUTTON') {
      e.preventDefault(); togglePause();
    }
  });

  // Keep ring/circle consistent if the motion preference changes mid-session
  try {
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
      session.lastRingStep = -1;
      if (!session.active) return;
      el.breath.style.transform = '';
      el.breath.style.opacity = '';
    });
  } catch {}

  /* ---------- Boot ---------- */
  applyTheme();
  renderStart();
  showScreen('start');

  // Register service worker (offline)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
