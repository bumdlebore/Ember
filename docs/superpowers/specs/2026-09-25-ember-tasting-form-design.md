# Ember — tasting form redesign

Design doc, spec 1 of 2. Written 2026-09-25. Direction approved in chat: the tasting-form
look, the flame icon, flavor tags, and the draw, burn, and would-smoke-again fields.
Spec 2 (a bigger catalog, with a private one-time scrape) is separate and comes later.

## Problem

Austin's feedback on the quick-log build:

- The colors read as muddy brown, and the look is generic: a dark app with an orange glow.
- The home-screen icon renders poorly with his iOS 26 Liquid Glass "Clear" icons.
- His tasting notes hold only what comes to mind. He wants a full flavor list to walk
  through, like the SCA coffee wheel, and he wants the Untappd habits he liked: flavor
  tags, a fast check-in, and stats worth looking at.

## Concept

Ember is a printed tasting form that he fills in:

- The printed parts (labels, rules, and buttons) are in one form ink.
- His entries (cigar names, notes, and checks) are in pen.
- His score gets circled in red, the way a judge marks a scoresheet. That circle is the one
  bold element. Everything else stays quiet.

## Visual system

### Color

The palette follows `prefers-color-scheme`. Dark mode is the same form with paper and ink
inverted.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--paper` | page | `#FAFAF7` | `#15191A` |
| `--form` | printed labels, form chrome, primary button | `#2F5D45` | `#8DBE9F` |
| `--rule` | ruled lines, boxes, dividers | `#C9D8CE` | `#2A3530` |
| `--pen` | his entries | `#1C2333` | `#ECEAE4` |
| `--mark` | the score circle, the tally strike | `#C2362B` | `#FF6B5B` |
| `--faint` | placeholders, unchecked options | `#66736C` | `#7F8C86` |

- Surfaces are flat, with no gradients, glows, shadows, or radial backgrounds.
- `theme-color` gets two `<meta>` tags, one per `media="(prefers-color-scheme: …)"`.
- Every text/background pair meets WCAG AA. Computed 2026-09-25 against `--paper`: form
  7.24 and 8.43, pen 15.0 and 14.7, mark 5.21 and 6.33, faint 4.74 and 5.06 (light, dark).
  The first faint values proposed (`#8A968F`, `#5E6B65`) failed at 2.9 and 3.2, so they were
  darkened. The UI checks recompute these ratios.

### Type

- **Print:** Barlow Condensed, weights 500, 600, and 700 (SIL Open Font License). It covers
  labels, numbers, tabs, and buttons, with tabular figures for scores. The woff2 files and
  `OFL.txt` are self-hosted in `public/fonts/`. The Worker serves them behind Access with
  `X-Ember-Shell: 1`, so the service worker caches them and the font works offline.
  The files are `BarlowCondensed-{Medium,SemiBold,Bold}.woff2` from `github.com/jpt/barlow`
  (`fonts/woff2/`, about 60 KB each, so about 180 KB total, cached after the first load),
  plus `OFL.txt`. Austin approved the download on 2026-09-25.
- **Pen:** `ui-serif, "New York", Georgia, serif`. On iPhone that's New York, which is built
  in. It covers cigar names, the name input, notes, and his checked tags.
- The Google Fonts link and the Fraunces, Inter, and JetBrains Mono fonts are removed.
- Scale: labels 13px/600, body 16px, cigar name 19px, the screen title 26px/700, and
  the score scale 17px/600. Inputs stay at 16px or larger so iOS doesn't zoom on focus.
- Labels use sentence case and never all caps. Middle-dot meta strings are replaced by
  labeled cells.

### Form elements

- An input is a pen line on a ruled baseline: bottom border only, with a label above in
  form ink.
- Cards are replaced by ruled sections. There is one sheet of paper per screen, not a stack
  of cards.
- Buttons: the primary is solid `--form` with paper-colored text, and a secondary is a
  `--form` outline. The corner radius is 6px on buttons and 3px on check boxes.
- Focus is a 2px `--form` outline, offset 2px.
- Motion appears only when an action shows what changed: the score circle draws in (stroke
  animation, about 180 ms), and a flavor family opens. Both respect
  `prefers-reduced-motion`.

## Log screen (the form)

Top to bottom:

1. **Header:** "Ember" (print 700), with "No. 52" on the right. The number is the next entry
   number (`live().length + 1`). In edit mode, the header instead reads "Editing <name>".
2. **Unrated strip:** kept from the quick-log build and restyled as a ruled row with the pen
   name and a "Rate it" link.
