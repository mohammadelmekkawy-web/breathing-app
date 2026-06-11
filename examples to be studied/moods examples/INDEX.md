# Reference: our "Moods" theme feature (competitor calls it "Atmosphere")

OUR feature name: **Moods**. These screenshots are from a competitor breathing app
(also called "breathe") whose version is named **Atmosphere** — studied here as the
reference. It lets the user pick a theme that recolors the ENTIRE app (home,
settings, all screens) and swaps a full-bleed background photo.

Our plan (decided): color/gradient themes (no photos to start), each with a LIGHT
and DARK variant, and the glowing orb tints to match each Mood. 6 Moods (user-chosen).

## What an "Atmosphere" is
Each atmosphere = background photo + color palette + name + one-line mood + an icon.
Chosen from a **full-screen swipeable carousel** (dots = number of atmospheres),
each card showing a big photo, the name, a tagline, and a **Select** button
(becomes a green ✓ **Selected** when active). Also surfaced as a row in Settings
(e.g. "Atmosphere → Forest").

## The atmospheres seen (5 total; one not captured)
| Name     | Mood                  | Palette        |
|----------|-----------------------|----------------|
| Desert   | Warm & earthy         | orange / sand  |
| Sunrise  | Energizing & warm     | dark amber     |
| Forest   | Natural & calming     | green          |
| Infinity | Spiritual & creative  | cosmic purple  |
| (5th)    | (not captured)        | ?              |

## Files
- `home-desert.jpeg`, `home-forest.jpeg` — home screen recolored per atmosphere
- `settings-desert.jpeg`, `settings-forest.jpeg` — settings screen recolored (whole UI)
- `picker-desert.jpeg`, `picker-sunrise.jpeg`, `picker-forest.jpeg`,
  `picker-infinity-selected.jpeg` — the Atmosphere carousel + its Selected state

## Takeaways for our app
- We already theme via CSS variables (light/dark) → extend to N named palettes.
- Could tint the glowing orb + ring to match each atmosphere.
- Background photos add weight + licensing needs → consider color/gradient-only first.
