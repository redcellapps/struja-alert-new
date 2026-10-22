# Design direction v2 (22 Oct 2026)

Milan reviewed the first component gallery (`docs/screens/android/design-review/`) and rejected the look: it reads as a 2013 app. The causes are the system font (Roboto at default weights), the muddy mesh gradients, Material You pastels, outlined chips and loose, uneven spacing. This file replaces those choices. BRIEF §7 is updated to match.

References: `docs/design/references/ref-1-dark-bento.png` (dark bento dashboard, one lime accent, bold type, big numbers) and `ref-2-bold-cards.png` (flat, saturated cards, bold geometric type, large radii). Take the principles from them, not the content.

## Principles

- **Flat, no gradients.** Solid fills only. Surfaces are told apart by fill, not by shadows or outlines.
- **Bento layout.** Large rounded cards in a 1- and 2-column grid. Each card carries one big number or one short headline, with a small icon and a label.
- **One brand accent: electric lime**, around `#D4F84A`. Use it as a fill (selected chip, primary button, selected day, the "clear" status), always with near-black text on it. Never use lime as text on a light background.
- **Strong hierarchy.** Big bold headline, huge numerals for times and countdowns, quiet secondary text. No letter-spaced capitals; labels are sentence case.
- **Dark theme is the showcase; light is just as finished.** Both follow the system setting.

## Tokens (starting values; tune them, keep WCAG AA)

| Token | Dark | Light |
|---|---|---|
| Background | `#0B0B0D` | `#F2F2F5` |
| Card | `#18181B` | `#FFFFFF` |
| Card, raised or pressed | `#222226` | `#E9E9EE` |
| Text primary | `#F5F5F7` | `#0B0B0D` |
| Text secondary | `#9A9AA3` | `#5C5C66` |
| Accent (lime) | `#D4F84A` | `#D4F84A` (fill only) |
| On accent | `#0B0B0D` | `#0B0B0D` |

Status fills (flat, used for the hero card and the status badges):
- `clear`: lime
- `upcoming`: amber, around `#FFC23D`, with dark text
- `imminent`: orange, around `#FF8A3D`, with dark text
- `active`: red, around `#FF4D4F`, with white text
- `cancelled` / `past`: the raised card fill, with secondary text and the time struck through

**Shape and spacing:**
- 4-pt grid, 20 side margins, 20 card padding, 12 between cards, 28–32 between sections
- Radius: 24 for cards; 16 for inputs, tiles and buttons; full pill only for small badges

## Typography

Embed one open-source (OFL) family; no system font. Build a **type specimen screen** with three candidates and let Milan choose:

- **A:** Onest for everything
- **B:** Manrope for everything
- **C:** Unbounded for headlines and big numbers, with Onest for text

**Requirements for each candidate.** Check them in the font files (fontTools) and report; drop any candidate that fails:
- **Serbian Latin:** č ć š ž đ Č Ć Š Ž Đ
- **Serbian Cyrillic:** ђ ћ љ њ џ ј Ђ Ћ Љ Њ Џ Ј, and the Serbian `locl` forms if available. Report it if they are not.
- **Tabular figures (`tnum`)**, so countdown digits don't jitter
- **Static weight files** (Regular, Medium, SemiBold, Bold, ExtraBold), embedded at build time with the expo-font config plugin. Not a runtime download.

**Scale (starting point):**
- Display numerals: 56–72, ExtraBold, tabular
- Headline: 28–32, Bold, tracking −0.5 %
- Title: 20, SemiBold
- Body: 16, Regular
- Label: 13–14, Medium, secondary color

Font scaling must still reflow up to 200 %.

## Components

- **Status hero:** a solid card in the status color, with a large faint bolt glyph as a watermark (about 8 % opacity) in one corner. It shows the status badge, a bold headline ("Bez struje", "Sutra bez struje", "Sve u redu"), the address, and the huge countdown or time. The active state keeps the gentle pulse, on the badge only.
- **Day strip:** four square tiles (radius 20) with the day name and number. The selected day is filled lime. A dot marks a day with an outage, and the dot uses the status color.
- **Address card:** label and address on the left, the status badge (a small pill filled with the status color) on the right, the time as a large bold line, and a secondary line under it.
- **Chips:** filled, never outlined. Unselected chips use the raised fill; the selected one is filled lime. In the house-range chips, the user's range is filled lime and the others use the raised fill.
- **Radio choices:** full-width selectable rows or cards (radius 16) with a filled lime check circle on the right when selected.
- **Checkboxes:** rounded squares 24 × 24 (radius 8), filled lime with a dark check.
- **Switches:** a pill track that is lime when on, with a white thumb.
- **Segmented control:** for script (Latinica / Ћирилица) and theme (Sistem / Svetla / Tamna). The selected segment is filled.
- **Buttons:**
  - Primary: 56 high, radius 16, filled lime, dark text
  - Secondary: the raised fill
  - Text button: accent-colored text in dark mode, primary text in light mode
- **24 h timeline:**
  - A 14-high rounded track, with the outage window as a filled segment in the status color
  - "Now" is a dot with a ring
  - Hour labels are small and secondary
- **Banners, empty and error states:** a card with an icon tile (radius 16, raised fill), a short title and one action.
- **Icons:** Material Symbols Rounded, filled, one weight throughout.

## Deliverable for the next review

1. **The type specimen screen.** Show A, B and C side by side, each with:
   - a headline
   - a big countdown `1:12:05`
   - body text
   - chips
   - the same line in sr-Latn and sr-Cyrl: "Isključenje struje: Vojvode Mišića 34, sutra 08:30–12:30" / "Искључење струје: Војводе Мишића 34, сутра 08:30–12:30"
2. **The gallery redone** in the new direction, with font A as the default. A later font change must be a one-token change.
3. **A composed Početna preview** in the gallery, built from mock data:
   - the hero
   - the day strip
   - two half-width tiles: "Sledeće" with the next time, and "Trajanje" with "4 h"
   - three address cards
4. **The controls screen:** radio rows, checkboxes, switches, the segmented controls and the buttons.

Take all of these in dark and light (adb), and add a README to `docs/screens/android/design-review-v2/`. Then stop for Milan's review. Build no screens before he approves.
