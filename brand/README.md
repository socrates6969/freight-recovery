# scoup.ai brand guidelines

Norwegian version: [README.no.md](README.no.md).

scoup.ai is the company and the product: one brand. The logo is the "Reconciled s": an s built from
two matching halves that meet exactly at the spine (the invoice and the contract, reconciled). The
upper half is neutral and the lower half teal, so the moment of agreement is the brand. The s sits on
a rounded tile, which doubles as the app icon, avatar and favicon.

The codebase keeps its technical name (`freight-recovery`, `@fr/*`, `freight_recovery`). Only the
name people see changes.

## Name rules

- Always write the name in lowercase: **scoup.ai**. Never "Scoup.ai", "SCOUP.AI", "Scoup AI" or "Scoup".
- Avoid starting a sentence with the name; rephrase ("This site belongs to scoup.ai, ..."). If it
  cannot be avoided, keep it lowercase.
- Possessive: **scoup.ai's**.
- Never put the name inside an all-caps context (for example CSS `text-transform: uppercase`).
- In headers the logo image replaces the text name. The text name still appears in page titles, alt
  text, footers and legal text.
- Descriptive phrases such as "freight invoice recovery" or "freight audit" stay as ordinary lowercase
  words in body copy; they are not the name.

## Files

| File | Use it for |
| --- | --- |
| `lockup-horizontal.svg` | Default logo on light backgrounds: site and app headers, documents. |
| `lockup-horizontal-on-dark.svg` | Same, on dark backgrounds (light tile, light lettering). |
| `lockup-stacked.svg` | Square-ish spaces: sign-in screens, slides, social avatars with room. |
| `lockup-stacked-on-dark.svg` | Stacked, on dark backgrounds. |
| `wordmark.svg` / `wordmark-on-dark.svg` | Name only, where the tile already appears nearby (never as the only brand mark in colour layouts if the tile fits). |
| `mark.svg` / `mark-on-dark.svg` | The tile alone, 24 px and up: app icons, avatars. |
| `favicon.svg` | Browser tab icon, 16-24 px (heavier strokes for small sizes). |
| `lockup-horizontal-mono-black.svg`, `lockup-stacked-mono-black.svg` | One-colour print, fax, stamps, embossing on light material. |
| `lockup-horizontal-mono-white.svg`, `lockup-stacked-mono-white.svg` | One-colour reversed out of a dark or photographic background. |

Every SVG carries `role="img"` and a `<title>`. When you embed one with `<img>`, give it
`alt="scoup.ai"`; if a text name sits right next to it, mark the image decorative (`alt=""` or
`aria-hidden="true"`) so screen readers do not hear the name twice. The mono files use an SVG mask
with the id `ma`; do not inline two of them in the same HTML document (embed them with `<img>`).

## Clear space

- x = the x-height of the wordmark (about 61% of the horizontal lockup's height).
- Keep **1x** clear on all sides of any lockup or wordmark.
- Keep **0.25 x tile width** clear around the tile when it is used alone.

## Minimum sizes

| Asset | Screen | Print |
| --- | --- | --- |
| Horizontal lockup | 20 px tall (about 105 px wide) | 6 mm tall |
| Stacked lockup | 48 px tall | not yet specified (confirm with the designer) |
| `favicon.svg` | 16-24 px | not for print |
| `mark.svg` | 24 px and up | not yet specified |

Below these sizes use the next smaller asset (lockup, then mark, then favicon) instead of scaling down.

## Palette

These are existing product tokens; no new accent was introduced.

| Role | Light surfaces | Contrast | Dark surfaces | Contrast |
| --- | --- | --- | --- | --- |
| Ink: letters and tile | `#0f172a` | 17.85:1 on white | `#e2e8f0` | 15.19:1 on `#0b1220` |
| Teal: lower half of the s | `#0f766e` (on the light tile) / `#2dd4bf` (on the dark tile) | 5.47:1 on white; 9.59:1 on the `#0f172a` tile | `#2dd4bf` | 10.06:1 on `#0b1220` |
| Muted: ".ai" | `#64748b` | 4.76:1 on white | `#8b9ab0` | 6.55:1 on `#0b1220` |

Marks need at least 3:1 against their background; ".ai" and any lettering need at least 4.5:1. Every
pair above passes. `#0f766e` on dark slate is only 3.42:1, so dark backgrounds always switch to
`#2dd4bf`.

Use the **dark tile on light backgrounds** (the plain files) and the **light tile on dark backgrounds**
(the `-on-dark` files).

## Do and don't

Do:

- Use the files as supplied, scaled proportionally.
- Keep the tile's corner radius at 22% of its width.
- Use the dark tile on light backgrounds and the light tile on dark backgrounds.

Don't:

- Offset the two halves of the s; they must meet exactly.
- Put the dark tile on dark slate: it disappears (1.05:1).
- Swap the colours of the two halves.
- Use the s without its tile in colour versions.
- Recolour, stretch, skew, outline, add shadows, gradients or other effects, or animate the logo.
- Set the name in capitals or another typeface as a stand-in for the logo.

## Production TODO

The lettering is drawn with SVG strokes (`stroke-width`), not filled outlines. Browsers render it
correctly, but before final print use (and before sending files to a printer or sign maker) convert
the strokes to outlines in a vector editor (for example Illustrator "Outline Stroke" or Inkscape
"Stroke to Path") and keep the stroked originals here as the source.