3. **Cigar:** the name field, with suggestions restyled as a ruled list.
4. **Brand and wrapper:** two labeled cells beside each other. They show the picked or
   filled values and replace the middle-dot summary line. Tapping either one opens Details.
5. **Smoke again:** chips restyled as outlined pen text.
6. **Score:** the printed scale `3.5 3.75 4 4.25 4.5 4.75 5`, plus "Lower scores" for
   `2 … 3.25`. The selected value gets a hand-drawn red ellipse, an inline SVG path in
   `--mark`, and tapping it again clears it. Rating values and behavior are unchanged.
7. **Tasted:** the flavor wheel (see below).
8. **Draw / Burn / Again:** three printed rows of options. Tapping one underlines it in pen,
   and tapping it again clears it.
   - Draw: tight, just right, loose. Stored as `dr` = `tight` | `good` | `loose`.
   - Burn: even, canoed, relit. Stored as `bu` = `even` | `canoe` | `relit`.
   - Again (would smoke again): yes, maybe, no. Stored as `ag` = `yes` | `maybe` | `no`.
9. **Notes:** a ruled textarea in pen italic.
10. **With friends and date:** unchanged in behavior and restyled.
11. **Details:** unchanged fields, restyled as ruled cells.
12. **Save to log:** a bar pinned directly above the tab bar, so it's always visible. The
    fast path is a smoke-again chip, a score, then Save, with no scrolling. In edit mode the
    bar reads "Save changes", with "Cancel" beside it.

## Flavor wheel

### Lexicon

There are 10 families and 47 tags. Tags are stored lowercase in a new entry field
`t: string[]`, which is optional and treated as empty when absent. Each tag has a regex that
also counts past notes.

| Family | Tags (regex notes) |
|---|---|
| Sweet | sweet `/sweet\|sugar/`, caramel `/caramel/`, honey `/honey/`, molasses `/molasses/`, vanilla `/vanilla/` |
| Cocoa and coffee | chocolate `/chocolat\|s'?more/`, cocoa `/cocoa/`, coffee `/coffee/`, espresso `/espresso/` |
| Nut and cream | nutty `/\bnut(ty\|s)?\b/`, almond `/almond/`, peanut `/peanut/`, cream `/\bcream(?!y)/` |
| Bread and toast | cracker `/cracker/`, graham `/graham/`, toast `/toast/`, bread `/bread/` |
| Wood | cedar `/cedar/`, oak `/oak/`, woody `/wood/`, charred `/char\b\|charred\|barrel/` |
| Spice | black pepper `/black pepper\|pepper/`, white pepper `/white pepper/`, cinnamon `/cinnamon/`, clove `/clove/`, nutmeg `/nutmeg/`, anise `/anise\|licorice/` |
| Earth and leather | earth `/earth/`, leather `/leather/`, meaty `/meaty\|meat\b/`, funk `/funk/`, mineral `/mineral\|graphite/` |
| Fruit | raisin `/raisin/`, cherry `/cherry/`, citrus `/citrus\|orange\|lime\|lemon/`, apricot `/apricot/` |
| Floral and herbal | floral `/floral\|flower/`, hay `/\bhay\b/`, grass `/grass/`, tea `/\btea\b/`, herbal `/herb/` |
| Feel | smooth `/smooth/`, creamy `/creamy/`, harsh `/harsh/`, bitter `/bitter/`, acidic `/acid/`, dry `/\bdry\b/` |

- Family-level regexes also catch vague words: Sweet `/sweet/`, Spice `/spice\|spicy/`, and
  Fruit `/fruit\|fig\|plum/`.
- "Black pepper" also matches a bare "pepper", because in his notes "pepper" means black
  pepper.
- Every regex is case-insensitive.

The list is independent. Single flavor words can't be copyrighted, and the published wheels
say "all rights reserved", so none is copied verbatim. Its coverage draws on the Blind Man's
Puff and Cigar Snob wheels and on the open-access Wu et al. (2024, CC BY) cigar sensory
lexicon.

### Picker

- The 10 families form a 2-column grid of printed buttons, and each shows how many of its
  tags are checked, for example "Spice 2".
- Tapping a family opens its tags as check boxes below the grid. Only one family is open at
  a time, and tapping it again closes it. This follows the coffee-wheel habit of working from
  the center outward.
- A pen line under the "Tasted" label lists every checked tag across families, for example
  "black pepper, chocolate, smooth". Tapping a tag there unchecks it.
