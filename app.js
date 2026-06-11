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

  /* =======================================================
     MOODS — six user-selectable palettes. The CSS variable sets
     (dark + light per mood) live in styles.css via [data-mood].
     Here: picker metadata + orb tints. orb2d = [r,g,b] 0-255 for
     the canvas orb; orb3d = [r,g,b] 0-1 for the WebGL shaders.
     The gold progress ring is a brand constant in every mood.
     ======================================================= */
  const MOODS = {
    sky: {
      name: 'Sky', tag: 'light & peaceful', dot: '#7fb6cf',
      orb2d: { top: [126,186,228], mid: [58,120,168], deep: [28,68,108], bloom: [120,190,235],
               hi: [178,220,248], rim: [150,200,235], rimGlow: [120,182,226], inner0: [48,70,98], inner1: [16,26,40] },
      orb3d: { shallow: [0.42,0.68,0.90], deep: [0.07,0.25,0.47], glow: [0.50,0.75,1.0],
               surfIn: [0.60,0.82,1.0], surfOut: [0.30,0.58,0.86], glass: [0.55,0.78,1.0] },
    },
    night: {
      name: 'Night', tag: 'deep & restful', dot: '#a89ada',
      orb2d: { top: [168,150,224], mid: [109,91,166], deep: [56,44,100], bloom: [170,150,235],
               hi: [205,190,245], rim: [175,160,230], rimGlow: [150,135,215], inner0: [58,52,92], inner1: [20,18,40] },
      orb3d: { shallow: [0.66,0.59,0.88], deep: [0.20,0.15,0.40], glow: [0.70,0.60,1.0],
               surfIn: [0.80,0.74,0.98], surfOut: [0.48,0.40,0.78], glass: [0.70,0.62,0.98] },
    },
    desert: {
      name: 'Desert', tag: 'warm & grounding', dot: '#d9aa5e',
      orb2d: { top: [235,190,120], mid: [185,135,70], deep: [110,75,35], bloom: [240,200,130],
               hi: [248,220,170], rim: [230,195,140], rimGlow: [220,180,120], inner0: [90,70,45], inner1: [38,28,16] },
      orb3d: { shallow: [0.92,0.74,0.46], deep: [0.42,0.28,0.12], glow: [1.0,0.82,0.50],
               surfIn: [0.97,0.86,0.62], surfOut: [0.74,0.55,0.30], glass: [0.95,0.80,0.55] },
    },
    forest: {
      name: 'Forest', tag: 'natural & healing', dot: '#8fbf9f',
      orb2d: { top: [140,200,160], mid: [80,140,105], deep: [35,85,60], bloom: [140,210,170],
               hi: [185,230,200], rim: [150,210,175], rimGlow: [120,190,150], inner0: [50,80,62], inner1: [16,34,24] },
      orb3d: { shallow: [0.55,0.78,0.62], deep: [0.12,0.33,0.22], glow: [0.55,0.85,0.65],
               surfIn: [0.74,0.92,0.79], surfOut: [0.34,0.60,0.44], glass: [0.60,0.85,0.68] },
    },
    ocean: {
      name: 'Ocean', tag: 'fluid & releasing', dot: '#5bc0be',
      orb2d: { top: [110,205,200], mid: [55,150,148], deep: [22,90,92], bloom: [120,215,210],
               hi: [175,235,232], rim: [140,215,210], rimGlow: [105,195,190], inner0: [42,82,84], inner1: [12,32,34] },
      orb3d: { shallow: [0.43,0.80,0.78], deep: [0.08,0.34,0.35], glow: [0.45,0.85,0.83],
               surfIn: [0.70,0.93,0.91], surfOut: [0.24,0.60,0.59], glass: [0.50,0.85,0.82] },
    },
    zen: {
      name: 'Zen', tag: 'clean & focused', dot: '#9aa7b2',
      orb2d: { top: [165,190,210], mid: [105,130,152], deep: [55,75,95], bloom: [160,190,215],
               hi: [200,220,235], rim: [170,195,215], rimGlow: [140,170,195], inner0: [62,72,84], inner1: [22,26,32] },
      orb3d: { shallow: [0.65,0.74,0.82], deep: [0.21,0.29,0.37], glow: [0.62,0.74,0.85],
               surfIn: [0.79,0.86,0.92], surfOut: [0.42,0.52,0.61], glass: [0.66,0.76,0.86] },
    },
  };
  const moodOf = (id) => MOODS[id] || MOODS.sky;

  /* ---------- Settings (persisted) ---------- */
  const DEFAULTS = {
    mode: 'box',
    cycles: 5,          // box & 4-7-8: default 5, range 2–8
    duration: 5,        // coherent: 5 or 10 (minutes)
    sound: true,
    haptic: true,
    theme: 'dark',      // 'dark' | 'light'
    mood: 'sky',        // mood palette: sky | night | desert | forest | ocean | zen
    animationStyle: 'liquid3d',  // always the 3D orb (2D is only an internal fallback)
    bgTrack: 'leberch', // ambient music (on by default): 'off' | 'leberch' | 'starostin'
    bgVolume: 0.5,      // background music volume (0..1)
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
        mood: MOODS[s.mood] ? s.mood : 'sky',
        animationStyle: 'liquid3d', // always 3D now (render() falls back to 2D only for reduced-motion / no-WebGL)
        bgTrack: ['off', 'leberch', 'starostin'].includes(s.bgTrack) ? s.bgTrack : 'off',
        bgVolume: clamp(parseFloat(s.bgVolume != null ? s.bgVolume : s.soundscapeVolume) || DEFAULTS.bgVolume, 0, 1),
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

  // One-time migration: ambient music is now ON by default. Returning users carry
  // the old 'off' default, so flip it up once. A flag makes this run a single time,
  // so anyone who later deliberately turns music off in the gear keeps it off.
  try {
    const MIGRATED_KEY = 'breathe.ambientOnByDefault.v1';
    if (!localStorage.getItem(MIGRATED_KEY)) {
      if (settings.bgTrack === 'off') { settings.bgTrack = DEFAULTS.bgTrack; saveSettings(); }
      localStorage.setItem(MIGRATED_KEY, '1');
    }
  } catch {}

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
    bgSelect: $('bg-select'),
    bgVolume: $('bg-volume'),
    moodSelect: $('mood-select'),

    // Global settings gear (every screen)
    btnGear: $('btn-gear'),
    settingsOverlay: $('settings-overlay'),
    btnSettingsDone: $('btn-settings-done'),

    startForm: $('start-form'),
    btnStart: $('btn-start'),

    cycleCounter: $('cycle-counter'),
    breath: $('breath'),
    phaseLabel: $('phase-label'),
    count: $('count'),
    breathMethod: $('breath-method'),
    breathCue: $('breath-cue'),
    breathSymbol: $('breath-symbol'),
    breathChest: $('breath-chest'),
    ringFill: document.querySelector('.ring__fill'),
    btnPause: $('btn-pause'),
    btnStop: $('btn-stop'),

    endTime: $('end-time'),
    endCount: $('end-count'),
    endCountK: $('end-count-k'),
    btnRestart: $('btn-restart'),
    btnHome: $('btn-home'),

    srAnnounce: $('sr-announce'),
    beginnerHint: $('beginner-hint'),
    cyclesRecommended: $('cycles-recommended'),
    liquidContainer: $('liquid-container'),
    orbCanvas: $('orb-canvas'),
    orb3dCanvas: $('orb3d-canvas'),
    phaseLabelLiquid: $('phase-label-liquid'),
    countLiquid: $('count-liquid'),

    // Welcome
    screenWelcome: $('screen-welcome'),
    btnWelcomeStart: $('btn-welcome-start'),

    // How it works (beginner walkthrough)
    screenLearn: $('screen-learn'),
    learnScene: $('learn-scene'),
    learnSymbol: $('learn-symbol'),
    learnOrbCanvas: $('learn-orb-canvas'),
    learnChestGlow: $('learn-chest-glow'),
    learnPhase: $('learn-phase'),
    learnCue: $('learn-cue'),
    learnSteps: $('learn-steps'),
    learnStatic: $('learn-static'),
    btnLearnContinue: $('btn-learn-continue'),
    btnHowItWorks: $('btn-how-it-works'),

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
    btnExportSummary: $('btn-export-summary'),
    btnExportCsv: $('btn-export-csv'),
    btnShare: $('btn-share'),
    btnReplayWelcome: $('btn-replay-welcome'),

    // Dashboard extras
    endSub: $('end-sub'),
    endEarned: $('end-earned'),
    endEarnedNum: $('end-earned-num'),
    endStreak: $('end-streak'),
    endPoints: $('end-points'),
    endSessions: $('end-sessions'),
    endLifetime: $('end-lifetime'),
    endMilestone: $('end-milestone'),
    endCalm: $('end-calm'),
    dose: document.querySelector('.dose'),
    doseFill: document.querySelector('.dose__fill'),
    doseNum: $('dose-num'),
    doseCaption: $('dose-caption'),

    // My summary card
    screenSummary: $('screen-summary'),
    summaryTitle: $('summary-title'),
    summarySub: $('summary-sub'),
    sumSessions: $('sum-sessions'),
    sumLifetime: $('sum-lifetime'),
    sumRhythm: $('sum-rhythm'),
    sumPoints: $('sum-points'),
    sumWeek: $('sum-week'),
    sumAvg: $('sum-avg'),
    sumTrend: $('sum-trend'),
    sumCalmNote: $('sum-calm-note'),
    btnShareSummary: $('btn-share-summary'),
    btnSummaryDone: $('btn-summary-done'),
    btnSummaryCsv: $('btn-summary-csv'),

    // Calm overlay
    calmOverlay: $('calm-overlay'),
    calmTitle: $('calm-q'),
    calmSub: $('calm-sub'),
    btnCalmSkip: $('btn-calm-skip'),

    // Export sheet
    exportOverlay: $('export-overlay'),
    exportText: $('export-text'),
    exportSub: $('export-sub'),
    exportCopy: $('export-copy'),
    exportShare: $('export-share'),
    exportDownload: $('export-download'),
    exportClose: $('export-close'),
  };

  const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Theme (mood palette + light/dark variant) ---------- */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.setAttribute('data-mood', settings.mood);
    // Tint the 3D orb if it's loaded (it also gets tinted right after lazy load).
    if (orb3dApi && orb3dApi.setTint) { try { orb3dApi.setTint(moodOf(settings.mood).orb3d); } catch {} }
    // Keep the browser/PWA chrome color in step with the mood background.
    try {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
    } catch {}
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
    setSwitch(el.optCalm, settings.calmCheck);
    setSwitch(el.optTheme, settings.theme === 'light');

    // Mood palette (lives in the global gear)
    el.moodSelect.querySelectorAll('.mood-chip').forEach((b) => {
      b.setAttribute('aria-checked', b.getAttribute('data-mood') === settings.mood ? 'true' : 'false');
    });

    // Ambient music: selection + volume (lives in the global gear)
    el.bgSelect.querySelectorAll('.segmented__btn').forEach((b) => {
      b.setAttribute('aria-checked', b.getAttribute('data-track') === settings.bgTrack ? 'true' : 'false');
    });
    el.bgVolume.value = String(Math.round(settings.bgVolume * 100));
    el.bgVolume.disabled = (settings.bgTrack === 'off');

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

  // Ambient music: choose a track — crossfades the always-on music live.
  el.bgSelect.querySelectorAll('.segmented__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const track = btn.getAttribute('data-track');
      if (track === settings.bgTrack) return;
      settings.bgTrack = track;
      saveSettings();
      renderStart();
      initAudio();            // unlock on this gesture if not already
      applyTrackChange(track); // start / crossfade / stop the continuous music
    });
  });
  el.bgVolume.addEventListener('input', () => {
    settings.bgVolume = clamp(parseInt(el.bgVolume.value, 10) / 100 || 0, 0, 1);
    saveSettings();
    setMusicVolume(); // live-adjust (honoured on desktop/Android)
  });
  el.optTheme.addEventListener('click', () => {
    settings.theme = settings.theme === 'light' ? 'dark' : 'light';
    saveSettings(); applyTheme(); renderStart();
  });

  // Mood picker: retheme the whole app (CSS variables + both orbs) instantly.
  el.moodSelect.querySelectorAll('.mood-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const mood = chip.getAttribute('data-mood');
      if (!MOODS[mood] || mood === settings.mood) return;
      settings.mood = mood;
      saveSettings(); applyTheme(); renderStart();
    });
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
    if (!settings.sound && settings.bgTrack === 'off') return;
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
     AMBIENT MUSIC — always-on looping MP3 (user-chosen track)
     Plays continuously across the whole app, not tied to a session.

     IMPORTANT (mobile): the MP3 is played by a PLAIN <audio> element and is
     NOT routed through Web Audio. On iOS, AudioContext output is silenced by
     the hardware ring/silent switch, whereas a media element plays through the
     "playback" audio session — so the music is audible even when the phone is
     on silent (the right behaviour for a calm/breathing app, and what makes it
     work on mobile at all). Volume is set via element.volume — honoured on
     desktop & Android; on iOS the hardware volume governs it (the slider is a
     gentle no-op there). Looping is native (loop=true).
     ======================================================= */
  const TRACKS = [
    { id: 'leberch',   name: 'Meditation — Leberch',   src: 'audio/meditation-leberch.mp3' },
    { id: 'starostin', name: 'Meditation — Starostin', src: 'audio/meditation-starostin.mp3' },
  ];
  function trackById(id) { return TRACKS.find((t) => t.id === id) || null; }

  // Vestigial mute flag — kept so playTone()'s guard still compiles. Cue tones
  // are never force-muted; this stays permanently false.
  let muted = false;

  let musicEl = null;        // the single looping <audio> element (current track)
  let musicFadeTimer = 0;
  const musicVol = (v) => Math.max(0, Math.min(1, v));
  // Ceiling on the ambient track so even at max slider it stays well UNDER the
  // breathing cue tones. Lowered further to 0.3 (~a third of full volume).
  const MUSIC_MAX = 0.3;
  const musicTarget = () => musicVol(settings.bgVolume) * MUSIC_MAX;

  // Smoothly ramp element.volume to a target over `seconds` (no-op on iOS, where
  // volume is read-only — there it simply jumps/stays at the system level).
  function musicFadeTo(target, seconds, thenPause) {
    if (!musicEl) return;
    clearInterval(musicFadeTimer); musicFadeTimer = 0;
    const owner = musicEl;
    const to = musicVol(target);
    let from = owner.volume; if (!isFinite(from)) from = 0;
    const steps = Math.max(1, Math.round(Math.max(0.05, seconds) * 30));
    let step = 0;
    musicFadeTimer = setInterval(() => {
      if (musicEl !== owner) { clearInterval(musicFadeTimer); musicFadeTimer = 0; return; }
      step++;
      try { owner.volume = musicVol(from + (to - from) * (step / steps)); } catch {}
      if (step >= steps) {
        clearInterval(musicFadeTimer); musicFadeTimer = 0;
        if (thenPause) { try { owner.pause(); } catch {} }
      }
    }, 1000 / 30);
  }

  // Build (or rebuild) the looping element for a track and fade it in.
  function buildMusicEl(track) {
    if (musicEl) { try { musicEl.pause(); musicEl.src = ''; musicEl.load(); } catch {} musicEl = null; }
    clearInterval(musicFadeTimer); musicFadeTimer = 0;
    const a = new Audio(track.src);
    a.loop = true;
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    a.dataset.track = track.id;
    a.volume = 0;
    musicEl = a;
    const p = a.play();
    if (p && p.catch) p.catch(() => {}); // blocked before a gesture; a later gesture retries
    musicFadeTo(musicTarget(), 1.4, false);
  }

  // Always-on ambient music: plays continuously across the WHOLE app (welcome →
  // onboarding → home → session → end), independent of any session. Starts on the
  // user's first gesture (autoplay policy) and only stops when they choose "Off".
  // Pausing a session does NOT pause it. Safe to call repeatedly.
  function startMusic() {
    if (settings.bgTrack === 'off') return;
    const track = trackById(settings.bgTrack);
    if (!track) return;
    if (musicEl && musicEl.dataset.track === settings.bgTrack) {
      if (musicEl.paused) { const p = musicEl.play(); if (p && p.catch) p.catch(() => {}); }
      musicFadeTo(musicTarget(), 1.0, false);
      return; // already on this track
    }
    buildMusicEl(track);
  }

  // React to a track change from the gear: start / swap / stop the music live.
  function applyTrackChange(trackId) {
    if (trackId === 'off') { if (musicEl) musicFadeTo(0, 1.0, true); return; }
    const track = trackById(trackId);
    if (track) buildMusicEl(track); // fresh element fades in (old one torn down)
  }

  // Live volume from the gear slider (gentle ramp; no-op on iOS).
  function setMusicVolume() {
    if (musicEl && !musicEl.paused) musicFadeTo(musicTarget(), 0.2, false);
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

    // Ambient music is global and already playing across the app — the session
    // doesn't start, stop, or own it. Just make sure it's going (e.g. if the
    // first gesture was this very tap).
    startMusic();

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

    // Cue beside the figure: nose/mouth symbol + airflow. The figure itself
    // (with its filling chest) is persistent and synced in render(). On a hold,
    // the symbol + arrows fade out and the figure simply stays at its fill level.
    el.breathCue.classList.remove('is-in', 'is-out', 'is-hold');
    if (phase.label === 'Inhale') {
      el.breathSymbol.src = 'assets/nose.png';
      el.breathMethod.textContent = 'in through your nose';
      el.breathCue.classList.add('is-in');
    } else if (phase.label === 'Exhale') {
      const nasal = session.mode === 'coherent';
      el.breathSymbol.src = nasal ? 'assets/nose.png' : 'assets/mouth.png';
      el.breathMethod.textContent = nasal ? 'out through your nose' : 'out through your mouth';
      el.breathCue.classList.add('is-out');
    } else { // Hold
      el.breathMethod.textContent = 'hold gently';
      el.breathCue.classList.add('is-hold');
    }
    el.breathCue.classList.add('is-on');

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

  /* =======================================================
     LIQUID — a glowing magical orb (canvas)
     A circular vessel; blue liquid clipped strictly inside it, rising/falling
     with the breath. Soft wavy surface, gentle inner glow, and white/warm-yellow
     particles that appear as the liquid rises (more when fuller) and drift/twinkle
     slowly. prefers-reduced-motion → flat calm fill, no waves or particles.
     ======================================================= */
  const orb = { canvas: null, ctx: null, particles: null, spriteWhite: null, spriteWarm: null };

  // ---- Experimental 3D orb: lazy-loaded Three.js module (offline-precached).
  //      Any failure (no WebGL, load error, shader error caught) leaves
  //      orb3dState !== 'ready', so render() quietly uses the 2D orb instead. ----
  let orb3dState = 'idle'; // 'idle' | 'loading' | 'ready' | 'failed'
  let orb3dApi = null;
  function ensureOrb3d() {
    if (orb3dState !== 'idle') return;
    orb3dState = 'loading';
    import('./orb3d.js')
      .then((mod) => {
        try {
          mod.init(el.orb3dCanvas);
          if (mod.setTint) mod.setTint(moodOf(settings.mood).orb3d); // current mood from the start
          orb3dApi = mod; orb3dState = 'ready';
        }
        catch (e) { orb3dState = 'failed'; }
      })
      .catch(() => { orb3dState = 'failed'; });
  }

  function makeGlowSprite(rgb) {
    const c = document.createElement('canvas');
    const S = 32; c.width = S; c.height = S;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, `rgba(${rgb},1)`);
    grad.addColorStop(0.35, `rgba(${rgb},0.55)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    return c;
  }
  function buildOrbParticles() {
    const arr = [];
    for (let i = 0; i < 34; i++) {
      arr.push({
        hf: 0.04 + Math.random() * 0.92,        // height fraction (0 bottom .. 1 top)
        nx: (Math.random() * 2 - 1) * 0.82,      // horizontal, fraction of half-width
        warm: Math.random() < 0.42,              // white vs warm-yellow
        size: 0.012 + Math.random() * 0.02,      // radius as fraction of orb R
        baseA: 0.5 + Math.random() * 0.5,
        tws: 0.5 + Math.random() * 1.1, twp: Math.random() * 6.28, // twinkle
        dsx: 0.15 + Math.random() * 0.3, phx: Math.random() * 6.28, // drift
        dsy: 0.12 + Math.random() * 0.25, phy: Math.random() * 6.28,
      });
    }
    return arr;
  }
  function ensureOrb() {
    if (orb.ctx) return true;
    if (!el.orbCanvas) return false;
    orb.canvas = el.orbCanvas;
    orb.ctx = el.orbCanvas.getContext('2d');
    if (!orb.ctx) return false;
    orb.particles = buildOrbParticles();
    orb.spriteWhite = makeGlowSprite('255,248,232'); // soft warm white
    orb.spriteWarm = makeGlowSprite('255,221,150');  // warm yellow
    return true;
  }

  // rgba() string from a mood tint triple
  const rgbaOf = (t, a) => 'rgba(' + t[0] + ',' + t[1] + ',' + t[2] + ',' + a + ')';

  function drawOrb(fill, timeMs, inst) {
    inst = inst || orb;
    const T = moodOf(settings.mood).orb2d; // current mood tint
    const c = inst.canvas, ctx = inst.ctx;
    const cssW = c.clientWidth, cssH = c.clientHeight;
    if (!cssW || !cssH) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const reduced = prefersReducedMotion();
    const time = timeMs / 1000;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - dpr * 1.5;
    const surfaceY = cy + R - fill * 2 * R; // fill 0 → bottom, fill 1 → top
    // Real liquid surface = a superposition of STANDING-WAVE sloshing modes
    // (antisymmetric "rock" + symmetric centre swell + a higher undulation),
    // each a curved eigenmode oscillating at its own slow, incommensurate
    // frequency, plus fine ripples. Because the curvature itself moves, it
    // reads as gentle rolling waves — not a rigid tilting line. Calm by design
    // (low amplitudes, slow speeds); reduced-motion → perfectly flat.
    const PI = Math.PI;
    const waveAt = (x) => {
      if (reduced) return surfaceY;
      const u = (x - cx) / R;                 // -1 (left) .. +1 (right)
      const eta =
          0.140 * Math.sin(u * PI * 0.5) * Math.sin(time * 0.40)         // mode 1: antisymmetric rock (curved)
        + 0.060 * Math.cos(u * PI)       * Math.sin(time * 0.63 + 1.3)   // mode 2: symmetric centre swell
        + 0.045 * Math.sin(u * PI)       * Math.sin(time * 0.85 + 2.4)   // mode 3: higher undulation
        + 0.013 * Math.sin(u * 3.3 - time * 1.05)                        // fine ripple
        + 0.009 * Math.sin(u * 5.1 + time * 0.78);                       // fine ripple
      return surfaceY - eta * R;             // +eta raises the surface (crest)
    };

    // Everything liquid-side is clipped strictly inside the circle.
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();

    // Faint empty interior so the sphere reads even when empty.
    const bg = ctx.createRadialGradient(cx, cy - R * 0.25, R * 0.15, cx, cy, R);
    bg.addColorStop(0, rgbaOf(T.inner0, 0.55));  // more present so the empty vessel
    bg.addColorStop(1, rgbaOf(T.inner1, 0.78));  // reads full-size up to the ring (no gap)
    ctx.fillStyle = bg; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

    if (fill > 0.005) {
      // Liquid body (wavy top → bottom).
      const steps = 44;
      ctx.beginPath();
      ctx.moveTo(cx - R, cy + R + 2);
      ctx.lineTo(cx - R, waveAt(cx - R));
      for (let i = 0; i <= steps; i++) {
        const x = cx - R + (2 * R) * (i / steps);
        ctx.lineTo(x, waveAt(x));
      }
      ctx.lineTo(cx + R, cy + R + 2);
      ctx.closePath();
      const lg = ctx.createLinearGradient(0, surfaceY - R * 0.25, 0, cy + R);
      lg.addColorStop(0, rgbaOf(T.top, 0.95));   // brighter near surface (inner glow)
      lg.addColorStop(0.5, rgbaOf(T.mid, 0.96));
      lg.addColorStop(1, rgbaOf(T.deep, 0.97));  // deeper at the bottom
      ctx.fillStyle = lg; ctx.fill();

      // Soft inner luminosity (subtle bloom), and a gentle surface highlight.
      if (!reduced) {
        ctx.globalCompositeOperation = 'lighter';
        const gy = Math.max(surfaceY, cy) + R * 0.1;
        const gr = ctx.createRadialGradient(cx, gy, R * 0.04, cx, gy, R * 0.95);
        gr.addColorStop(0, rgbaOf(T.bloom, 0.16));
        gr.addColorStop(1, rgbaOf(T.bloom, 0));
        ctx.fillStyle = gr; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

        if (fill < 0.99) {
          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const x = cx - R + (2 * R) * (i / steps);
            if (i === 0) ctx.moveTo(x, waveAt(x)); else ctx.lineTo(x, waveAt(x));
          }
          ctx.strokeStyle = rgbaOf(T.hi, 0.45);
          ctx.lineWidth = Math.max(1, dpr);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // Magical particles — only those submerged (more appear as the liquid rises).
      if (!reduced) {
        ctx.globalCompositeOperation = 'lighter';
        for (const p of inst.particles) {
          if (p.hf >= fill) continue;
          const fadeIn = Math.min(1, (fill - p.hf) / 0.10); // ease in as the surface passes
          const dyN = 1 - 2 * p.hf;
          const halfW = Math.sqrt(Math.max(0, 1 - dyN * dyN));
          const px = cx + p.nx * halfW * R + Math.sin(time * p.dsx + p.phx) * R * 0.02;
          const py = cy + dyN * R + Math.sin(time * p.dsy + p.phy) * R * 0.02;
          const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time * p.tws + p.twp));
          const size = p.size * R;
          ctx.globalAlpha = Math.min(1, fadeIn * tw * p.baseA);
          ctx.drawImage(p.warm ? inst.spriteWarm : inst.spriteWhite, px - size, py - size, size * 2, size * 2);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    ctx.restore(); // remove clip

    // Soft rim that defines the orb (gentle glow, not a harsh edge).
    ctx.save();
    // Subtle sphere edge — the gold progress ring (drawn over this) is the
    // prominent boundary now, so keep the orb's own rim very gentle.
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = rgbaOf(T.rim, 0.30);
    ctx.lineWidth = Math.max(1, dpr);
    if (!reduced) { ctx.shadowColor = rgbaOf(T.rimGlow, 0.4); ctx.shadowBlur = dpr * 6; }
    ctx.stroke();
    ctx.restore();

    // Gentle center depth so the white phase/count text stays legible at any fill.
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    const vg = ctx.createRadialGradient(cx, cy, R * 0.04, cx, cy, R * 0.62);
    vg.addColorStop(0, 'rgba(8,14,24,0.34)');
    vg.addColorStop(1, 'rgba(8,14,24,0)');
    ctx.fillStyle = vg; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.restore();
  }

  // Sync the cue figure's chest glow to the breath fullness (0..1).
  function updateBreathFigure(fullness) {
    if (!el.breathChest) return;
    el.breathChest.style.opacity = (0.12 + 0.88 * fullness).toFixed(3);
    el.breathChest.style.transform =
      'translate(-50%, -50%) scale(' + (0.7 + 0.45 * fullness).toFixed(3) + ')';
  }

  function render() {
    const phase = session.phases[session.phaseIndex];
    const t = clamp(session.phaseElapsed / phase.dur, 0, 1);
    // Eased breath "fullness" (0..1) from the single timer — drives the orb AND
    // the cue figure's chest so they fill together, for every mode.
    const fullness = clamp(
      ((phase.from + (phase.to - phase.from) * easeInOutSine(t)) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN),
      0, 1
    );
    updateBreathFigure(fullness);

    // ----- Countdown (prominent, immediate) -----
    const remaining = Math.max(1, Math.ceil((phase.dur - session.phaseElapsed) / 1000));
    if (el.count.textContent !== String(remaining)) {
      el.count.textContent = String(remaining);
      el.countLiquid.textContent = String(remaining);
    }

    // Show/hide visuals based on setting (circle / liquid 2D / liquid 3D).
    const style = settings.animationStyle;
    const wantLiquid = (style === 'liquid' || style === 'liquid3d');
    el.breath.hidden = wantLiquid;
    el.liquidContainer.hidden = !wantLiquid;

    if (wantLiquid) {
      // Uses the eased breath "fullness" computed above (locked to the breath).
      // 3D only when chosen, motion allowed, and the module is ready; otherwise
      // the 2D orb is used (also the calm flat fill under reduced-motion).
      const want3d = (style === 'liquid3d') && !prefersReducedMotion();
      if (want3d) ensureOrb3d();
      if (want3d && orb3dState === 'ready') {
        el.orbCanvas.hidden = true;
        el.orb3dCanvas.hidden = false;
        try { orb3dApi.update(fullness, performance.now()); }
        catch (e) { orb3dState = 'failed'; }  // drop to 2D from here on
      } else {
        el.orb3dCanvas.hidden = true;
        el.orbCanvas.hidden = false;
        if (ensureOrb()) drawOrb(fullness, performance.now());
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
      // Ambient music keeps playing through a pause — it's global, not session-bound.
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
      renderDashboard({ durationMs, cyclesDone, isCycleMode, calmBefore, calmAfter, wasAway: res.wasAway, pts: res.pts });
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
    // Ambient music is global — it keeps playing into the end/summary screens.
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
      learn: el.screenLearn,
      onboarding: el.screenOnboarding,
      start: el.screenStart,
      session: el.screenSession,
      end: el.screenEnd,
      summary: el.screenSummary,
    };
    Object.entries(map).forEach(([k, node]) => { node.hidden = (k !== name); });
    // Reflect any in-session / profile changes back onto the start screen controls.
    if (name === 'start') renderStart();
    // The walkthrough animation only runs while its screen is visible.
    if (name === 'learn') startLearnDemo(); else stopLearnDemo();
    // Move focus to a sensible target (keyboard / SR users)
    const focusTarget = {
      welcome: el.btnWelcomeStart,
      learn: el.btnLearnContinue,
      onboarding: el.onboardTitle,
      start: el.btnStart,
      session: el.btnStop,   // always-reachable control
      end: el.btnRestart,
      summary: el.btnSummaryDone,
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

  /* =======================================================
     "How it works" walkthrough — a looping in/hold/out demo so a
     first-timer can see (and breathe along with) one full breath.
     The orb + the figure's chest fill in sync; air streams flow in
     the nose and out the mouth. Self-contained loop, separate from the
     session engine. Reduced-motion shows a static text version.
     ======================================================= */
  const learn = { raf: 0, t0: 0, returnTo: 'start', lastStep: -1 };
  // Full box cycle so the tutorial matches the exercise: in → hold → out → hold.
  const LEARN_SEQ = [
    { key: 'inhale', label: 'Breathe in',  cue: 'slowly, through your nose',   dur: 4000 },
    { key: 'hold',   label: 'Hold',        cue: 'keep it soft and easy',       dur: 4000 },
    { key: 'exhale', label: 'Breathe out', cue: 'slowly, through your mouth',   dur: 4000 },
    { key: 'hold',   label: 'Hold',        cue: 'rest before the next breath',  dur: 4000 },
  ];
  const LEARN_TOTAL = 16000;
  const easeInOut = (p) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(p, 0, 1));

  // The walkthrough renders the SAME liquid orb as a session (its own instance/canvas).
  const learnOrb = { canvas: null, ctx: null, particles: null, spriteWhite: null, spriteWarm: null };
  function ensureLearnOrb() {
    if (learnOrb.ctx) return true;
    if (!el.learnOrbCanvas) return false;
    learnOrb.canvas = el.learnOrbCanvas;
    learnOrb.ctx = el.learnOrbCanvas.getContext('2d');
    if (!learnOrb.ctx) return false;
    learnOrb.particles = buildOrbParticles();
    learnOrb.spriteWhite = makeGlowSprite('255,248,232');
    learnOrb.spriteWarm = makeGlowSprite('255,221,150');
    return true;
  }

  function setLearnFill(fill, timeMs) {
    // Orb — the real glowing liquid orb (same renderer as a session).
    if (ensureLearnOrb()) drawOrb(fill, timeMs || 0, learnOrb);
    // Chest/lungs glow: brightens and gently swells as the breath fills.
    el.learnChestGlow.style.opacity = (0.12 + 0.88 * fill).toFixed(3);
    el.learnChestGlow.style.transform =
      'translate(-50%, -50%) scale(' + (0.7 + 0.5 * fill).toFixed(3) + ')';
  }

  function setLearnStep(i, seg) {
    if (i === learn.lastStep) return;
    learn.lastStep = i;
    el.learnScene.classList.remove('is-inhale', 'is-hold', 'is-exhale');
    el.learnScene.classList.add('is-' + seg.key);
    el.learnPhase.textContent = seg.label;
    el.learnCue.textContent = seg.cue;
    if (seg.key === 'inhale') el.learnSymbol.src = 'assets/nose.png';
    else if (seg.key === 'exhale') el.learnSymbol.src = 'assets/mouth.png';
    // (holds keep the last symbol; CSS hides it during the hold)
    el.learnSteps.querySelectorAll('li').forEach((li, idx) => {
      li.classList.toggle('is-active', idx === i);
    });
  }

  function learnTick(ts) {
    if (!learn.t0) learn.t0 = ts;
    let t = (ts - learn.t0) % LEARN_TOTAL;
    let i = 0;
    while (i < LEARN_SEQ.length - 1 && t >= LEARN_SEQ[i].dur) { t -= LEARN_SEQ[i].dur; i++; }
    const seg = LEARN_SEQ[i];
    const p = t / seg.dur;
    let fill;
    if (seg.key === 'inhale') fill = easeInOut(p);
    else if (seg.key === 'exhale') fill = 1 - easeInOut(p);
    else fill = (i === 1) ? 1 : 0; // hold after inhale = full, after exhale = empty
    setLearnStep(i, seg);
    setLearnFill(fill, ts);
    learn.raf = requestAnimationFrame(learnTick);
  }

  function startLearnDemo() {
    stopLearnDemo();
    learn.lastStep = -1;
    if (prefersReducedMotion()) {
      // No looping animation — show a clear, static description instead.
      el.learnStatic.hidden = false;
      el.learnPhase.textContent = 'In · hold · out';
      el.learnCue.textContent = 'one calm breath';
      setLearnFill(0.6, 0);
      el.learnScene.classList.remove('is-inhale', 'is-hold', 'is-exhale');
      return;
    }
    el.learnStatic.hidden = true;
    learn.t0 = 0;
    learn.raf = requestAnimationFrame(learnTick);
  }

  function stopLearnDemo() {
    if (learn.raf) { cancelAnimationFrame(learn.raf); learn.raf = 0; }
  }

  // Open the walkthrough, remembering where to go when the user is done.
  function showLearn(returnTo) {
    learn.returnTo = returnTo || 'start';
    el.btnLearnContinue.textContent = (learn.returnTo === 'onboarding') ? 'Continue' : 'Got it';
    showScreen('learn');
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
    if (progress.streak.current > 0) parts.push(`🌿 ${progress.streak.current}-day rhythm`);
    if (progress.points > 0) parts.push(`${progress.points} pts`);
    const away = progress.streak.lastDate && dayDiff(progress.streak.lastDate, todayStr()) >= 2;
    let lead;
    if (away) lead = name ? `Welcome back, ${name} — let's pick up your rhythm.` : `Welcome back — let's pick up your rhythm.`;
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
    initAudio();     // unlock audio inside the user gesture
    startMusic();    // ensure the always-on ambient is going
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

    // Points earned this session — gentle reveal + a soft glow on the dose ring.
    if (el.endEarned && el.endEarnedNum && d.pts != null) {
      el.endEarnedNum.textContent = '+' + d.pts;
      el.endEarned.hidden = false;
      el.endEarned.classList.remove('is-in');
      if (el.dose) el.dose.classList.remove('is-celebrate');
      // Restart the CSS animation on each session (force reflow, then re-add).
      void el.endEarned.offsetWidth;
      el.endEarned.classList.add('is-in');
      if (el.dose) el.dose.classList.add('is-celebrate');
    } else if (el.endEarned) {
      el.endEarned.hidden = true;
    }

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
    if (d.wasAway) milestone = `Welcome back — let's pick up your rhythm.  ` + milestone;
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
  // ---- Export helpers (all local; timezone read automatically, never GPS) ----
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatLong(ms) { // "1h 5m" / "5m 30s" / "45s"
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
    return `${s}s`;
  }
  function localStamp(ts) { // "07 Jun 2026, 6:59 AM" — device's own timezone
    const d = new Date(ts);
    const day = String(d.getDate()).padStart(2, '0');
    const h24 = d.getHours();
    const h12 = ((h24 + 11) % 12) + 1;
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h12}:${min} ${h24 < 12 ? 'AM' : 'PM'}`;
  }
  function partOfDay(ts) {
    const h = new Date(ts).getHours();
    if (h >= 5 && h < 12) return 'Morning';
    if (h >= 12 && h < 17) return 'Afternoon';
    if (h >= 17 && h < 21) return 'Evening';
    return 'Night';
  }
  function topByCount(items, keyFn) {
    const tally = {};
    items.forEach((it) => { const k = keyFn(it); if (k) tally[k] = (tally[k] || 0) + 1; });
    let best = null, bestN = 0;
    Object.keys(tally).forEach((k) => { if (tally[k] > bestN) { best = k; bestN = tally[k]; } });
    return best;
  }
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // CSV: totals at the top, then one readable row per session (local time).
  function buildCSV() {
    const h = progress.history;
    const delta = calmDeltaAvg();
    const topMode = topByCount(h, (x) => x.modeLabel || modeLabelFor(x.mode)) || '—';
    const L = [];
    L.push('# Breathe — your practice history. Stored only on your device; never uploaded.');
    if (TZ) L.push(`# Times are shown in your timezone: ${TZ}`);
    L.push('#');
    L.push('# TOTALS');
    L.push(`#   Sessions: ${h.length}`);
    L.push(`#   Total practice: ${formatLong(lifetimeMs())}`);
    L.push(`#   Rhythm: ${progress.streak.current} day${progress.streak.current === 1 ? '' : 's'}`);
    L.push(`#   Points: ${progress.points}`);
    L.push(`#   Avg calm change: ${delta ? (delta.avg >= 0 ? '+' : '') + (Math.round(delta.avg * 10) / 10) + ' (1–5 self-report, ' + delta.n + ' rated)' : 'not enough data yet'}`);
    L.push(`#   Most-used: ${topMode}`);
    L.push('#');
    L.push('when,part_of_day,mode,duration,cycles,points,calm_before,calm_after');
    h.forEach((x) => {
      L.push([
        csvCell(localStamp(x.ts)),
        partOfDay(x.ts),
        csvCell(x.modeLabel || modeLabelFor(x.mode)),
        formatLong(x.durationMs),
        x.cycles,
        x.points,
        x.calmBefore == null ? '' : x.calmBefore,
        x.calmAfter == null ? '' : x.calmAfter,
      ].join(','));
    });
    return L.join('\n');
  }

  // Plain-language summary anyone can read at a glance.
  function buildSummary() {
    const h = progress.history;
    const name = (profile.name || '').trim();
    const delta = calmDeltaAvg();
    const topMode = topByCount(h, (x) => x.modeLabel || modeLabelFor(x.mode));
    const topTime = topByCount(h, (x) => partOfDay(x.ts));
    const L = [];
    L.push(name ? `${name}'s Breathe summary` : 'Your Breathe summary');
    L.push(`(${localStamp(Date.now())})`);
    L.push('');
    if (h.length === 0) {
      L.push('No sessions yet — finish one and your summary will appear here.');
    } else {
      L.push(`You've completed ${h.length} session${h.length === 1 ? '' : 's'} and spent ${formatLong(lifetimeMs())} breathing in total.`);
      L.push(`Your rhythm is ${progress.streak.current} day${progress.streak.current === 1 ? '' : 's'} — the days you keep coming back. It only grows; miss one and it simply pauses.`);
      L.push(`You've earned ${progress.points} points along the way.`);
      if (delta && delta.n > 0) {
        const a = Math.round(delta.avg * 10) / 10;
        if (a > 0) L.push(`On the ${delta.n} session${delta.n === 1 ? '' : 's'} you checked in, you felt about ${a} point${a === 1 ? '' : 's'} calmer afterward (your own 1–5 rating).`);
        else if (a === 0) L.push('On the sessions you checked in, your calm felt about the same before and after.');
        else L.push("Your calm check-ins vary day to day — and that's completely okay.");
      }
      if (topMode) L.push(`Your go-to practice is ${topMode}.`);
      if (topTime) L.push(`You usually practice in the ${topTime}.`);
    }
    L.push('');
    L.push('🔒 Created on your device. Never uploaded.');
    return L.join('\n');
  }

  // ---- In-app visual summary card ----
  function weekStats() {
    const now = Date.now();
    const day = 86400000;
    const t = { sessions: 0, ms: 0 };
    const l = { sessions: 0, ms: 0 };
    progress.history.forEach((h) => {
      const age = now - h.ts;
      if (age < 7 * day) { t.sessions++; t.ms += h.durationMs; }
      else if (age < 14 * day) { l.sessions++; l.ms += h.durationMs; }
    });
    return { thisWeek: t, lastWeek: l };
  }
  function trendLine(w) {
    const t = w.thisWeek, l = w.lastWeek;
    if (t.sessions === 0 && l.sessions === 0) return "Your week is open — whenever you're ready, a quiet minute is enough.";
    if (l.sessions === 0) return `You've practiced ${t.sessions} time${t.sessions === 1 ? '' : 's'} this week (${formatLong(t.ms)}) — a lovely start.`;
    if (t.ms >= l.ms) return `${formatLong(t.ms)} this week vs ${formatLong(l.ms)} last week — gently building. 🌿`;
    return `${formatLong(t.ms)} this week, ${formatLong(l.ms)} last week — every breath still counts; pick it back up whenever you like.`;
  }
  function renderSummaryCard() {
    const name = (profile.name || '').trim();
    el.summaryTitle.textContent = name ? `${name}'s progress` : 'Your progress';
    el.summarySub.textContent = 'How your practice is going — only your own data, kept on your device.';
    const nSess = progress.history.length;
    el.sumSessions.textContent = String(nSess);
    el.sumLifetime.textContent = formatLong(lifetimeMs());
    el.sumRhythm.textContent = String(progress.streak.current);
    el.sumPoints.textContent = String(progress.points);
    el.sumWeek.textContent = String(weekStats().thisWeek.sessions);
    el.sumAvg.textContent = nSess ? formatLong(lifetimeMs() / nSess) : '—';
    el.sumTrend.textContent = trendLine(weekStats());

    // Calm self-report lives here as a plain sentence (not a cryptic tile).
    const delta = calmDeltaAvg();
    if (delta) {
      const a = Math.round(delta.avg * 10) / 10;
      const both = progress.history.filter((h) => h.calmBefore != null && h.calmAfter != null);
      const calmer = both.filter((h) => h.calmAfter > h.calmBefore).length;
      el.sumCalmNote.textContent =
        `On the sessions you rated, you felt calmer afterward ${calmer} of ${delta.n} time${delta.n === 1 ? '' : 's'}` +
        ` — about ${a >= 0 ? '+' : ''}${a} on your own 1–5 calm scale (your self-report, not a measurement).`;
      el.sumCalmNote.hidden = false;
    } else {
      el.sumCalmNote.hidden = true;
    }
  }

  // ---- Gentle share: a warm invitation, never a competitive flex ----
  const SHARE_URL = 'https://mohammadelmekkawy-web.github.io/breathing-app/';
  // Flash a brief confirmation on the share buttons' labels (clipboard fallback).
  function shareFlash() {
    const labels = document.querySelectorAll('.invite-label');
    labels.forEach((n) => { if (!n.dataset.orig) n.dataset.orig = n.textContent; n.textContent = 'Saved ✓'; });
    clearTimeout(shareFlash._t);
    shareFlash._t = setTimeout(() => {
      document.querySelectorAll('.invite-label').forEach((n) => { if (n.dataset.orig) n.textContent = n.dataset.orig; });
    }, 2200);
  }
  function downloadBlob(filename, blob) {
    try {
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u; a.download = filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(u), 2000);
    } catch {}
  }

  // Render a clean "progress" card image (PNG) from the user's REAL stats, so
  // sharing sends a clear picture of their dashboard. Resolves to a File (or
  // Blob if File isn't available).
  function buildShareImage() {
    return new Promise((resolve, reject) => {
      try {
        const W = 1080, H = 1350;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d');
        const FT = '-apple-system, "Segoe UI", Roboto, system-ui, sans-serif';
        const cx = W / 2;
        g.textAlign = 'center';

        const bg = g.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#0e1620'); bg.addColorStop(1, '#13233a');
        g.fillStyle = bg; g.fillRect(0, 0, W, H);
        const rg = g.createRadialGradient(cx, H * 0.24, 40, cx, H * 0.24, 560);
        rg.addColorStop(0, 'rgba(60,120,168,0.32)'); rg.addColorStop(1, 'rgba(60,120,168,0)');
        g.fillStyle = rg; g.fillRect(0, 0, W, H);

        // Glowing blue liquid orb — mirrors the in-app orb (glow halo, blue
        // gradient with a bright meniscus, inner bloom, sparkles, gold ring).
        const oy = H * 0.235, or = 150;
        const fillLvl = 0.62;                          // a pleasing, mostly-full level
        const surfaceY = oy + or - fillLvl * 2 * or;   // 0 → bottom, 1 → top
        const N = 48;
        const amp = or * 0.045;
        const waveY = (x) => {
          const u = (x - cx) / or; // -1..+1
          return surfaceY
            - amp * Math.sin(u * Math.PI * 0.5 + 0.6)
            - amp * 0.5 * Math.cos(u * Math.PI);
        };

        // Outer glow halo behind the orb.
        const halo = g.createRadialGradient(cx, oy, or * 0.25, cx, oy, or * 1.9);
        halo.addColorStop(0, 'rgba(96,162,212,0.40)');
        halo.addColorStop(0.55, 'rgba(96,162,212,0.12)');
        halo.addColorStop(1, 'rgba(96,162,212,0)');
        g.fillStyle = halo; g.fillRect(cx - or * 1.9, oy - or * 1.9, or * 3.8, or * 3.8);

        g.save();
        g.beginPath(); g.arc(cx, oy, or - 5, 0, Math.PI * 2); g.clip();

        // Faint empty interior so the sphere reads above the waterline.
        const inside = g.createRadialGradient(cx, oy - or * 0.25, or * 0.15, cx, oy, or);
        inside.addColorStop(0, 'rgba(48,70,98,0.55)');
        inside.addColorStop(1, 'rgba(16,26,40,0.80)');
        g.fillStyle = inside; g.fillRect(cx - or, oy - or, 2 * or, 2 * or);

        // Liquid body with a gentle wavy surface.
        g.beginPath();
        g.moveTo(cx - or, oy + or + 2);
        g.lineTo(cx - or, waveY(cx - or));
        for (let i = 0; i <= N; i++) { const x = cx - or + (2 * or) * (i / N); g.lineTo(x, waveY(x)); }
        g.lineTo(cx + or, oy + or + 2);
        g.closePath();
        const lg = g.createLinearGradient(0, surfaceY - or * 0.25, 0, oy + or);
        lg.addColorStop(0, 'rgba(126,186,228,0.97)');   // bright near the surface
        lg.addColorStop(0.5, 'rgba(58,120,168,0.97)');
        lg.addColorStop(1, 'rgba(28,68,108,0.98)');     // deep at the bottom
        g.fillStyle = lg; g.fill();

        // Additive inner bloom.
        g.globalCompositeOperation = 'lighter';
        const bloom = g.createRadialGradient(cx, surfaceY + or * 0.15, or * 0.05, cx, surfaceY + or * 0.15, or * 1.05);
        bloom.addColorStop(0, 'rgba(120,190,235,0.22)');
        bloom.addColorStop(1, 'rgba(120,190,235,0)');
        g.fillStyle = bloom; g.fillRect(cx - or, oy - or, 2 * or, 2 * or);

        // Sparkle dots suspended in the liquid.
        g.fillStyle = 'rgba(214,236,252,0.9)';
        const dots = [[-0.34, 0.40], [0.30, 0.58], [-0.08, 0.74], [0.44, 0.36], [0.14, 0.50], [-0.5, 0.66]];
        for (const [nx, nh] of dots) {
          const px = cx + nx * or * 0.85;
          const py = oy + or - nh * 2 * or;
          if (py > waveY(px) + 4) { g.beginPath(); g.arc(px, py, 3.2, 0, Math.PI * 2); g.fill(); }
        }
        g.globalCompositeOperation = 'source-over';

        // Bright meniscus highlight along the surface.
        g.beginPath();
        for (let i = 0; i <= N; i++) { const x = cx - or + (2 * or) * (i / N); if (i === 0) g.moveTo(x, waveY(x)); else g.lineTo(x, waveY(x)); }
        g.strokeStyle = 'rgba(188,226,250,0.65)'; g.lineWidth = 4; g.stroke();
        g.restore();

        // Gold ring with a soft glow.
        g.save();
        g.beginPath(); g.arc(cx, oy, or, 0, Math.PI * 2);
        g.shadowColor = 'rgba(239,212,154,0.5)'; g.shadowBlur = 22;
        g.strokeStyle = '#efd49a'; g.lineWidth = 8; g.stroke();
        g.restore();

        const name = (profile.name || '').trim();
        g.fillStyle = '#eaf1f6'; g.font = '600 66px ' + FT;
        g.fillText('Breathe', cx, H * 0.40);
        g.fillStyle = '#aebecb'; g.font = '500 36px ' + FT;
        g.fillText(name ? (name + "'s progress") : 'My progress', cx, H * 0.40 + 58);

        const wk = weekStats();
        const nSess = progress.history.length;
        const avgMs = nSess ? lifetimeMs() / nSess : 0;
        const stats = [
          ['Sessions', String(nSess)],
          ['Practice', formatLong(lifetimeMs())],
          ['Rhythm', progress.streak.current + ' day' + (progress.streak.current === 1 ? '' : 's')],
          ['Points', String(progress.points)],
          ['Avg session', nSess ? formatLong(avgMs) : '—'],
          ['This week', String(wk.thisWeek.sessions)],
        ];
        const colX = [W * 0.30, W * 0.70];
        const top = H * 0.56, rowH = 150;
        for (let i = 0; i < stats.length; i++) {
          const x = colX[i % 2], y = top + Math.floor(i / 2) * rowH;
          g.fillStyle = '#efd49a'; g.font = '700 60px ' + FT;
          g.fillText(stats[i][1], x, y);
          g.fillStyle = '#9fb1c0'; g.font = '600 26px ' + FT;
          g.fillText(stats[i][0].toUpperCase(), x, y + 42);
        }

        g.fillStyle = '#7fb6cf'; g.font = '500 32px ' + FT;
        g.fillText('🌿  a few calm minutes a day', cx, H - 130);
        g.fillStyle = '#9fb1c0'; g.font = '500 27px ' + FT;
        g.fillText('mohammadelmekkawy-web.github.io/breathing-app', cx, H - 78);

        c.toBlob((blob) => {
          if (!blob) { reject(new Error('toBlob failed')); return; }
          let f;
          try { f = new File([blob], 'breathe-progress-' + todayStr() + '.png', { type: 'image/png' }); }
          catch (e) { f = blob; }
          resolve(f);
        }, 'image/png');
      } catch (e) { reject(e); }
    });
  }

  async function shareInvite() {
    const url = SHARE_URL;
    const text = "I've been taking a few quiet minutes to breathe and feel calmer 🌿 — come try it with me";
    let file = null;
    try { file = await buildShareImage(); } catch (e) { file = null; }

    // 1) Share the progress IMAGE via the native sheet → WhatsApp, etc.
    if (file && typeof navigator.share === 'function' && navigator.canShare && navigator.canShare({ files: [file] })) {
      const t0 = Date.now();
      try { await navigator.share({ files: [file], text, url }); return; }
      catch (e) { if (e && e.name === 'AbortError' && (Date.now() - t0) > 250) return; }
    }
    // 2) No file sharing → share text + link.
    if (typeof navigator.share === 'function') {
      const t0 = Date.now();
      try { await navigator.share({ title: 'Breathe', text, url }); return; }
      catch (e) { if (e && e.name === 'AbortError' && (Date.now() - t0) > 250) return; }
    }
    // 3) Desktop/unsupported fallback: save the picture + copy the caption.
    if (file) downloadBlob((file.name || ('breathe-progress-' + todayStr() + '.png')), file);
    try { await navigator.clipboard.writeText(text + '\n' + url); } catch {}
    shareFlash();
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
  // Export ALWAYS shows an in-app sheet (works on every platform, incl. installed
  // iOS PWAs where silent downloads/share do nothing). From there the user can
  // copy, share/save, or download the file.
  let currentExport = { filename: '', text: '', type: '' };
  const EXPORT_SUB_DEFAULT = 'Copy it, share it, or download it. It stays on your device unless you share it.';
  let exportFlashTimer = 0;

  function exportFlash(msg) {
    el.exportSub.textContent = msg;
    clearTimeout(exportFlashTimer);
    exportFlashTimer = setTimeout(() => { el.exportSub.textContent = EXPORT_SUB_DEFAULT; }, 2200);
  }

  function openExport(filename, text, type) {
    currentExport = { filename, text, type };
    el.exportText.value = text;
    el.exportSub.textContent = EXPORT_SUB_DEFAULT;
    // Show Share whenever the platform supports the Web Share API at all
    // (shareExport falls back from file-share to text-share as needed).
    el.exportShare.hidden = (typeof navigator.share !== 'function');
    el.exportOverlay.hidden = false;
    requestAnimationFrame(() => el.exportCopy.focus());
  }
  function closeExport() { el.exportOverlay.hidden = true; }

  async function copyExport() {
    const text = currentExport.text;
    try {
      await navigator.clipboard.writeText(text);
      exportFlash('Copied to clipboard ✓');
      return;
    } catch { /* fall back to selection-based copy */ }
    try {
      el.exportText.focus();
      el.exportText.select();
      el.exportText.setSelectionRange(0, text.length);
      const ok = document.execCommand && document.execCommand('copy');
      exportFlash(ok ? 'Copied to clipboard ✓' : 'Select the text, then press ⌘/Ctrl+C');
    } catch { exportFlash('Select the text, then press ⌘/Ctrl+C'); }
  }

  async function shareExport() {
    const { filename, text, type } = currentExport;
    // Try sharing as a file first (lets iOS "Save to Files"); fall back to text.
    try {
      const file = new File([text], filename, { type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Breathe data' });
        return;
      }
    } catch { /* cancelled or unsupported */ return; }
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Breathe data', text });
        return;
      }
    } catch { return; }
    exportFlash('Sharing not available — use Copy or Download');
  }

  function downloadExport() { downloadFile(currentExport.filename, currentExport.text, currentExport.type); }

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
    showLearn('onboarding'); // teach the breath first, then collect profile
  });
  // Walkthrough "Continue": go on to wherever we came from.
  el.btnLearnContinue.addEventListener('click', () => {
    if (learn.returnTo === 'onboarding') { renderOnboarding(); showScreen('onboarding'); }
    else showScreen(learn.returnTo || 'start');
  });
  // Home-screen entry point (for people who skipped or are returning).
  el.btnHowItWorks.addEventListener('click', () => showLearn('start'));
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
  // "My summary" opens the in-app visual card (not the raw export dialog).
  el.btnExportSummary.addEventListener('click', () => { renderSummaryCard(); showScreen('summary'); });
  el.btnExportCsv.addEventListener('click', () => openExport(`breathe-data-${todayStr()}.csv`, buildCSV(), 'text/csv'));

  // Summary card actions
  el.btnSummaryDone.addEventListener('click', () => showScreen('start'));
  el.btnSummaryCsv.addEventListener('click', () => openExport(`breathe-data-${todayStr()}.csv`, buildCSV(), 'text/csv'));
  el.btnShareSummary.addEventListener('click', shareInvite);

  // Gentle invite (dashboard + summary card)
  if (el.btnShare) el.btnShare.addEventListener('click', shareInvite);

  // ----- Export sheet -----
  el.exportCopy.addEventListener('click', copyExport);
  el.exportShare.addEventListener('click', shareExport);
  el.exportDownload.addEventListener('click', downloadExport);
  el.exportClose.addEventListener('click', closeExport);
  el.exportOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeExport(); }
  });
  el.exportOverlay.addEventListener('click', (e) => { if (e.target === el.exportOverlay) closeExport(); });

  // ----- Calm check overlay -----
  el.calmOverlay.querySelectorAll('.calm-btn').forEach((btn) => {
    btn.addEventListener('click', () => resolveCalm(parseInt(btn.getAttribute('data-calm'), 10)));
  });
  el.btnCalmSkip.addEventListener('click', () => resolveCalm(null));
  el.calmOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); resolveCalm(null); }
  });

  // ----- Global settings gear (available on every screen) -----
  function openGear() {
    renderStart();                 // reflect current settings into the shared controls
    el.settingsOverlay.hidden = false;
    el.btnGear.setAttribute('aria-expanded', 'true');
    el.btnSettingsDone.focus();
  }
  function closeGear() {
    el.settingsOverlay.hidden = true;
    el.btnGear.setAttribute('aria-expanded', 'false');
    el.btnGear.focus();
  }
  el.btnGear.addEventListener('click', () => {
    initAudio();                   // first gesture may be opening settings — unlock + start music
    startMusic();
    el.settingsOverlay.hidden ? openGear() : closeGear();
  });
  el.btnSettingsDone.addEventListener('click', closeGear);
  el.settingsOverlay.addEventListener('click', (e) => { if (e.target === el.settingsOverlay) closeGear(); });
  el.settingsOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeGear(); }
  });

  // Always-on ambient music: start on the user's first gesture anywhere
  // (autoplay policies block audio before any interaction). We listen on
  // several gesture types — `click`/`touchend` reliably grant media playback
  // permission, whereas `pointerdown` alone does NOT on many mobile browsers —
  // and we keep trying on each gesture until the music is actually playing,
  // then stop. (Previously this was one-shot on pointerdown, so a rejected
  // first play() meant no music until something else called startMusic().)
  const PRIME_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'];
  function primeMusic() {
    initAudio();
    startMusic();
    // Done once there's nothing to play, or the track is actually audible.
    if (settings.bgTrack === 'off' || (musicEl && !musicEl.paused)) {
      PRIME_EVENTS.forEach((ev) => document.removeEventListener(ev, primeMusic, true));
    }
  }
  // Capture phase so we still catch the gesture even if a handler stops propagation.
  PRIME_EVENTS.forEach((ev) => document.addEventListener(ev, primeMusic, true));

  // Keyboard: Space toggles pause during a session; Escape stops.
  document.addEventListener('keydown', (e) => {
    if (!session.active) return;
    if (!el.settingsOverlay.hidden) return; // let the gear handle its own keys
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
