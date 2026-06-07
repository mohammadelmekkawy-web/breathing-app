# Breathe — a calm breathing PWA

A tiny, installable breathing-exercise app. Plain HTML/CSS/JS — no frameworks, no
build step, no network needed after first load. Mobile-first, dark by default,
designed to ask for the least attention possible.

- **Focus (Box breathing)** — 4s inhale → 4s hold → 4s exhale → 4s hold. 2–8 cycles.
- **Relax (Coherent breathing)** — 5s inhale → 5s exhale (~6 breaths/min). 5 or 10 minutes.
- **Sleep (4-7-8 breathing)** — 4s inhale → 7s hold → 8s exhale. 2–8 cycles.
- **Custom patterns** — build your own duration combinations and save them locally.
- **Goal-based mode selection** — cards describe the benefit ("feel in control", "calm down") instead of technique names.
- **Beginner guidance** — recommended default settings and first-time hint on startup.
- **Glowing orb visual** — optional alternative to the circle: a round vessel where soft blue liquid (clipped strictly inside) rises on the inhale and falls on the exhale, with a gently swaying wavy surface, a soft inner glow, and white/warm-yellow particles that appear and drift as it fills — a serene "galaxy in a bubble." Canvas-rendered and modest in cost; reduced-motion shows a calm flat fill with no waves or particles.
- **Background meditation music** — optional, off by default. Choose one of two looping ambient MP3 tracks; preview them in settings before committing. Seamlessly looped (crossfade at the seam) with gentle fade in/out, layered under the phase-change cue tones so the app stays usable eyes-closed. Cached after first play for offline use.
- **In-session audio controls** — always-visible mute plus a one-tap panel (cue tones, **ambient track picker**, volume). Switching the ambient track mid-session crossfades smoothly without interrupting the breathing.
- **Animated welcome + onboarding** — a first-launch intro (with a gentle chime) and a quick, skippable profile (name, age range, goal) that suggests a recommended mode. Replayable from settings.
- **Encouragement-only gamification** — points per session and a forgiving **Rhythm** (the days you keep coming back) that *only* builds up: a missed day pauses it, never resets, no guilt. Structured for a future (local) leaderboard.
- **Honest end-of-session dashboard** — real personal stats (session minutes, totals, lifetime, rhythm, points), an effective-dose ring toward the research-backed ~5–10 min/day, general-info consistency milestones, and an optional 1–5 calm self-check with your own before/after delta. No invented biomarkers.
- **Local data export** — a plain-language **readable summary** and a **CSV** (totals on top, each session in your local time with a Morning/Afternoon/Evening/Night label). Copy, share, or download. Everything stays on your device; nothing is uploaded.
- **My Summary card** — an in-app visual card (styled like the end screen) with all-time totals (sessions, lifetime, rhythm, points, avg calm self-report) and a calm this-week-vs-last-week trend. Personalized, honest, with its own share button.
- **Gentle share** — a calm "Invite a friend to breathe" button (leaf icon) on the dashboard and summary card, with a warm, non-competitive message and the app link (Web Share API, clipboard fallback). No scores, no pressure. The calm "rhythm" uses a 🌿 leaf — never a flame.

An animated guide circle (or liquid fill) shows your breathing in real time. The phase label,
per-phase countdown, and breathing animation are all driven from **one `requestAnimationFrame` loop**,
so they can never drift apart. A thin progress ring around fills slowly over the whole session.
The phase label, the per-phase countdown, and the breathing animation are all driven
from **one `requestAnimationFrame` loop reading a single elapsed-time accumulator**, so
they can never drift apart. A thin, muted progress ring around the circle fills slowly
over the whole session.

---

## Run it locally

You need any static file server (the app is just files on disk). Pick one:

**Python 3** (already on macOS):
```bash
cd "/Users/mohammadelmekkawy/Documents/breathing app"
python3 -m http.server 8000
```
Then open <http://localhost:8000> in your browser.

> If `python3 -m http.server` is blocked in your environment, use the bundled
> server instead, which serves this folder explicitly:
> ```bash
> python3 tools/serve.py 8000
> ```

**Node (if you have it):**
```bash
npx serve .
# or: npx http-server -p 8000
```

A PWA needs a real origin for the service worker and offline cache — open it via
`http://localhost`, **not** by double-clicking `index.html` (`file://` disables
service workers).

### Test offline
1. Load the app once over `http://localhost`.
2. Open DevTools → **Network** → tick **Offline** (or stop the server).
3. Reload — it still works. Assets are served from the service-worker cache.

