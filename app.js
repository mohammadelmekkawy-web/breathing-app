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
    '4-7-8': {
      name: '4-7-8 Breathing',
      phases: [
        { label: 'Inhale', dur: 4000, from: SCALE_MIN, to: SCALE_MAX },
        { label: 'Hold',   dur: 7000, from: SCALE_MAX, to: SCALE_MAX },
        { label: 'Exhale', dur: 8000, from: SCALE_MAX, to: SCALE_MIN },
      ],
    },
  };

  /* ---------- Custom patterns (localStorage) ---------- */
  const CUSTOM_PATTERNS_KEY = 'breathe.customPatterns.v1';
  function loadCustomPatterns() {
    try {
      const raw = localStorage.getItem(CUSTOM_PATTERNS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  function saveCustomPatterns(patterns) {
    try {
      localStorage.setItem(CUSTOM_PATTERNS_KEY, JSON.stringify(patterns));
    } catch {}
  }
  function createCustomMode(patternId) {
    const patterns = loadCustomPatterns();
    const p = patterns[patternId];
    if (!p) return null;
    const phases = [];
    const { inhale, hold1, exhale, hold2 } = p.durations;
    if (inhale > 0) phases.push({ label: 'Inhale', dur: inhale * 1000, from: SCALE_MIN, to: SCALE_MAX });
    if (hold1 > 0) phases.push({ label: 'Hold',   dur: hold1 * 1000, from: SCALE_MAX, to: SCALE_MAX });
    if (exhale > 0) phases.push({ label: 'Exhale', dur: exhale * 1000, from: SCALE_MAX, to: SCALE_MIN });
    if (hold2 > 0) phases.push({ label: 'Hold',   dur: hold2 * 1000, from: SCALE_MIN, to: SCALE_MIN });
    if (phases.length === 0) return null;
    return {
      name: p.name,
      phases,
      isCustom: true,
      patternId,
    };
  }
  let customPatterns = loadCustomPatterns();

  const RING_CIRCUMFERENCE = 2 * Math.PI * 112; // r = 112 in viewBox

  /* ---------- Settings (persisted) ---------- */
  const DEFAULTS = {
    mode: 'box',
    cycles: 5,          // box & 4-7-8: default 5, range 2–8
    duration: 5,        // coherent: 5 or 10 (minutes)
    sound: true,
    haptic: true,
    theme: 'dark',      // 'dark' | 'light'
    animationStyle: 'circle',  // 'circle' or 'liquid'
    soundscape: false,  // ambient soundscape (optional)
    soundscapeVolume: 0.3,
    calmCheck: true,    // optional before/after calm self-rating
  };
  const STORE_KEY = 'breathe.settings.v1';

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { ...DEFAULTS };
      const s = JSON.parse(raw);
      const validModes = ['box', 'coherent', '4-7-8', ...Object.keys(customPatterns)];
      return {
        mode: validModes.includes(s.mode) ? s.mode : 'box',
        cycles: clamp(parseInt(s.cycles, 10) || DEFAULTS.cycles, 2, 8),
        duration: s.duration === 10 ? 10 : 5,
        sound: s.sound !== false,
        haptic: s.haptic !== false,
        theme: s.theme === 'light' ? 'light' : 'dark',
        animationStyle: s.animationStyle === 'liquid' ? 'liquid' : 'circle',
        soundscape: s.soundscape === true,
        soundscapeVolume: clamp(parseFloat(s.soundscapeVolume) || DEFAULTS.soundscapeVolume, 0, 1),
        calmCheck: s.calmCheck !== false,
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

  /* =======================================================
     LOCAL USER DATA — profile + progress (stays on device)
     Nothing here is ever uploaded; it all lives in localStorage.
     ======================================================= */
  const PROFILE_KEY = 'breathe.profile.v1';
  const PROGRESS_KEY = 'breathe.progress.v1';

  function loadProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
      let goals = [];
      if (Array.isArray(p.goals)) goals = p.goals.filter((g) => typeof g === 'string');
      else if (typeof p.goal === 'string' && p.goal) goals = [p.goal]; // migrate old single goal
      return {
        name: typeof p.name === 'string' ? p.name : '',
        age: typeof p.age === 'string' ? p.age : '',
        goals,
        welcomed: p.welcomed === true,
        onboarded: p.onboarded === true,
      };
    } catch { return { name: '', age: '', goals: [], welcomed: false, onboarded: false }; }
  }
  function saveProfile() { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {} }

  function loadProgress() {
    try {
      const p = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
      const st = p.streak || {};
      return {
        history: Array.isArray(p.history) ? p.history : [],
        points: Number(p.points) || 0,
        streak: {
          current: Number(st.current) || 0,
          longest: Number(st.longest) || 0,
          lastDate: typeof st.lastDate === 'string' ? st.lastDate : null,
        },
      };
    } catch { return { history: [], points: 0, streak: { current: 0, longest: 0, lastDate: null } }; }
  }
  function saveProgress() { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch {} }

  const profile = loadProfile();
  const progress = loadProgress();

  // ---- date + stats helpers (local time) ----
  function todayStr(d) {
    const dt = d || new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function dayDiff(aStr, bStr) {
    const a = new Date(aStr + 'T00:00:00');
    const b = new Date(bStr + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }
  function computeSessionPoints(durationMs) {
    const minutes = durationMs / 60000;
    return Math.max(10, Math.round(minutes) * 5 + 5); // ~5/min + a completion bonus
  }
  function lifetimeMs() { return progress.history.reduce((a, h) => a + (h.durationMs || 0), 0); }
  function minutesToday() {
    const t = todayStr();
    return progress.history.filter((h) => h.date === t).reduce((a, h) => a + (h.durationMs || 0) / 60000, 0);
  }
  function doseDaysThisWeek() {
    const byDay = {};
    progress.history.forEach((h) => { byDay[h.date] = (byDay[h.date] || 0) + (h.durationMs || 0) / 60000; });
    const today = new Date();
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const ds = todayStr(new Date(today.getTime() - i * 86400000));
      if ((byDay[ds] || 0) >= 5) count++;
    }
    return count;
  }
  function calmDeltaAvg() {
    const both = progress.history.filter((h) => h.calmBefore != null && h.calmAfter != null);
    if (!both.length) return null;
    const avg = both.reduce((a, h) => a + (h.calmAfter - h.calmBefore), 0) / both.length;
    return { avg, n: both.length };
  }

  // Record a COMPLETED session. Streak only ever builds up (never resets to
  // zero); a gap just pauses growth and flags a warm "welcome back".
  function recordSession(rec) {
    const now = new Date();
    const today = todayStr(now);
    const pts = computeSessionPoints(rec.durationMs);
    const s = progress.streak;
    let wasAway = false;
    if (s.lastDate !== today) {
      if (s.lastDate && dayDiff(s.lastDate, today) >= 2) wasAway = true; // missed 1+ day(s)
      s.current = (s.current || 0) + 1;
      s.longest = Math.max(s.longest || 0, s.current);
      s.lastDate = today;
    }
    progress.points += pts;
    progress.history.push({
      ts: now.getTime(),
      date: today,
      mode: rec.mode,
      modeLabel: rec.modeLabel,
      durationMs: rec.durationMs,
      minutes: Math.round((rec.durationMs / 60000) * 10) / 10,
      cycles: rec.cycles,
      points: pts,
      calmBefore: rec.calmBefore != null ? rec.calmBefore : null,
      calmAfter: rec.calmAfter != null ? rec.calmAfter : null,
    });
    saveProgress();
    return { pts, wasAway };
  }

  function modeLabelFor(modeId) {
    if (modeId === 'box') return 'Box (Focus)';
    if (modeId === 'coherent') return 'Coherent (Relax)';
    if (modeId === '4-7-8') return '4-7-8 (Sleep)';
    if (modeId && modeId.startsWith('custom-')) {
      const m = createCustomMode(modeId.slice('custom-'.length));
      return m ? m.name : 'Custom';
    }
    return modeId || '';
  }

  /* ---------- Element refs ---------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    screenStart: $('screen-start'),
    screenSession: $('screen-session'),
    screenEnd: $('screen-end'),

    modeBox: $('mode-box-card'),
    modeCoherent: $('mode-coherent-card'),
    mode478: $('mode-478-card'),
    fieldBox478: $('field-box-478'),
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
    optSoundscape: $('opt-soundscape'),
    optSoundscapeVolume: $('opt-soundscape-volume'),

    startForm: $('start-form'),
    btnStart: $('btn-start'),

    cycleCounter: $('cycle-counter'),
    breath: $('breath'),
    phaseLabel: $('phase-label'),
    count: $('count'),
    ringFill: document.querySelector('.ring__fill'),
    btnPause: $('btn-pause'),
    btnStop: $('btn-stop'),

    // In-session audio controls
    btnMute: $('btn-mute'),
    btnAudioPanel: $('btn-audio-panel'),
    audioPanel: $('audio-panel'),
    sessOptSound: $('sess-opt-sound'),
    sessOptSoundscape: $('sess-opt-soundscape'),
    sessSoundscapeVolume: $('sess-soundscape-volume'),

    endTime: $('end-time'),
    endCount: $('end-count'),
    endCountK: $('end-count-k'),
    btnRestart: $('btn-restart'),
    btnHome: $('btn-home'),

    srAnnounce: $('sr-announce'),
    beginnerHint: $('beginner-hint'),
    cyclesRecommended: $('cycles-recommended'),
    liquidContainer: $('liquid-container'),
    liquidFillRect: document.querySelector('.liquid-fill__rect'),
    phaseLabelLiquid: $('phase-label-liquid'),
    countLiquid: $('count-liquid'),
    optAnimation: $('opt-animation'),

    // Welcome
    screenWelcome: $('screen-welcome'),
    btnWelcomeStart: $('btn-welcome-start'),

    // Onboarding
    screenOnboarding: $('screen-onboarding'),
    onboardForm: $('onboard-form'),
    onboardTitle: $('onboard-title'),
    onboardName: $('onboard-name'),
    onboardAge: $('onboard-age'),
    onboardGoal: $('onboard-goal'),
    onboardSuggestion: $('onboard-suggestion'),
    btnOnboardContinue: $('btn-onboard-continue'),
    btnOnboardSkip: $('btn-onboard-skip'),

    // Start greeting + data section
    mastheadSub: $('masthead-sub'),
    greeting: $('greeting'),
    optCalm: $('opt-calm'),
    btnEditProfile: $('btn-edit-profile'),
    btnExportJson: $('btn-export-json'),
    btnExportCsv: $('btn-export-csv'),
    btnReplayWelcome: $('btn-replay-welcome'),

    // Dashboard extras
    endSub: $('end-sub'),
    endStreak: $('end-streak'),
    endPoints: $('end-points'),
    endSessions: $('end-sessions'),
    endLifetime: $('end-lifetime'),
    endMilestone: $('end-milestone'),
    endCalm: $('end-calm'),
    doseFill: document.querySelector('.dose__fill'),
    doseNum: $('dose-num'),
    doseCaption: $('dose-caption'),

    // Calm overlay
    calmOverlay: $('calm-overlay'),
    calmTitle: $('calm-q'),
    calmSub: $('calm-sub'),
    btnCalmSkip: $('btn-calm-skip'),
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
    // Show beginner hint if this is likely the first time (based on localStorage)
    const hasSeenHint = localStorage.getItem('breathe.seenHint');
    el.beginnerHint.hidden = !!hasSeenHint;
    if (!hasSeenHint) {
      localStorage.setItem('breathe.seenHint', 'true');
    }

    // Mode segmented
    const isBox = settings.mode === 'box';
    const isCoherent = settings.mode === 'coherent';
    const is478 = settings.mode === '4-7-8';
    setRadio(el.modeBox, isBox);
    setRadio(el.modeCoherent, isCoherent);
    setRadio(el.mode478, is478);
    el.fieldBox478.hidden = !(isBox || is478);
    el.fieldCoherent.hidden = !isCoherent;

    // Cycles
    el.cyclesValue.textContent = String(settings.cycles);
    el.cyclesDec.disabled = settings.cycles <= 2;
    el.cyclesInc.disabled = settings.cycles >= 8;
    const cycleLen = isBox ? 16 : 19; // box: 4s * 4 phases = 16s; 4-7-8: 4+7+8 = 19s
    const secs = settings.cycles * cycleLen;
    el.boxEstimate.textContent = formatDuration(secs * 1000);
    
    // Show/hide recommended badge for cycles based on defaults
    const isRecommendedCycles = (isBox && settings.cycles === 5) || (is478 && settings.cycles === 4);
    el.cyclesRecommended.hidden = !isRecommendedCycles;

    // Duration
    setRadio(el.dur5, settings.duration === 5);
    setRadio(el.dur10, settings.duration === 10);

    // Toggles
    setSwitch(el.optSound, settings.sound);
    setSwitch(el.optHaptic, settings.haptic);
    setSwitch(el.optSoundscape, settings.soundscape);
    setSwitch(el.optAnimation, settings.animationStyle === 'liquid');
    setSwitch(el.optCalm, settings.calmCheck);
    setSwitch(el.optTheme, settings.theme === 'light');
    el.optSoundscapeVolume.value = String(Math.round(settings.soundscapeVolume * 100));

    updateGreeting();
  }

  function setRadio(node, on) { node.setAttribute('aria-checked', on ? 'true' : 'false'); }
  function setSwitch(node, on) { node.setAttribute('aria-checked', on ? 'true' : 'false'); }

  // Mode cards
  const modeCards = [el.modeBox, el.modeCoherent, el.mode478];
  modeCards.forEach(card => {
    card.addEventListener('click', () => {
      const mode = card.getAttribute('data-mode');
      const prevMode = settings.mode;
      settings.mode = mode;
      
      // Set mode-specific defaults on first selection
      if (mode === '4-7-8' && prevMode !== '4-7-8') {
        settings.cycles = 4;  // 4-7-8 default: 4 cycles
      } else if ((mode === 'box' || mode === 'coherent') && settings.cycles !== 5) {
        if (prevMode === '4-7-8') {
          settings.cycles = 5;  // box & coherent default: 5 cycles
        }
      }
      
      saveSettings();
      renderStart();
    });
  });

  // Cycles stepper
  el.cyclesDec.addEventListener('click', () => { settings.cycles = clamp(settings.cycles - 1, 2, 8); saveSettings(); renderStart(); });
  el.cyclesInc.addEventListener('click', () => { settings.cycles = clamp(settings.cycles + 1, 2, 8); saveSettings(); renderStart(); });

  // Duration
  el.dur5.addEventListener('click', () => { settings.duration = 5; saveSettings(); renderStart(); });
  el.dur10.addEventListener('click', () => { settings.duration = 10; saveSettings(); renderStart(); });

  // Toggles
  el.optSound.addEventListener('click', () => { settings.sound = !settings.sound; saveSettings(); renderStart(); });
  el.optHaptic.addEventListener('click', () => { settings.haptic = !settings.haptic; saveSettings(); renderStart(); });
  el.optSoundscape.addEventListener('click', () => { settings.soundscape = !settings.soundscape; saveSettings(); renderStart(); });
  el.optSoundscapeVolume.addEventListener('input', () => {
    settings.soundscapeVolume = clamp(parseInt(el.optSoundscapeVolume.value, 10) / 100 || 0, 0, 1);
    saveSettings();
    // Live-adjust if the soundscape is currently audible.
    if (soundscape.active && !soundscape.stopping) fadeSoundscape(soundscapeAudibleTarget(), 0.25);
  });
  el.optAnimation.addEventListener('click', () => { settings.animationStyle = settings.animationStyle === 'liquid' ? 'circle' : 'liquid'; saveSettings(); renderStart(); });
  el.optTheme.addEventListener('click', () => {
    settings.theme = settings.theme === 'light' ? 'dark' : 'light';
    saveSettings(); applyTheme(); renderStart();
  });

  /* =======================================================
     AUDIO — must be created on a user gesture (iOS Safari)
     ======================================================= */
  let audioCtx = null;
  function ensureAudioCtx() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch { audioCtx = null; }
    return audioCtx;
  }
  function initAudio() {
    // Create/resume the context if EITHER feature wants sound. Must run inside a
    // user gesture (the Start tap) — iOS Safari blocks audio otherwise.
    if (!settings.sound && !settings.soundscape) return;
    ensureAudioCtx();
  }

  // Gentle intro chime for the welcome screen (soft ascending major triad).
  function playChime() {
    if (!settings.sound) return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((f, i) => { // C5 · E5 · G5
        const t = now + i * 0.18;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
        osc.connect(g).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 1.35);
      });
    } catch {}
  }
  // tone: a soft sine with gentle attack/release; pitch hints the direction.
  function playTone(kind) {
    if (muted || !settings.sound || !audioCtx) return;
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

  /* =======================================================
     AMBIENT SOUNDSCAPE — synthesized, breath-linked, optional
     A warm pure-sine open chord (root + fifth + octave) plus a soft
     filtered-noise "air" wash and a slow swell, through a morphing
     low-pass and lush reverb. Brightness follows the breath "fullness"
     computed from the SAME single timer as the visuals, so it can never
     drift. Everything ramps gently — no hard jumps.
     ======================================================= */
  const soundscape = { active: false, stopping: false, nodes: null, teardownTimer: 0 };

  // Master mute is session-transient (resets each session) — it silences
  // everything instantly without changing the user's cue/soundscape prefs.
  let muted = false;

  const SS = {
    filterMin: 300,   // Hz, fully exhaled (closed, warm)
    filterMax: 1400,  // Hz, fully inhaled (open, brighter) — gentle range
    detuneRise: 36,   // cents of subtle pitch rise at full inhale
    padBase: 0.62,    // resting pad level
    padSwell: 0.12,   // extra pad level at full inhale (soft volume swell)
    noiseBase: 0.018, // resting level of the soft "air" wash
    noiseSwell: 0.022,// extra air toward full inhale
    lfoRate: 0.05,    // Hz — a ~20s slow swell so the pad feels alive
    lfoDepth: 0.05,   // depth of that swell
    smoothing: 0.28,  // setTargetAtTime time constant (s) — gentle, removes stepping
    masterCeiling: 0.5, // volume slider (0..1) scales within this gentle ceiling
  };

  function masterVolumeTarget() {
    return clamp(settings.soundscapeVolume, 0, 1) * SS.masterCeiling;
  }

  // The level the soundscape should fade TO right now — honours the master mute.
  function soundscapeAudibleTarget() {
    return muted ? 0.0001 : masterVolumeTarget();
  }

  // A smooth synthetic impulse response → lush, spacious reverb.
  // Slightly smoothing the noise removes the "grainy/hissy" quality and gives a
  // softer, more cathedral-like tail. Decorrelated per channel for natural width.
  function makeReverbIR(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(seconds * rate));
    const ir = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = last + 0.35 * (white - last);          // one-pole smoothing
        data[i] = last * Math.pow(1 - i / len, decay); // exponential decay tail
      }
    }
    return ir;
  }

  // Soft, looping "air" noise — a one-pole-smoothed (pink-ish) bed that, run
  // through the morphing low-pass, becomes a gentle ambient wash, not hiss.
  function makeNoiseBuffer(ctx, seconds) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(seconds * rate));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = last + 0.02 * (white - last); // heavy smoothing → low, warm noise
        data[i] = last * 3.2;                // make up the level the filter removed
      }
    }
    return buf;
  }

  function buildSoundscape(ctx) {
    const now = ctx.currentTime;
    const sources = []; // everything with start()/stop(), for clean teardown

    // Master = fade envelope × volume. Starts silent so fade-in never clicks.
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.connect(ctx.destination);

    // Morphing low-pass keeps everything warm and lets the breath "open" it.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(SS.filterMin, now);
    filter.Q.value = 0.4; // gentle, no resonant "peak"

    // Dry + lush reverb split, summed at the master.
    const dry = ctx.createGain(); dry.gain.value = 0.55;
    const wet = ctx.createGain(); wet.gain.value = 0.7;
    filter.connect(dry).connect(master);
    try {
      const convolver = ctx.createConvolver();
      convolver.buffer = makeReverbIR(ctx, 4.0, 2.6); // longer, smoother tail
      filter.connect(convolver); convolver.connect(wet).connect(master);
    } catch { /* no reverb if unsupported — pad still plays dry */ }

    // Pad bus sums the voices before the filter. A very slow LFO adds a gentle,
    // living swell on top of the breath morph (skipped under reduced-motion).
    const padBus = ctx.createGain();
    padBus.gain.setValueAtTime(SS.padBase, now);
    padBus.connect(filter);
    if (!prefersReducedMotion()) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = SS.lfoRate;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = SS.lfoDepth;
      lfo.connect(lfoDepth).connect(padBus.gain); // adds to the intrinsic gain
      lfo.start(now);
      sources.push(lfo);
    }

    // Warm OPEN chord (root + fifth + octave + soft twelfth, no third → neutral
    // and spacious), pure sines with gentle detuning for a soft chorus/beating.
    const root = 110; // A2
    const voices = [
      { f: root,       detune: -8, gain: 0.16 },
      { f: root,       detune: +8, gain: 0.16 },
      { f: root,       detune:  0, gain: 0.13 },
      { f: root * 1.5, detune: -4, gain: 0.12 }, // fifth  (E3)
      { f: root * 2,   detune: +4, gain: 0.12 }, // octave (A3)
      { f: root * 3,   detune:  0, gain: 0.05 }, // twelfth (E4) — soft air for small speakers
    ];
    const voiceDetune = voices.map((v) => v.detune);
    const oscs = voices.map((v) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = v.f;
      osc.detune.value = v.detune;
      const g = ctx.createGain();
      g.gain.value = v.gain;
      osc.connect(g).connect(padBus);
      osc.start(now);
      sources.push(osc);
      return osc;
    });

    // Soft "air" wash — a quiet looping noise bed through the SAME morphing
    // filter, so it breathes with the pad. Organic, spacious, never hissy.
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(SS.noiseBase, now);
    noiseGain.connect(filter);
    try {
      const noise = ctx.createBufferSource();
      noise.buffer = makeNoiseBuffer(ctx, 3);
      noise.loop = true;
      noise.connect(noiseGain);
      noise.start(now);
      sources.push(noise);
    } catch { /* no air layer if buffer source unsupported */ }

    return { master, filter, padBus, oscs, voiceDetune, noiseGain, sources };
  }

  // Smoothly ramp the master toward a level over `seconds` (fade in/out).
  function fadeSoundscape(toLevel, seconds) {
    if (!soundscape.nodes || !audioCtx) return;
    const g = soundscape.nodes.master.gain;
    const now = audioCtx.currentTime;
    const current = Math.max(0.0001, g.value);
    g.cancelScheduledValues(now);
    g.setValueAtTime(current, now);
    g.linearRampToValueAtTime(Math.max(0.0001, toLevel), now + Math.max(0.05, seconds));
  }

  // Called every frame from render() with breath fullness (0 empty .. 1 full).
  // All changes are gentle setTargetAtTime ramps, never abrupt sets.
  function updateSoundscape(fullness) {
    if (!soundscape.active || !soundscape.nodes || !audioCtx) return;
    const n = soundscape.nodes;
    const now = audioCtx.currentTime;
    const tc = SS.smoothing;
    // Filter cutoff rises on inhale, settles on exhale (exponential = natural for pitch/Hz).
    const cutoff = SS.filterMin * Math.pow(SS.filterMax / SS.filterMin, fullness);
    n.filter.frequency.setTargetAtTime(cutoff, now, tc);
    // Subtle pitch rise.
    const rise = SS.detuneRise * fullness;
    n.oscs.forEach((osc, i) => osc.detune.setTargetAtTime(n.voiceDetune[i] + rise, now, tc));
    // Soft volume swell toward full inhale.
    n.padBus.gain.setTargetAtTime(SS.padBase + SS.padSwell * fullness, now, tc);
    // The "air" wash opens a touch toward full inhale, then settles.
    if (n.noiseGain) {
      n.noiseGain.gain.setTargetAtTime(SS.noiseBase + SS.noiseSwell * fullness, now, tc);
    }
  }

  function teardownNodes(nodes) {
    if (!nodes) return;
    (nodes.sources || []).forEach((s) => { try { s.stop(); } catch {} try { s.disconnect(); } catch {} });
    try { nodes.master.disconnect(); } catch {}
  }

  function hardStopSoundscape() {
    clearTimeout(soundscape.teardownTimer);
    soundscape.teardownTimer = 0;
    teardownNodes(soundscape.nodes);
    soundscape.nodes = null;
    soundscape.active = false;
    soundscape.stopping = false;
  }

  function startSoundscape() {
    if (!settings.soundscape) return;
    initAudio();
    if (!audioCtx) return;
    hardStopSoundscape(); // clean slate (e.g. "Breathe again" tapped mid fade-out)
    try {
      soundscape.nodes = buildSoundscape(audioCtx);
      soundscape.active = true;
      soundscape.stopping = false;
      fadeSoundscape(soundscapeAudibleTarget(), 3.0); // gentle ~3s ease-in (silent if muted)
    } catch { hardStopSoundscape(); }
  }

  function stopSoundscape() {
    if (!soundscape.nodes || !audioCtx) { hardStopSoundscape(); return; }
    soundscape.active = false;   // stop the per-frame morph
    soundscape.stopping = true;
    fadeSoundscape(0, 2.0);      // gentle ~2s ease-out
    const dying = soundscape.nodes;
    clearTimeout(soundscape.teardownTimer);
    soundscape.teardownTimer = setTimeout(() => {
      teardownNodes(dying);
      if (soundscape.nodes === dying) soundscape.nodes = null;
      soundscape.stopping = false;
      soundscape.teardownTimer = 0;
    }, 2300);
  }

  function pauseSoundscape() {
    if (!soundscape.nodes) return;
    soundscape.active = false;   // freeze the morph
    fadeSoundscape(0, 2.0);      // ease out while paused
  }

  function resumeSoundscape() {
    if (!soundscape.nodes) return;
    soundscape.active = true;
    fadeSoundscape(soundscapeAudibleTarget(), 1.5); // ease back in (silent if muted)
  }

  // Master mute — silences cue tones (via playTone guard) and smoothly fades the
  // soundscape, without stopping the session or losing the user's preferences.
  function setMuted(m) {
    muted = m;
    if (soundscape.nodes && !soundscape.stopping) {
      const target = (!muted && soundscape.active) ? masterVolumeTarget() : 0.0001;
      fadeSoundscape(target, 0.6); // gentle, never a hard cut
    }
    updateAudioButtons();
  }

  // Sync the in-session control visuals with current settings + mute state.
  function updateAudioButtons() {
    el.btnMute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    el.btnMute.setAttribute('aria-label', muted ? 'Unmute all sound' : 'Mute all sound');
    setSwitch(el.sessOptSound, settings.sound);
    setSwitch(el.sessOptSoundscape, settings.soundscape);
    el.sessSoundscapeVolume.value = String(Math.round(settings.soundscapeVolume * 100));
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
  // Set when a new build is ready but a session is running; applied on session end.
  let pendingUpdateReload = false;
  let applyPendingUpdate = () => {};

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
    let mode;
    if (settings.mode.startsWith('custom-')) {
      const patternId = settings.mode.substring('custom-'.length);
      mode = createCustomMode(patternId);
      if (!mode) { alert('Pattern not found'); return; }
    } else {
      mode = MODES[settings.mode];
    }
    if (!mode) { settings.mode = 'box'; mode = MODES['box']; }

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

    // Determine total cycles and duration
    if (settings.mode === 'box' || settings.mode === '4-7-8' || settings.mode.startsWith('custom-')) {
      session.totalCycles = settings.cycles;
      session.totalDuration = settings.cycles * session.cycleLen;
    } else {
      // coherent
      session.totalDuration = settings.duration * 60 * 1000;
      session.totalCycles = Math.round(session.totalDuration / session.cycleLen);
    }

    showScreen('session');
    updateCycleCounter();
    enterPhase(0, /*announce*/ true);
    acquireWakeLock();

    // In-session audio controls start fresh: unmuted, panel closed.
    muted = false;
    el.audioPanel.hidden = true;
    el.btnAudioPanel.setAttribute('aria-expanded', 'false');
    updateAudioButtons();

    startSoundscape();   // fades in gently if enabled; no-op otherwise

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
    el.phaseLabelLiquid.textContent = phase.label;

    // Immediate-feedback countdown starts at full seconds
    const total = Math.round(phase.dur / 1000);
    el.count.textContent = String(total);
    el.countLiquid.textContent = String(total);

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
        // Box, 4-7-8, and custom patterns end after the final cycle's last phase completes.
        if ((session.mode === 'box' || session.mode === '4-7-8' || session.mode.startsWith('custom-')) && session.cycle >= session.totalCycles) {
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

    // ----- Ambient soundscape morph (same timer source as the visuals) -----
    // "Fullness" = how full the breath is (0 exhaled .. 1 inhaled), derived from
    // the same eased scale the circle uses — so audio and visuals stay locked,
    // and it works for every mode (box / coherent / 4-7-8 / custom).
    if (soundscape.active) {
      const scaleNow = phase.from + (phase.to - phase.from) * easeInOutSine(t);
      const fullness = clamp((scaleNow - SCALE_MIN) / (SCALE_MAX - SCALE_MIN), 0, 1);
      updateSoundscape(fullness);
    }

    // ----- Countdown (prominent, immediate) -----
    const remaining = Math.max(1, Math.ceil((phase.dur - session.phaseElapsed) / 1000));
    if (el.count.textContent !== String(remaining)) {
      el.count.textContent = String(remaining);
      el.countLiquid.textContent = String(remaining);
    }

    // Show/hide animations based on setting
    const useLiquid = settings.animationStyle === 'liquid';
    el.breath.hidden = useLiquid;
    el.liquidContainer.hidden = !useLiquid;

    if (useLiquid) {
      // ----- Liquid Fill Animation -----
      // Determine fill level: for inhale phases, fill goes up; for exhale, fills go down
      let fillLevel;
      if (phase.label === 'Inhale') {
        fillLevel = t;  // 0 to 1 as inhale progresses
      } else if (phase.label === 'Exhale') {
        fillLevel = 1 - t;  // 1 to 0 as exhale progresses
      } else {
        // Hold phases: maintain current level
        fillLevel = phase.from >= SCALE_MAX ? 1 : 0;
      }
      fillLevel = clamp(fillLevel, 0, 1);
      
      // Update liquid height (vessel is 240px tall, so fill from bottom)
      const maxHeight = 200;  // vessel height
      const fillHeight = maxHeight * (1 - fillLevel);
      if (el.liquidFillRect) {
        el.liquidFillRect.setAttribute('y', fillHeight);
        el.liquidFillRect.setAttribute('height', maxHeight - fillHeight);
      }
    } else {
      // ----- Circle Animation -----
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
    }

    // ----- Progress ring -----
    let progress;
    if (session.mode === 'box' || session.mode === '4-7-8' || session.mode.startsWith('custom-')) {
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
    if (session.mode === 'box' || session.mode === '4-7-8' || session.mode.startsWith('custom-')) {
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
      pauseSoundscape();
    } else {
      el.btnPause.textContent = 'Pause';
      el.btnPause.setAttribute('aria-label', 'Pause session');
      el.srAnnounce.textContent = `Resumed. ${session.phases[session.phaseIndex].label}`;
      acquireWakeLock();
      session.lastTs = 0; // avoid a dt spike on resume
      resumeSoundscape();
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
    const isCycleMode = (session.mode === 'box' || session.mode === '4-7-8' || session.mode.startsWith('custom-'));
    const durationMs = isCycleMode ? session.totalDuration : session.sessionElapsed;
    const cyclesDone = isCycleMode ? session.totalCycles : session.cycle;
    const modeId = session.mode;
    const calmBefore = pendingCalmBefore;
    endEngine();

    const finalize = (calmAfter) => {
      const res = recordSession({
        durationMs, mode: modeId, modeLabel: modeLabelFor(modeId),
        cycles: cyclesDone, calmBefore, calmAfter,
      });
      renderDashboard({ durationMs, cyclesDone, isCycleMode, calmBefore, calmAfter, wasAway: res.wasAway });
      pendingCalmBefore = null;
      el.srAnnounce.textContent = 'Session complete';
      showScreen('end');
    };

    // Optional calm-after self-check; the overlay sits over the (frozen) session.
    if (settings.calmCheck) showCalm('after', (val) => finalize(val));
    else finalize(null);
  }

  function endEngine() {
    session.active = false;
    session.paused = false;
    if (session.rafId) cancelAnimationFrame(session.rafId);
    session.rafId = 0;
    releaseWakeLock();
    stopSoundscape();   // gentle ~2s fade-out, then tears the graph down
    // reset circle to resting visual
    el.breath.style.transform = '';
    el.breath.style.opacity = '';
    // If a new build arrived mid-session, apply it now that we're idle.
    applyPendingUpdate();
  }

  /* =======================================================
     Screen switching + focus management
     ======================================================= */
  function showScreen(name) {
    const map = {
      welcome: el.screenWelcome,
      onboarding: el.screenOnboarding,
      start: el.screenStart,
      session: el.screenSession,
      end: el.screenEnd,
    };
    Object.entries(map).forEach(([k, node]) => { node.hidden = (k !== name); });
    // Reflect any in-session / profile changes back onto the start screen controls.
    if (name === 'start') renderStart();
    // Move focus to a sensible target (keyboard / SR users)
    const focusTarget = {
      welcome: el.btnWelcomeStart,
      onboarding: el.onboardTitle,
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
     Onboarding / welcome / greeting
     ======================================================= */
  const GOAL_MODE = { stress: 'coherent', sleep: '4-7-8', focus: 'box', habit: 'coherent', explore: null };
  const MODE_FRIENDLY = {
    box: 'Focus — Box breathing',
    coherent: 'Relax — Coherent breathing',
    '4-7-8': 'Sleep — 4-7-8 breathing',
  };

  function selectChipByData(container, attr, value) {
    container.querySelectorAll('.chip').forEach((c) => {
      c.setAttribute('aria-checked', value && c.getAttribute('data-' + attr) === value ? 'true' : 'false');
    });
  }
  function getCheckedChip(container, attr) {
    const c = container.querySelector('.chip[aria-checked="true"]');
    return c ? c.getAttribute('data-' + attr) : '';
  }
  function getCheckedGoals() {
    return Array.from(el.onboardGoal.querySelectorAll('.chip[aria-checked="true"]'))
      .map((c) => c.getAttribute('data-goal'));
  }
  function selectGoalChips(values) {
    const set = new Set(values || []);
    el.onboardGoal.querySelectorAll('.chip').forEach((c) => {
      c.setAttribute('aria-checked', set.has(c.getAttribute('data-goal')) ? 'true' : 'false');
    });
  }
  // With multiple goals, suggest a mode from the first selected goal that maps to one.
  function suggestedModeForGoals(goals) {
    for (const g of goals) { if (GOAL_MODE[g]) return GOAL_MODE[g]; }
    return null;
  }
  function updateGoalSuggestion() {
    const mode = suggestedModeForGoals(getCheckedGoals());
    if (mode && MODE_FRIENDLY[mode]) {
      el.onboardSuggestion.textContent = `Suggested to start: ${MODE_FRIENDLY[mode]}. You can change it anytime.`;
      el.onboardSuggestion.hidden = false;
    } else {
      el.onboardSuggestion.hidden = true;
      el.onboardSuggestion.textContent = '';
    }
  }
  function renderOnboarding() {
    el.onboardName.value = profile.name || '';
    selectChipByData(el.onboardAge, 'age', profile.age);
    selectGoalChips(profile.goals);
    updateGoalSuggestion();
  }
  function finishOnboarding(skip) {
    if (!skip) {
      profile.name = (el.onboardName.value || '').trim().slice(0, 40);
      profile.age = getCheckedChip(el.onboardAge, 'age');
      profile.goals = getCheckedGoals();
      const mode = suggestedModeForGoals(profile.goals);
      if (mode) { settings.mode = mode; saveSettings(); } // overridable suggestion
    }
    profile.welcomed = true;
    profile.onboarded = true;
    saveProfile();
    showScreen('start');
  }

  function armWelcomeChime() {
    // Chime plays on the first touch of the welcome screen (a valid gesture).
    el.screenWelcome.addEventListener('pointerdown', () => playChime(), { once: true });
  }

  function updateGreeting() {
    const name = (profile.name || '').trim();
    const hasHistory = progress.history.length > 0;
    if (!name && !hasHistory) {
      el.greeting.hidden = true;
      if (el.mastheadSub) el.mastheadSub.hidden = false;
      return;
    }
    const parts = [];
    if (progress.streak.current > 0) parts.push(`🔥 ${progress.streak.current}-day streak`);
    if (progress.points > 0) parts.push(`${progress.points} pts`);
    const away = progress.streak.lastDate && dayDiff(progress.streak.lastDate, todayStr()) >= 2;
    let lead;
    if (away) lead = name ? `Welcome back, ${name} — let's pick up where you left off.` : `Welcome back — let's pick up where you left off.`;
    else if (name) lead = `Hello, ${name}.`;
    else lead = `Welcome back.`;
    el.greeting.textContent = parts.length ? `${lead}  ·  ${parts.join('  ·  ')}` : lead;
    el.greeting.hidden = false;
    if (el.mastheadSub) el.mastheadSub.hidden = true; // avoid redundancy with the greeting
  }

  /* =======================================================
     Calm check (optional, before & after)
     ======================================================= */
  let calmOnPick = null;
  let pendingCalmBefore = null;

  function showCalm(phase, onPick) {
    calmOnPick = onPick;
    el.calmTitle.textContent = phase === 'before' ? 'How calm do you feel right now?' : 'How calm do you feel now?';
    el.calmSub.textContent = phase === 'before'
      ? 'A quick self-check before you begin — there are no wrong answers.'
      : 'Your own self-report — not a measurement.';
    el.calmOverlay.hidden = false;
    requestAnimationFrame(() => { const f = el.calmOverlay.querySelector('.calm-btn'); if (f) f.focus(); });
  }
  function resolveCalm(val) {
    const cb = calmOnPick;
    calmOnPick = null;
    el.calmOverlay.hidden = true;
    if (cb) cb(val);
  }

  function beginSessionFlow() {
    initAudio(); // unlock audio inside the user gesture
    if (settings.calmCheck) {
      showCalm('before', (val) => { pendingCalmBefore = val; startSession(); });
    } else {
      pendingCalmBefore = null;
      startSession();
    }
  }

  /* =======================================================
     End-of-session dashboard (honest — real data + general science)
     ======================================================= */
  function renderDashboard(d) {
    const name = (profile.name || '').trim();
    el.endSub.textContent = name ? `Nicely done, ${name}.` : 'Nicely done. Take that calm with you.';

    el.endTime.textContent = formatDuration(d.durationMs);
    el.endCountK.textContent = d.isCycleMode ? 'Cycles' : 'Breaths';
    el.endCount.textContent = String(d.cyclesDone);
    el.endStreak.textContent = String(progress.streak.current);
    el.endPoints.textContent = String(progress.points);
    el.endSessions.textContent = String(progress.history.length);
    el.endLifetime.textContent = formatDuration(lifetimeMs());

    // Effective-dose ring: real minutes today vs the 5–10 min research range.
    // Floor the shown figure so we never over-claim reaching the range.
    const todayMin = minutesToday();
    const shownMin = Math.floor(todayMin);
    const C = 2 * Math.PI * 52;
    const prog = clamp(todayMin / 10, 0, 1);
    el.doseFill.style.strokeDashoffset = (C * (1 - prog)).toFixed(2);
    el.doseNum.textContent = String(shownMin);
    el.doseCaption.textContent = shownMin >= 5
      ? `You've reached the 5–10 min daily range that studies link to lower stress.`
      : `${5 - shownMin} more min today reaches the 5–10 min range studies link to lower stress.`;

    // Consistency milestone — framed as general info, not a personal measurement.
    const days = doseDaysThisWeek();
    let milestone = days > 0
      ? `You've hit the ~5–10 min daily dose on ${days} day${days === 1 ? '' : 's'} in the last week.`
      : `Small and consistent wins — aim for ~5–10 min a day.`;
    if (d.wasAway) milestone = `Welcome back — picking up right where you left off.  ` + milestone;
    el.endMilestone.textContent = milestone;

    // Calm self-report — always labeled as the user's own rating, never a biomarker.
    const delta = calmDeltaAvg();
    if (d.calmBefore != null && d.calmAfter != null) {
      const diff = d.calmAfter - d.calmBefore;
      let line = diff > 0
        ? `You felt ${diff} point${diff === 1 ? '' : 's'} calmer after this session (${d.calmBefore} → ${d.calmAfter}, your own rating).`
        : diff === 0
        ? `You rated your calm the same before and after (${d.calmBefore} → ${d.calmAfter}).`
        : `A little less calm this time (${d.calmBefore} → ${d.calmAfter}) — some days are heavier, and that's okay.`;
      if (delta && delta.n >= 3) {
        const a = Math.round(delta.avg * 10) / 10;
        line += ` On average you report feeling ${a >= 0 ? '+' : ''}${a} points calmer after a session.`;
      }
      el.endCalm.textContent = line;
      el.endCalm.hidden = false;
    } else if (delta && delta.n >= 1) {
      const a = Math.round(delta.avg * 10) / 10;
      el.endCalm.textContent = `On average you report feeling ${a >= 0 ? '+' : ''}${a} points calmer after a session (your own self-report).`;
      el.endCalm.hidden = false;
    } else {
      el.endCalm.hidden = true;
      el.endCalm.textContent = '';
    }
  }

  /* =======================================================
     Data export (JSON / CSV) — local file, with a readme header
     ======================================================= */
  function buildExportObject() {
    return {
      _readme: {
        app: 'Breathe',
        exportedAt: new Date().toISOString(),
        privacy: 'This data is stored only on your device. The file was created on-device and is never uploaded.',
        fields: {
          'profile.name': 'Your name (for personalization)',
          'profile.age': 'Your selected age range',
          'profile.goals': 'Your selected goals (one or more)',
          points: 'Total encouragement points',
          'streak.current': 'Forgiving day-streak — only grows; a missed day pauses it and never resets to zero',
          'streak.longest': 'Highest streak reached',
          'streak.lastDate': 'Last practice day (local YYYY-MM-DD)',
          'sessions[].date': 'Practice day (local YYYY-MM-DD)',
          'sessions[].ts': 'Timestamp (epoch milliseconds)',
          'sessions[].mode': 'Internal mode id',
          'sessions[].modeLabel': 'Human-readable mode',
          'sessions[].durationMs': 'Session length in milliseconds',
          'sessions[].minutes': 'Session length in minutes',
          'sessions[].cycles': 'Completed cycles (breaths for coherent)',
          'sessions[].points': 'Points earned that session',
          'sessions[].calmBefore': 'Your 1–5 calm self-rating before (or null)',
          'sessions[].calmAfter': 'Your 1–5 calm self-rating after (or null)',
        },
      },
      profile: { name: profile.name, age: profile.age, goals: profile.goals },
      points: progress.points,
      streak: progress.streak,
      sessions: progress.history,
    };
  }
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCSV() {
    const lines = [];
    lines.push('# Breathe practice history — stored locally on your device, never uploaded.');
    lines.push('# Columns: date (local), time_iso, mode, duration_min, cycles, points, calm_before (1-5 self-report), calm_after (1-5 self-report)');
    lines.push('date,time_iso,mode,duration_min,cycles,points,calm_before,calm_after');
    progress.history.forEach((h) => {
      lines.push([
        h.date,
        new Date(h.ts).toISOString(),
        csvCell(h.modeLabel || h.mode),
        (h.durationMs / 60000).toFixed(1),
        h.cycles,
        h.points,
        h.calmBefore == null ? '' : h.calmBefore,
        h.calmAfter == null ? '' : h.calmAfter,
      ].join(','));
    });
    lines.push('');
    lines.push(`# Totals: sessions=${progress.history.length}, points=${progress.points}, current_streak=${progress.streak.current}, lifetime_min=${(lifetimeMs() / 60000).toFixed(1)}`);
    return lines.join('\n');
  }
  function downloadFile(filename, text, type) {
    try {
      const blob = new Blob([text], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {}
  }
  async function exportFile(filename, text, type) {
    // Prefer the share sheet where supported (lets iOS save to Files); else download.
    try {
      if (navigator.canShare) {
        const file = new File([text], filename, { type });
        if (navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: 'Breathe data' }); }
          catch { /* user cancelled — leave it */ }
          return;
        }
      }
    } catch {}
    downloadFile(filename, text, type);
  }

  /* =======================================================
     Wiring
     ======================================================= */
  el.startForm.addEventListener('submit', (e) => {
    e.preventDefault();
    beginSessionFlow();
  });

  el.btnPause.addEventListener('click', togglePause);
  el.btnStop.addEventListener('click', stopSession);
  el.btnRestart.addEventListener('click', beginSessionFlow);
  el.btnHome.addEventListener('click', () => showScreen('start'));

  // ----- Welcome / onboarding -----
  el.btnWelcomeStart.addEventListener('click', () => {
    profile.welcomed = true; saveProfile();
    renderOnboarding();
    showScreen('onboarding');
  });
  el.onboardForm.addEventListener('submit', (e) => { e.preventDefault(); finishOnboarding(false); });
  el.btnOnboardSkip.addEventListener('click', () => finishOnboarding(true));
  // Age: single-select (one range).
  el.onboardAge.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      el.onboardAge.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', 'false'));
      chip.setAttribute('aria-checked', 'true');
    });
  });
  // Goals: multi-select (toggle each independently).
  el.onboardGoal.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.setAttribute('aria-checked', chip.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
      updateGoalSuggestion();
    });
  });

  // ----- Profile & data -----
  el.optCalm.addEventListener('click', () => { settings.calmCheck = !settings.calmCheck; saveSettings(); renderStart(); });
  el.btnEditProfile.addEventListener('click', () => { renderOnboarding(); showScreen('onboarding'); });
  el.btnReplayWelcome.addEventListener('click', () => { armWelcomeChime(); showScreen('welcome'); });
  el.btnExportJson.addEventListener('click', () => exportFile(`breathe-data-${todayStr()}.json`, JSON.stringify(buildExportObject(), null, 2), 'application/json'));
  el.btnExportCsv.addEventListener('click', () => exportFile(`breathe-data-${todayStr()}.csv`, buildCSV(), 'text/csv'));

  // ----- Calm check overlay -----
  el.calmOverlay.querySelectorAll('.calm-btn').forEach((btn) => {
    btn.addEventListener('click', () => resolveCalm(parseInt(btn.getAttribute('data-calm'), 10)));
  });
  el.btnCalmSkip.addEventListener('click', () => resolveCalm(null));
  el.calmOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); resolveCalm(null); }
  });

  // ----- In-session audio controls -----
  el.btnMute.addEventListener('click', () => setMuted(!muted));

  el.btnAudioPanel.addEventListener('click', () => {
    const willOpen = el.audioPanel.hidden;
    el.audioPanel.hidden = !willOpen;
    el.btnAudioPanel.setAttribute('aria-expanded', String(willOpen));
  });

  el.sessOptSound.addEventListener('click', () => {
    settings.sound = !settings.sound;
    saveSettings();
    if (settings.sound) initAudio(); // ensure the context exists if enabling mid-session
    updateAudioButtons();
  });

  el.sessOptSoundscape.addEventListener('click', () => {
    settings.soundscape = !settings.soundscape;
    saveSettings();
    if (settings.soundscape) {
      startSoundscape();                       // builds + fades in (silent if muted)
      if (session.paused) pauseSoundscape();   // stay silent until the session resumes
    } else {
      stopSoundscape();                        // fades out, then tears down
    }
    updateAudioButtons();
  });

  el.sessSoundscapeVolume.addEventListener('input', () => {
    settings.soundscapeVolume = clamp(parseInt(el.sessSoundscapeVolume.value, 10) / 100 || 0, 0, 1);
    saveSettings();
    if (soundscape.active && !soundscape.stopping) fadeSoundscape(soundscapeAudibleTarget(), 0.25);
  });

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
  el.onboardTitle.tabIndex = -1; // focusable target for screen switches
  renderStart();
  if (!profile.welcomed) { armWelcomeChime(); showScreen('welcome'); }
  else if (!profile.onboarded) { renderOnboarding(); showScreen('onboarding'); }
  else { showScreen('start'); }

  // Register service worker (offline) + reliable, calm updates.
  if ('serviceWorker' in navigator) {
    let refreshing = false;
    const reloadForUpdate = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    // When a new build activates, the SW messages us. Apply it at a calm moment:
    // immediately if idle, otherwise after the current breathing session ends
    // (handled in endEngine) — we never yank the screen mid-session.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (!e.data || e.data.type !== 'SW_UPDATED') return;
      if (session.active) pendingUpdateReload = true;
      else reloadForUpdate();
    });

    window.addEventListener('load', () => {
      // updateViaCache:'none' → never serve sw.js itself from the HTTP cache,
      // so a new deploy is always detected.
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          reg.update().catch(() => {});                 // check on every load
          // And check again whenever the app regains focus.
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') reg.update().catch(() => {});
          });
        })
        .catch(() => {});
    });

    // Expose the reload helper so endEngine can apply a pending update.
    applyPendingUpdate = () => { if (pendingUpdateReload) reloadForUpdate(); };
  }
})();
