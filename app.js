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
    animationStyle: 'liquid',  // 'liquid' (2D orb) or 'liquid3d' (3D orb)
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
        animationStyle: (s.animationStyle === 'liquid3d') ? 'liquid3d' : 'liquid', // 'circle' (legacy) → 2D orb
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
    optVisual: $('opt-visual'),

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
    btnExportSummary: $('btn-export-summary'),
    btnExportCsv: $('btn-export-csv'),
    btnShare: $('btn-share'),
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

    // My summary card
    screenSummary: $('screen-summary'),
    summaryTitle: $('summary-title'),
    summarySub: $('summary-sub'),
    sumSessions: $('sum-sessions'),
    sumLifetime: $('sum-lifetime'),
    sumRhythm: $('sum-rhythm'),
    sumPoints: $('sum-points'),
    sumWeek: $('sum-week'),
    sumCalm: $('sum-calm'),
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
    el.optVisual.value = settings.animationStyle;
    setSwitch(el.optCalm, settings.calmCheck);
    setSwitch(el.optTheme, settings.theme === 'light');

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
    if (music.master && music.playing) musicFade(musicTarget(), 0.2); // live-adjust
  });
  el.optVisual.addEventListener('change', () => {
    settings.animationStyle = (el.optVisual.value === 'liquid3d') ? 'liquid3d' : 'liquid';
    saveSettings();
    renderStart();
  });
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
     Streamed via HTMLAudio (low memory) and routed through Web Audio
     gain nodes so volume works on iOS (where element.volume is
     read-only). Looped seamlessly by crossfading between two players
     near the loop seam, with a gentle master fade-in/out.
     ======================================================= */
  const TRACKS = [
    { id: 'leberch',   name: 'Meditation — Leberch',   src: 'audio/meditation-leberch.mp3' },
    { id: 'starostin', name: 'Meditation — Starostin', src: 'audio/meditation-starostin.mp3' },
  ];
  function trackById(id) { return TRACKS.find((t) => t.id === id) || null; }

  // Vestigial mute flag — kept so playTone()/musicTarget() guards still compile.
  // Ambient music is global and never force-muted; it stays permanently false.
  let muted = false;

  const XFADE = 2.5; // seconds — crossfade length at the loop seam
  const music = {
    playing: false,     // audibly playing right now
    wanted: false,      // user wants music this session (survives pause)
    respectMute: false, // session playback honours mute; preview doesn't
    trackId: null,
    els: [], nodes: [], gains: [], // two crossfading players (2nd created lazily)
    master: null,
    cur: 0,
    monitorId: 0,
    teardownTimer: 0,
    xfadeArmed: false,
  };

  function musicTarget() {
    if (music.respectMute && muted) return 0.0001;
    return Math.max(0.0001, clamp(settings.bgVolume, 0, 1)); // ceiling 1.0 (MP3s pre-mastered)
  }
  function musicFade(target, seconds) {
    if (!music.master || !audioCtx) return;
    const g = music.master.gain;
    const now = audioCtx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(Math.max(0.0001, target), now + Math.max(0.05, seconds));
  }

  // Create (lazily) one of the two crossfading players and wire it into the graph.
  function musicEnsureElement(i) {
    if (music.els[i]) return music.els[i];
    const track = trackById(music.trackId);
    if (!track || !audioCtx || !music.master) return null;
    const a = new Audio(track.src);
    a.preload = 'auto';
    let node;
    try { node = audioCtx.createMediaElementSource(a); } catch { return null; }
    const g = audioCtx.createGain();
    g.gain.value = (i === music.cur) ? 1.0 : 0.0001;
    node.connect(g).connect(music.master);
    a.addEventListener('ended', () => {
      // Safety net: if a crossfade was missed (e.g. heavy backgrounding),
      // restart this player rather than fall silent.
      if (music.playing && music.els[music.cur] === a) {
        try { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch {}
      }
    });
    music.els[i] = a; music.nodes[i] = node; music.gains[i] = g;
    return a;
  }

  // Poll near the loop seam and crossfade to the other player → seamless loop.
  function musicMonitor() {
    if (!music.playing || !audioCtx) return;
    const a = music.els[music.cur];
    if (!a || !a.duration || !isFinite(a.duration)) return;
    if (a.duration - a.currentTime <= XFADE && !music.xfadeArmed) {
      music.xfadeArmed = true;
      musicCrossfade();
    }
  }
  function musicCrossfade() {
    if (!audioCtx || !music.master) return;
    const now = audioCtx.currentTime;
    const from = music.cur;
    const to = from ^ 1;
    const b = musicEnsureElement(to);
    if (!b) { music.xfadeArmed = false; return; }
    try { b.currentTime = 0; const p = b.play(); if (p && p.catch) p.catch(() => {}); } catch {}
    const gf = music.gains[from].gain;
    const gt = music.gains[to].gain;
    gf.cancelScheduledValues(now); gf.setValueAtTime(Math.max(0.0001, gf.value), now);
    gf.linearRampToValueAtTime(0.0001, now + XFADE);
    gt.cancelScheduledValues(now); gt.setValueAtTime(Math.max(0.0001, gt.value), now);
    gt.linearRampToValueAtTime(1.0, now + XFADE);
    music.cur = to;
    // Park the old player once silent, ready for the next loop.
    setTimeout(() => {
      const old = music.els[from];
      if (old && music.cur !== from) { try { old.pause(); old.currentTime = 0; } catch {} }
      music.xfadeArmed = false;
    }, (XFADE + 0.25) * 1000);
  }

  function musicHardStop() {
    clearInterval(music.monitorId); music.monitorId = 0;
    clearTimeout(music.teardownTimer); music.teardownTimer = 0;
    music.playing = false;
    (music.els || []).forEach((a) => { if (a) { try { a.pause(); a.src = ''; a.load(); } catch {} } });
    try { if (music.master) music.master.disconnect(); } catch {}
    music.master = null; music.els = []; music.nodes = []; music.gains = [];
    music.trackId = null; music.cur = 0; music.xfadeArmed = false;
  }

  function musicStart(trackId, respectMute) {
    const track = trackById(trackId);
    if (!track || !ensureAudioCtx()) return;
    musicHardStop(); // clean any preview / previous instance — never overlap
    try {
      music.master = audioCtx.createGain();
      music.master.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      music.master.connect(audioCtx.destination);
      music.trackId = trackId;
      music.respectMute = respectMute;
      music.cur = 0;
      const a = musicEnsureElement(0);
      if (!a) { musicHardStop(); return; }
      music.playing = true;
      const p = a.play(); if (p && p.catch) p.catch(() => {});
      musicFade(musicTarget(), respectMute ? 3.0 : 1.2); // gentle ease-in
      clearInterval(music.monitorId);
      music.monitorId = setInterval(musicMonitor, 300);
    } catch { musicHardStop(); }
  }

  function musicStop(seconds) {
    const sec = seconds || 2.0;
    if (!music.master) { musicHardStop(); return; }
    music.playing = false;
    clearInterval(music.monitorId); music.monitorId = 0;
    musicFade(0, sec);
    const dyingEls = music.els.slice();
    const dyingMaster = music.master;
    clearTimeout(music.teardownTimer);
    music.teardownTimer = setTimeout(() => {
      dyingEls.forEach((a) => { if (a) { try { a.pause(); a.src = ''; a.load(); } catch {} } });
      try { dyingMaster.disconnect(); } catch {}
      if (music.master === dyingMaster) {
        music.master = null; music.els = []; music.nodes = []; music.gains = []; music.trackId = null;
      }
    }, (sec + 0.3) * 1000);
  }

  // Crossfade from the currently-playing track to a different one: detach the
  // old graph and fade it out while the new one fades in (overlapping, no gap).
  function musicCrossfadeTo(newTrackId) {
    if (!audioCtx || !music.master) { musicStart(newTrackId, true); return; }
    const rm = music.respectMute;
    const oldMaster = music.master;
    const oldEls = music.els.slice();
    clearInterval(music.monitorId); music.monitorId = 0;
    clearTimeout(music.teardownTimer); music.teardownTimer = 0;
    // Detach the old graph from the global state so musicStart() builds fresh
    // without hard-stopping the track we're still fading out.
    music.master = null; music.els = []; music.nodes = []; music.gains = []; music.playing = false;
    try {
      const now = audioCtx.currentTime;
      oldMaster.gain.cancelScheduledValues(now);
      oldMaster.gain.setValueAtTime(Math.max(0.0001, oldMaster.gain.value), now);
      oldMaster.gain.linearRampToValueAtTime(0.0001, now + 2.0); // gentle fade-out
    } catch {}
    setTimeout(() => {
      oldEls.forEach((a) => { if (a) { try { a.pause(); a.src = ''; a.load(); } catch {} } });
      try { oldMaster.disconnect(); } catch {}
    }, 2300);
    musicStart(newTrackId, rm); // builds + fades the new track in
  }

  // ----- Always-on ambient music -----
  // Music plays continuously across the WHOLE app (welcome → onboarding → home →
  // session → end), independent of any breathing session. It starts on the user's
  // first gesture (autoplay policies block audio before interaction) and only stops
  // when the user chooses "Off" in the gear. Pausing a session does NOT pause music.
  function startMusic() {
    if (settings.bgTrack === 'off') return;
    if (!ensureAudioCtx()) return;
    if (music.playing && music.trackId === settings.bgTrack) return; // already going
    musicStart(settings.bgTrack, false);
  }

  // React to a track change from the gear: start / crossfade / stop the music live.
  function applyTrackChange(trackId) {
    if (trackId === 'off') { musicStop(1.2); return; }
    if (!ensureAudioCtx()) return;
    if (music.master && music.playing && music.trackId !== trackId) {
      musicCrossfadeTo(trackId);              // smooth swap while playing
    } else if (!(music.master && music.trackId === trackId)) {
      musicStart(trackId, false);             // wasn't playing → start it
    }
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
        try { mod.init(el.orb3dCanvas); orb3dApi = mod; orb3dState = 'ready'; }
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

  function drawOrb(fill, timeMs) {
    const c = orb.canvas, ctx = orb.ctx;
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
    bg.addColorStop(0, 'rgba(48,70,98,0.55)');   // more present so the empty vessel
    bg.addColorStop(1, 'rgba(16,26,40,0.78)');   // reads full-size up to the ring (no gap)
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
      lg.addColorStop(0, 'rgba(126,186,228,0.95)');  // brighter near surface (inner glow)
      lg.addColorStop(0.5, 'rgba(58,120,168,0.96)');
      lg.addColorStop(1, 'rgba(28,68,108,0.97)');     // deeper at the bottom
      ctx.fillStyle = lg; ctx.fill();

      // Soft inner luminosity (subtle bloom), and a gentle surface highlight.
      if (!reduced) {
        ctx.globalCompositeOperation = 'lighter';
        const gy = Math.max(surfaceY, cy) + R * 0.1;
        const gr = ctx.createRadialGradient(cx, gy, R * 0.04, cx, gy, R * 0.95);
        gr.addColorStop(0, 'rgba(120,190,235,0.16)');
        gr.addColorStop(1, 'rgba(120,190,235,0)');
        ctx.fillStyle = gr; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

        if (fill < 0.99) {
          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const x = cx - R + (2 * R) * (i / steps);
            if (i === 0) ctx.moveTo(x, waveAt(x)); else ctx.lineTo(x, waveAt(x));
          }
          ctx.strokeStyle = 'rgba(178,220,248,0.45)';
          ctx.lineWidth = Math.max(1, dpr);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // Magical particles — only those submerged (more appear as the liquid rises).
      if (!reduced) {
        ctx.globalCompositeOperation = 'lighter';
        for (const p of orb.particles) {
          if (p.hf >= fill) continue;
          const fadeIn = Math.min(1, (fill - p.hf) / 0.10); // ease in as the surface passes
          const dyN = 1 - 2 * p.hf;
          const halfW = Math.sqrt(Math.max(0, 1 - dyN * dyN));
          const px = cx + p.nx * halfW * R + Math.sin(time * p.dsx + p.phx) * R * 0.02;
          const py = cy + dyN * R + Math.sin(time * p.dsy + p.phy) * R * 0.02;
          const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time * p.tws + p.twp));
          const size = p.size * R;
          ctx.globalAlpha = Math.min(1, fadeIn * tw * p.baseA);
          ctx.drawImage(p.warm ? orb.spriteWarm : orb.spriteWhite, px - size, py - size, size * 2, size * 2);
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
    ctx.strokeStyle = 'rgba(150,200,235,0.30)';
    ctx.lineWidth = Math.max(1, dpr);
    if (!reduced) { ctx.shadowColor = 'rgba(120,182,226,0.4)'; ctx.shadowBlur = dpr * 6; }
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

  function render() {
    const phase = session.phases[session.phaseIndex];
    const t = clamp(session.phaseElapsed / phase.dur, 0, 1);

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
      // Fill = eased breath "fullness" from the SAME single timer, so it stays
      // locked to the breath and works for every mode (incl. holds & custom).
      const scaleNow = phase.from + (phase.to - phase.from) * easeInOutSine(t);
      const fullness = clamp((scaleNow - SCALE_MIN) / (SCALE_MAX - SCALE_MIN), 0, 1);
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
      onboarding: el.screenOnboarding,
      start: el.screenStart,
      session: el.screenSession,
      end: el.screenEnd,
      summary: el.screenSummary,
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
    el.sumSessions.textContent = String(progress.history.length);
    el.sumLifetime.textContent = formatLong(lifetimeMs());
    el.sumRhythm.textContent = String(progress.streak.current);
    el.sumPoints.textContent = String(progress.points);
    el.sumWeek.textContent = String(weekStats().thisWeek.sessions);
    const delta = calmDeltaAvg();
    el.sumCalm.textContent = delta ? `${delta.avg >= 0 ? '+' : ''}${Math.round(delta.avg * 10) / 10}` : '—';
    el.sumTrend.textContent = trendLine(weekStats());
    if (delta) {
      el.sumCalmNote.textContent = 'Avg calm is your own 1–5 self-rating (after − before) — not a measurement.';
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

        // decorative orb (gold ring + blue fill) — echoes the app
        const oy = H * 0.235, or = 150;
        g.save();
        g.beginPath(); g.arc(cx, oy, or - 10, 0, Math.PI * 2); g.clip();
        const lg = g.createLinearGradient(0, oy - or, 0, oy + or);
        lg.addColorStop(0, 'rgba(80,130,180,0.30)'); lg.addColorStop(1, 'rgba(40,90,140,0.92)');
        g.fillStyle = lg; g.fillRect(cx - or, oy - or * 0.1, 2 * or, or + or * 0.1);
        g.restore();
        g.beginPath(); g.arc(cx, oy, or, 0, Math.PI * 2);
        g.strokeStyle = '#efd49a'; g.lineWidth = 8; g.stroke();

        const name = (profile.name || '').trim();
        g.fillStyle = '#eaf1f6'; g.font = '600 66px ' + FT;
        g.fillText('Breathe', cx, H * 0.40);
        g.fillStyle = '#aebecb'; g.font = '500 36px ' + FT;
        g.fillText(name ? (name + "'s progress") : 'My progress', cx, H * 0.40 + 58);

        const delta = calmDeltaAvg();
        const wk = weekStats();
        const stats = [
          ['Sessions', String(progress.history.length)],
          ['Practice', formatLong(lifetimeMs())],
          ['Rhythm', progress.streak.current + ' day' + (progress.streak.current === 1 ? '' : 's')],
          ['Points', String(progress.points)],
          ['Avg calm', delta ? ((delta.avg >= 0 ? '+' : '') + (Math.round(delta.avg * 10) / 10)) : '—'],
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

  // Always-on ambient music: start on the very first user gesture anywhere
  // (autoplay policies block audio before any interaction). One-shot.
  function primeMusicOnce() {
    document.removeEventListener('pointerdown', primeMusicOnce);
    document.removeEventListener('keydown', primeMusicOnce);
    initAudio();
    startMusic();
  }
  document.addEventListener('pointerdown', primeMusicOnce, { once: false });
  document.addEventListener('keydown', primeMusicOnce, { once: false });

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