- Smoke again doesn't copy `t`, `dr`, `bu`, or `ag`, because those belong to one smoke.
  Edit loads them.

## Journal

- Each entry is a ruled row: the pen name, then a printed line with the brand and date, and
  the score in pen at the right.
- Checked tags show as pen text, up to 4 plus "+N".
- The unrated label becomes the word "unrated" in `--faint`.
- Search also matches tags.
- The detail sheet becomes a read-only form with the same labels and ruled cells, listing
  tags, draw, burn, and again. It keeps the Edit, Smoke again, and Delete actions.

## Palate (scorecard)

1. The title "Your palate", then a pen line built from his data: "51 smokes and 25 brands since January 2021". The month and year come from his earliest entry.
2. **Headline:** the existing shrunk-average sentence, set in pen with no italic accent word.
3. **Smokes by year:** tally marks drawn in SVG, pen strokes grouped in fives, with the fifth
   stroke struck in `--mark`. Each year shows its count.
4. **Flavors:** families ranked by how many smokes include them (tag or regex hit), with a
   bar in `--form` and the average score. Tapping a family opens its tags with counts.
5. **Would smoke again:** his most recent `ag = yes` entry for each cigar, as a buy-again
   list. If there are none yet, it reads "Mark 'yes' under Again and they collect here."
6. **Draw and burn:** counts, such as "Tight draw 3 of 9", shown only once 3 or more smokes
   have them.
7. **Tables for origin, wrapper, binder, filler, body, and shape:** printed tables with name,
   count, and average, ranked by the shrunk average. This keeps the quick-log logic and drops
   the card chrome.
8. **Top rated:** as today, restyled.
9. **Footer:** backfill, export, and import are unchanged. The CSV gains Flavors, Draw,
   Burn, and Again columns.

## Tab bar and chrome

- The tab bar is a ruled top line with print labels (Log, Journal, Palate). The active tab
  is in pen, with a 2px `--form` underline.
- The sync pill becomes a small print label ("Synced 9:14", "Offline", "Sign in") in
  `--form`, with `--mark` for errors.
- The toast is a small paper slip with a `--rule` border.
- The detail sheet is paper on a `--pen`-tinted scrim.

## Icon

- A solid `#FAFAF7` flame on a full-bleed `#2F5D45` square, with no gradient and no glow. It
  follows `public/icon-source.svg`, and the PNGs (180, 192, 512) are regenerated with
  `rsvg-convert`.
- **Unverified:** how iOS 26 converts a web-app icon in Clear mode. Apple documents no
  support for Clear or Tinted variants on web clips. The phone check settles it.

## Data

- New optional entry fields: `t` (array of lowercase tag strings), `dr`, `bu`, and `ag`
  (strings, empty or absent when unset).
- The Worker stores each entry as opaque JSON (`src/entries.js` does
  `JSON.stringify(entry)`), so sync needs no server change. Verified 2026-09-25.
- An older cached client that syncs an entry keeps any fields it doesn't know about,
  because `mergeServer` replaces whole objects.

## Non-goals

- The catalog source and size. That's spec 2.
- Any Worker change beyond the font route.
- Streaks, badges, and social features.

## Testing

- **vitest:** `/fonts/*.woff2` returns 200 as `font/woff2` with `X-Ember-Shell: 1` when
  authenticated, and 403 without Access. `/` no longer references `fonts.googleapis.com`.
- **UI checks** (`npm run test:ui`, headless Chromium, run in both light and dark by
  emulating the color scheme). The existing task2 through task4 checks are updated only where
  markup changed, and none of their assertions are dropped. New checks:
  - Tag round-trip: check 3 tags in 2 families, save, and confirm `t` holds exactly those
    tags. Edit shows them checked, and Smoke again leaves them clear.
  - Draw, burn, and again set, clear, and save.
  - Palate flavor counts on seed data: the Spice family includes the 14 past "pepper"
    notes, and "smooth" counts 12.
  - The tally for 2023 shows 17 marks.
  - The Save bar stays in view at 375×812 with the form scrolled to the top and to the
    bottom.
  - Contrast is at least 4.5:1 for pen on paper, form on paper, and faint on paper, in both
    color schemes.
  - The page makes no requests to `fonts.googleapis.com` or `fonts.gstatic.com`.
- **Phone (Austin, about 5 minutes):**
  1. Delete the old home-screen icon and add it again.
  2. Check the flame in Clear mode.
  3. Log a smoke with tags, draw, and again.
  4. Look at Palate in both light and dark (Settings → Display).
