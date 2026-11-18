# Tapline design rules

Goal: look like a premium game / trading instrument, not a template. Restraint over decoration.

## Principles (and why)
1. **Quiet by default, loud on events.** Hierarchy only works if most of the UI is calm. Glow, shake, particles and banners
   are reserved for things that just happened (a win, a gift, a price about to touch your bet) and scale with importance.
2. **One typeface, tabular numbers.** IBM Plex Sans Condensed, weights 500/600/700. Live numbers must not jitter, so the font
   needs fixed-width digits (Rajdhani, Inter and others do not by default; `tabular-nums` has no effect on Rajdhani).
3. **Colour carries one meaning each.** Accent teal = interactive/selected. Green/red = result. Gold = reward (gifts, achievements,
   streak). Cool-to-warm heat = payout size. Never decorative gradients.
4. **Never rely on hue alone.** Results also carry a sign or icon (+/-, ▲▼, ✓/✗) so colour-blind players are not locked out.
5. **Contrast.** Body text >= 4.5:1, large text/components >= 3:1 (WCAG AA). Verified with a WCAG contrast script: dim text 6.1-7.5:1, accent/win/gold above 9:1.
6. **Flat surfaces.** Elevation comes from a surface step (`--s1` < `--s2` < `--s3`) and a 1px border, not from coloured shadows.
7. **Consistency.** Radii 6/10/14, spacing in 4/8/12/16, same control styles everywhere (segmented controls, buttons, panels).

## Tokens
`--bg #0a0c10`, `--s1 #10131a`, `--s2 #161a23`, `--s3 #1e232e`, `--text #e8ebf1`, `--dim #98a1b3`,
`--accent #4fd8c8`, `--win #43d98c`, `--loss #ff6b7c`, `--gold #f2c14e`.

## Effects budget
- Allowed glow: price line (4px hairline), a bet whose price is within 2.5 rows, gifts, win/loss rings.
- No: text glow, gradient text, gradient borders, scanlines, infinite shimmer/sweep animations, rainbow palettes.
- Particles/shake are small by default; only big wins (8x+) get confetti and a stronger shake.
- CSS animations respect `prefers-reduced-motion`. Canvas effects (shake, particles, banners) do not yet: add a switch before real release.

## Checklist for a new element
Does it have a job? Is its colour one of the tokens above? Does it still read in greyscale? Is it >= 4.5:1? Is it quiet until it matters?