---

## Install on your phone

### iPhone (iOS Safari)

iOS only installs PWAs from **Safari**.

1. Serve the app somewhere your iPhone can reach it:
   - Same Wi-Fi as your Mac: find your Mac's IP (System Settings → Wi-Fi → Details →
     IP address, e.g. `192.168.1.42`), run the server above, and on the iPhone open
     `http://192.168.1.42:8000`.
   - Or deploy the folder to any static host (GitHub Pages, Netlify, Vercel — all free).
     HTTPS hosting also unlocks full offline install.
2. In **Safari**, tap the **Share** button (the square with an up-arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**. "Breathe" now appears on your home screen with its own icon and
   launches full-screen (no Safari chrome), and works offline.

### Android (Chrome)

1. Serve the app somewhere your Android device can reach it (see iPhone steps above for examples).
2. On **Chrome** for Android:
   - Open the app in the browser (tap the address bar and paste the URL).
   - Tap the **menu** button (three dots, top right).
   - Tap **Install app** (or **Add to Home screen** if that option appears).
   - Tap **Install** to confirm.
   - "Breathe" appears on your home screen as an app and launches full-screen, with offline support.

> The screen is kept awake during a session via the **Wake Lock API** where supported;
> on browsers without it the app simply carries on (no error).

---

## Self-audit against the design standards

Legend: ✅ done · 🟡 partial / caveat · ⬜ skipped

### Nielsen’s 10 usability heuristics
| Item | Status | Notes |
|---|---|---|
| Visibility of system status | ✅ | Phase label, big per-phase countdown, cycle counter, and ambient progress ring all live at once. |
| User control & freedom | ✅ | **Stop** and **Pause/Resume** always on screen during a session; never trapped. `Esc` stops, `Space` pauses. |
| Consistency & standards | ✅ | Native-feeling segmented controls, steppers, switches; system fonts. |
| Error prevention | ✅ | Sensible defaults (box 5 cycles, 4-7-8 4 cycles, coherent 5 min); cycles clamped 2–8 (buttons disable at ends); duration limited to 5/10; impossible to start invalid session. |
| Recognition over recall | ✅ | Every setting shows its current value (stepper number, selected segments, switch states) — nothing hidden behind memory. |
| Flexibility & efficiency | ✅ | One-tap Start with remembered settings; advanced options tucked in a disclosure. |
| Aesthetic & minimalist design | ✅ | One primary action per screen; during a session nothing competes with the guide. |
| Help users recover from errors | 🟡 | No error states exist by design (no invalid inputs, no network dependency), so there’s little to recover from. |
| Match system & real world | ✅ | Plain language (“Inhale / Hold / Exhale”, “Cycle 3 of 6”). |
| Help & documentation | 🟡 | The app is self-explanatory; this README is the documentation. No in-app help screen. |

### WCAG 2.2 Level AA
| Item | Status | Notes |
|---|---|---|
| `prefers-reduced-motion` | ✅ | Detected in CSS **and** JS. The circle stops scaling and instead does a gentle opacity fade; the progress ring updates in ~2% steps instead of animating continuously. |
| Text contrast ≥ 4.5:1 | ✅ | Measured: dark body text **15.95:1**, dim text **9.55:1**; light body **14.17:1**, dim **6.13:1**. |
| Large text / UI contrast ≥ 3:1 | ✅ | Primary button **8.55:1** (dark) / **5.57:1** (light), Stop **8.55 / 4.86**, progress ring vs track **3.67:1** (dark) / **3.21:1** (light) — kept deliberately muted but above 3:1. |
| Never color alone | ✅ | Phase is always shown as **text**; sound + haptic are optional reinforcements, not the only signal. Switches differ by knob **position** as well as color. |
| Keyboard operable + visible focus | ✅ | All controls are real `<button>`s, fully tabbable, with a high-contrast (12.8:1) focus ring. Skip-link included. |
| ARIA labels on icon-only buttons | ✅ | `+ / −` steppers, Pause, Stop all have `aria-label`s. |
| `aria-live="polite"` phase announcements | ✅ | A visually-hidden live region announces each phase (“Inhale, 4 seconds”), Paused, Resumed, Stopped, Session complete. |
| Tap targets | ✅ | Audit found **0** interactive elements under 44px (Start 480×56, steppers 48×48, switches 56×48, skip-link 142×44). |
| Zoom not blocked | ✅ | Viewport has no `maximum-scale`/`user-scalable=no`. |

### Apple Human Interface Guidelines
| Item | Status | Notes |
|---|---|---|
| ≥ 44×44pt tap targets | ✅ | See above. |
| Safe areas (notch / home indicator) | ✅ | Layout padded with `env(safe-area-inset-*)` and `viewport-fit=cover`; no control sits under the notch or indicator. |
| Dynamic Type | ✅ | Everything is sized in `rem`/relative units and `clamp()`, so it scales with the system text size. |
| Meaningful, subtle haptics | ✅ | `navigator.vibrate` fires only on phase change, short, and is suppressed under reduce-motion. |

### Google Material 3 (Android install)
| Item | Status | Notes |
|---|---|---|
| ≥ 48×48dp touch targets | ✅ | Primary/secondary buttons, steppers, segments and switches are all ≥ 48px. |
| 8dp spacing grid + clear hierarchy | ✅ | Spacing tokens are multiples of 8px; one clear primary action per screen. |
| Maskable icon | ✅ | `icon-512-maskable.png` with a safe-zone-aware circle is in the manifest. |

### Calm technology
| Item | Status | Notes |
|---|---|---|
| Minimum attention | ✅ | No badges, guilt-trips, notifications, or nags. The "Rhythm" only grows and never breaks, so there's nothing to lose. |
| One-tap start, advanced tucked away | ✅ | Start screen reduces to **mode + Start** (Hick’s Law); options live in a disclosure. |
| No dark patterns | ✅ | Nothing tries to retain or guilt you. |

### Fitts’s & Hick’s Laws
| Item | Status | Notes |
|---|---|---|
| Fitts: large central primary button | ✅ | Full-width 56px Start button. |
| Hick: minimize start-screen choices | ✅ | Mode + the single relevant setting are primary; everything else is secondary/disclosed. |

### PWA requirements
| Item | Status | Notes |
|---|---|---|
| `manifest.json` (name, short_name, theme/bg color, standalone, icons) | ✅ | Includes 192, 512, and 512 maskable icons. |
| Service worker, full offline | ✅ | Network-first for the app shell (always-fresh updates online), cache-first for icons; versioned cache deleted on activate; offline falls back to the cached shell. See **Deploying updates**. |
| iOS meta tags | ✅ | `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon` all present. |

### Onboarding, gamification, dashboard & data
| Item | Status | Notes |
|---|---|---|
| Animated welcome (first launch, replayable) | ✅ | Pulsing orb + staggered text beats (reduced-motion → static), gentle intro chime on first touch, "Get started" → onboarding. Re-openable via **Profile & data → Replay intro**. |
| Onboarding profile | ✅ | Name, age range, goal as tappable chips; goal suggests a mode (overridable); skippable; persisted to `localStorage`. |
| Points | ✅ | Awarded only on **completed** sessions (~5/min + completion bonus). |
| Forgiving "Rhythm" | ✅ | Labelled **Rhythm** (not "streak") with a calm one-line description, since a streak implies something you can break. Only builds up; a missed day pauses it (never resets, no guilt); "let's pick up your rhythm" after a gap. Structured (points + rhythm) for a future local leaderboard. |
| Honest dashboard | ✅ | Real stats only (session/lifetime/sessions/rhythm/points) + effective-dose ring to ~5–10 min + general-info weekly milestone. **No fabricated biomarker** — the only "calm" figure is the user's own 1–5 self-report, always labeled as such. |
| Optional calm check | ✅ | 1–5 before/after with Skip; stores both; shows the user's own delta and running average. Toggle in Options. |
| My Summary (in-app card) + CSV export | ✅ | "My summary" opens a visual card (totals + this-week-vs-last-week trend, personalized, honest self-report only). JSON dropped. CSV kept (totals on top, local readable timestamps + part-of-day, "Xm Ys" durations; timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`, never GPS) via copy/share/download. |
| In-session track switching | ✅ | A `<select>` in the audio panel swaps the ambient track mid-session with a 2s overlapping crossfade; never resets the breathing. |
| Gentle share | ✅ | Real ghost **button** (leaf icon, 44px, `aria-label`) on the dashboard and summary card. Web Share API with a robust clipboard fallback (distinguishes user-cancel from failure so it always does something). Warm, non-competitive message + app link. |
| Calm iconography | ✅ | The rhythm indicator uses a 🌿 leaf, not a 🔥 flame (no heat/competition framing). |
| Data stays local | ✅ | All profile/progress in `localStorage`; an on-screen note on onboarding and in **Profile & data** states it's never uploaded. |
| New screens: contrast / tap targets / ARIA | ✅ | Contrast recomputed from the palette — text 11.9–15.8:1, dim 6.1–9.6:1, selected chips 4.6–8.6:1, dose ring vs track 4.2–6.1:1 (all ≥ AA). Chips 48px, calm buttons 52px, inputs 48px. Chips/calm use `role`+`aria-checked`/`aria-label`; inputs labeled; dialog has `role="dialog"`/`aria-modal`. |
| Calm-check modal focus trap | 🟡 | Opens focused, `Esc` skips, backdrop dims — but it does not fully trap Tab to the dialog. Low-stakes (a 1–5 self-check); can harden if desired. |

### Caveats / how I verified
- **Contrast, tap targets, ARIA, labels, lang, zoom, heading order, duplicate IDs** were
  verified for the original build by running an automated DOM audit in a real Chromium
  preview and computing WCAG contrast ratios from the actual palette — **0 issues**.
- The **later additions** (soundscape, in-session controls, onboarding/gamification/
  dashboard/export) were built after the in-editor browser preview became unavailable, so
  they were verified by **JavaScript parse-checks (JavaScriptCore), id/wiring cross-checks,
  recomputed contrast ratios, and CSS-measured tap targets** — not a live click-through.
  Please do a quick pass on a device; report anything off and it'll be fixed.
- I could **not run the Chrome “Lighthouse” panel here** (it needs Chrome DevTools or a
  Node toolchain, which isn’t available in this environment). The custom audit above
  covers the same accessibility checks Lighthouse runs (it uses axe-core under the hood).
  To get the official score, follow the steps in the next section — it should land at or
  near **100** for Accessibility; fix anything it surfaces in `styles.css` / `index.html`.
- **Reduced motion** is implemented in both CSS (`@media (prefers-reduced-motion: reduce)`)
  and JS (the render loop swaps scaling for an opacity fade and steps the ring). Verify it
  by turning on **iOS Settings → Accessibility → Motion → Reduce Motion** (or, in desktop
  Chrome DevTools, the “Rendering” tab → *Emulate CSS prefers-reduced-motion*).

---

## Run a Lighthouse audit yourself
1. Open the app at `http://localhost:8000` in **Chrome**.
2. DevTools (`⌘⌥I`) → **Lighthouse** tab.
3. Tick **Accessibility** (and **PWA** / **Best Practices** if you like), choose
   **Mobile**, click **Analyze page load**.
4. Read the Accessibility score and the “Passed/Failed audits” list.

---

## Deploying updates (GitHub Pages)

PWAs are aggressively cached, so a naïve deploy can leave phones stuck on an old
build. The fix is baked in:

- **Network-first** for HTML/CSS/JS/JSON: when online you always get the newest
  files; the cache is only the offline fallback.
- **Versioned cache** (`breathe-<version>`): on activate, every older `breathe-*`
  cache is deleted.
- **`skipWaiting()` + `clients.claim()`**: the new worker takes over immediately,
  and the page reloads once to pick it up.

To ship an update, just run:

```bash
./tools/deploy.sh "what changed"
```

It stamps a **unique version** into `sw.js` (UTC timestamp + commit hash), so the
service-worker bytes always change → browsers detect the new worker → the old
cache is busted. Then it commits and pushes to `main`, which GitHub Pages
redeploys in about a minute. On your phone, **just reopen the app** — no need to
delete and reinstall.

> Deploying by hand instead? Bump `const VERSION = '…';` at the top of `sw.js` to
> any new value before you commit, or the cache won't refresh.

If a phone is *already* stuck on a pre-fix build: open the site in Safari once
(not the installed icon), which lets the browser fetch the new `sw.js`; it will
update and reload. After this fix lands you won't need to do that again.

## Project layout
```
index.html      markup for the start / session / end screens + meta tags
styles.css      theme tokens, layout, reduced-motion + safe-area handling
app.js          settings, the single-timer engine, audio, haptics, wake lock, SW reg + auto-update
manifest.json   PWA manifest
sw.js           service worker — network-first shell, versioned cache, offline fallback
icons/          generated PNG icons (192, 512, 512 maskable, apple-touch-icon)
tools/          dev helpers: icon generator, a tiny static server, deploy.sh (cache-busting deploy)
```

## Keyboard shortcuts (during a session)
- **Space** — Pause / Resume
- **Esc** — Stop
