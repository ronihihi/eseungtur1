---
name: PDF rotation coordinate transform
description: Correct formulas for converting fractional browser-canvas field positions to pdf-lib drawing coordinates for each page rotation value.
---

## The rule

When burning fields into a PDF with pdf-lib, always use the verified formulas below. The 90°/270° cases are NOT symmetric mirrors — they have distinct formulas. Getting them wrong places fields at the opposite corner of the page.

**Why:** pdfjs renders a page with Rotate=R by mapping PDF MediaBox coords to canvas pixels differently for each rotation. The field overlay in the browser is positioned as fractions of the *rendered canvas*, so we must invert that mapping to get back to pdf-lib's bottom-left MediaBox coordinate system.

## Axis mapping (pdfjs render, scale=1)

| Rotate | Canvas W × H | canvas_x = | canvas_y = |
|--------|-------------|-----------|-----------|
| 0°  | pw × ph | pdf_x | ph − pdf_y |
| 90° | ph × pw | pdf_y | pdf_x |
| 180° | pw × ph | pw − pdf_x | ph − pdf_y |
| 270° | ph × pw | ph − pdf_y | pw − pdf_x |

## Correct toDrawCoords formulas

Inputs: `fx, fy, fw, fh` (fractional canvas position/size), `pw, ph` (MediaBox dimensions).

```
R=0:
  x = fx*pw,          y = ph*(1-fy-fh),       w = fw*pw,  h = fh*ph

R=90:
  x = fy*pw,          y = fx*ph,               w = fh*pw,  h = fw*ph

R=180:
  x = pw*(1-fx-fw),   y = ph*(1-fy-fh),        w = fw*pw,  h = fh*ph

R=270:
  x = pw*(1-fy-fh),   y = ph*(1-fx-fw),        w = fh*pw,  h = fw*ph
```

## Common mistakes

- **Swapping 90° and 270°**: the x/y formulas look similar but the signs differ. A previous fix accidentally exchanged these two cases entirely.
- **180° y formula**: was incorrectly written as `ph*fy` (no complement). Correct is `ph*(1-fy-fh)`.
- Testing only with symmetric fields (fx=fy, fw=fh) hides bugs because `v` and `1-v-size` happen to be equal.

## How to apply

In `artifacts/api-server/src/routes/pdfSigner.ts` → `toDrawCoords()`. Any change to this function must be verified with an asymmetric field placement (e.g. fx=0.1, fy=0.7, fw=0.05, fh=0.1) to catch axis-swap bugs.
