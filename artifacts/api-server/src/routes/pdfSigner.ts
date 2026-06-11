import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import { readFileSync } from "fs";

export interface FieldEntry {
  fieldType: "signature" | "initials" | "date" | "text";
  fieldValue: string;
  signerName: string;
  signedAt: Date;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function fmtDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/**
 * Convert field coordinates from "displayed page space" (top-left origin, fractions
 * of the DISPLAYED canvas) to "pdf-lib drawing space" (bottom-left origin,
 * un-rotated MediaBox units).
 */
function toDrawCoords(
  fx: number, fy: number, fw: number, fh: number,
  pw: number, ph: number,
  rotation: number
): { x: number; y: number; w: number; h: number } {
  switch (rotation) {
    case 90:
      return { x: fy * pw, y: fx * ph, w: fh * pw, h: fw * ph };
    case 180:
      return { x: pw * (1 - fx - fw), y: ph * (1 - fy - fh), w: fw * pw, h: fh * ph };
    case 270:
      return { x: pw * (1 - fy - fh), y: ph * (1 - fx - fw), w: fh * pw, h: fw * ph };
    default:
      return { x: fx * pw, y: ph * (1 - fy - fh), w: fw * pw, h: fh * ph };
  }
}

/**
 * Return the DISPLAY dimensions of the field box (width × height as seen by the viewer).
 * For R=90/270 the MediaBox x/y axes are swapped relative to display.
 */
function displaySize(rotation: number, bw: number, bh: number): [number, number] {
  return rotation === 90 || rotation === 270 ? [bh, bw] : [bw, bh];
}

/**
 * Compute anchor (x, y) for page.drawImage(..., { rotate: degrees(rotation) })
 * such that the drawn image (drawW × drawH in pdf-lib units) is centered
 * at visual fraction (0.5, topFrac + drawFrac/2) inside the field box —
 * i.e. horizontally centered and positioned in the visual upper portion.
 *
 * Math: drawImage with rotate=R° CCW places the image so that its natural
 * bottom-left corner stays at (x,y).  After rotation the bounding center is:
 *   R=0:   (x + w/2,  y + h/2)
 *   R=90:  (x - h/2,  y + w/2)
 *   R=180: (x - w/2,  y - h/2)
 *   R=270: (x + h/2,  y - w/2)
 * We solve for (x,y) given the desired MediaBox center.
 */
function imageAnchor(
  rotation: number,
  bx: number, by: number, bw: number, bh: number,
  drawW: number, drawH: number,
  imgFrac: number   // visual fraction of box height occupied by image zone
): [number, number] {
  // Center of image zone in MediaBox coords:
  //   R=0,180: visual-top = large-y side; image zone center → y = by + bh*(1 - imgFrac/2), x center = bx + bw/2
  //   R=90:    visual-top = small-x side; image zone center → x = bx + bw*(imgFrac/2),        y center = by + bh/2
  //   R=270:   visual-top = large-x side; image zone center → x = bx + bw*(1 - imgFrac/2),    y center = by + bh/2
  switch (rotation) {
    case 90: {
      const cx = bx + bw * (imgFrac / 2);
      const cy = by + bh / 2;
      return [cx + drawH / 2, cy - drawW / 2];
    }
    case 180: {
      const cx = bx + bw / 2;
      const cy = by + bh * (1 - imgFrac / 2);
      return [cx + drawW / 2, cy + drawH / 2];
    }
    case 270: {
      const cx = bx + bw * (1 - imgFrac / 2);
      const cy = by + bh / 2;
      return [cx - drawH / 2, cy + drawW / 2];
    }
    default: { // 0
      const cx = bx + bw / 2;
      const cy = by + bh * (1 - imgFrac / 2);
      return [cx - drawW / 2, cy - drawH / 2];
    }
  }
}

/**
 * Compute {x, y, rotate} for text drawn via pdf-lib so it appears horizontal
 * to the viewer at visual position `frac` through the box (0=visual-top, 1=visual-bottom).
 *
 * Axis mapping (canvas y goes DOWN, MediaBox y goes UP):
 *   R=0:   visual-top = high MediaBox y;  text advances in +x
 *   R=90:  visual-top = low  MediaBox x;  text advances in +y; glyph height in −x
 *   R=180: visual-top = high MediaBox y (same axis as R=0); text advances in −x; glyph height in −y
 *   R=270: visual-top = high MediaBox x;  text advances in −y; glyph height in +x
 */
function labelAt(
  pageRot: number,
  bx: number, by: number, bw: number, bh: number,
  fs: number,
  frac: number,
  pad = 3
): { x: number; y: number; rotate: ReturnType<typeof degrees> } {
  const shift = fs * 0.3;
  switch (pageRot) {
    case 90:
      // visual-Y = MediaBox-X (frac=0 → bx, frac=1 → bx+bw); glyph extends in −x
      return { x: bx + bw * frac + shift, y: by + pad, rotate: degrees(90) };
    case 180:
      // visual-Y = MediaBox-Y inverted same as R=0 (frac=0 → large y, frac=1 → small y)
      // glyph extends in −y (descends from baseline) so shift baseline UP
      return { x: bx + bw - pad, y: by + bh * (1 - frac) + shift, rotate: degrees(180) };
    case 270:
      // visual-Y = MediaBox-X inverted (frac=0 → bx+bw, frac=1 → bx); glyph extends in +x
      return { x: bx + bw * (1 - frac) - shift, y: by + bh - pad, rotate: degrees(270) };
    default: // 0
      // visual-Y = MediaBox-Y (frac=0 → large y, frac=1 → small y); glyph extends in +y
      return { x: bx + pad, y: by + bh * (1 - frac) - shift, rotate: degrees(0) };
  }
}

/**
 * Return the two endpoints of the divider line at the imgFrac boundary.
 */
function dividerLine(
  pageRot: number,
  bx: number, by: number, bw: number, bh: number,
  imgFrac: number
): [number, number, number, number] {
  switch (pageRot) {
    case 90:  { const lx = bx + bw * imgFrac;           return [lx, by, lx, by + bh]; }
    case 180: { const ly = by + bh * (1 - imgFrac);     return [bx, ly, bx + bw, ly]; }
    case 270: { const lx = bx + bw * (1 - imgFrac);     return [lx, by, lx, by + bh]; }
    default:  { const ly = by + bh * (1 - imgFrac);     return [bx, ly, bx + bw, ly]; }
  }
}

export async function buildSignedPdf(
  source: string | Buffer,
  entries: FieldEntry[]
): Promise<Uint8Array> {
  const pdfBytes = Buffer.isBuffer(source) ? source : readFileSync(source);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const entry of entries) {
    if (!entry.fieldValue) continue;

    const pageIdx = entry.page - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) continue;
    const page = pages[pageIdx];
    const { width: pw, height: ph } = page.getSize();
    const rotation = page.getRotation().angle; // 0 | 90 | 180 | 270

    const { x: bx, y: by, w: bw, h: bh } = toDrawCoords(
      entry.x, entry.y, entry.width, entry.height,
      pw, ph, rotation
    );

    if (entry.fieldType === "signature" || entry.fieldType === "initials") {
      const match = entry.fieldValue.match(/^data:image\/png;base64,(.+)$/);
      if (!match) continue;

      let pngImage;
      try {
        pngImage = await pdfDoc.embedPng(Buffer.from(match[1], "base64"));
      } catch {
        continue;
      }

      // Display dimensions: for R=90/270 the viewer swaps x/y axes
      const [dispW, dispH] = displaySize(rotation, bw, bh);

      // Image occupies visual top 65%; labels get the lower 35%
      const imgFrac = 0.65;

      // DocuSign-style sizing: ~70% of field width, ~60% of field height
      // Use display dimensions so the formula is correct for all page rotations
      const scale = Math.min(
        (dispW * 0.70) / pngImage.width,
        (dispH * 0.60) / pngImage.height
      );
      const drawW = Math.max(1, pngImage.width * scale);
      const drawH = Math.max(1, pngImage.height * scale);

      const [imgX, imgY] = imageAnchor(rotation, bx, by, bw, bh, drawW, drawH, imgFrac);
      page.drawImage(pngImage, {
        x: imgX, y: imgY,
        width: drawW, height: drawH,
        rotate: degrees(rotation),
      });

      // Thin grey divider between image and label strip
      const [x1, y1, x2, y2] = dividerLine(rotation, bx, by, bw, bh, imgFrac);
      page.drawLine({
        start: { x: x1, y: y1 }, end: { x: x2, y: y2 },
        thickness: 0.5, color: rgb(0.75, 0.75, 0.75),
      });

      // Signer name at visual 72%
      const nameFs = Math.max(4.5, Math.min(6.5, Math.min(dispW, dispH) * 0.14));
      const nameOpts = labelAt(rotation, bx, by, bw, bh, nameFs, 0.72, 3);
      page.drawText(entry.signerName, {
        x: nameOpts.x, y: nameOpts.y, size: nameFs,
        rotate: nameOpts.rotate, font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
      });

      // Signed date at visual 88%
      const dateFs = Math.max(4, Math.min(5.5, Math.min(dispW, dispH) * 0.11));
      const dateOpts = labelAt(rotation, bx, by, bw, bh, dateFs, 0.88, 3);
      page.drawText(`Signed: ${fmtDate(entry.signedAt)}`, {
        x: dateOpts.x, y: dateOpts.y, size: dateFs,
        rotate: dateOpts.rotate, font,
        color: rgb(0.38, 0.38, 0.38),
      });

    } else {
      // Date or text field — draw the value text, rotation-corrected and centered
      const value = entry.fieldType === "date" && !entry.fieldValue
        ? fmtDate(entry.signedAt)
        : entry.fieldValue;

      const [dispW, dispH] = displaySize(rotation, bw, bh);
      const fs = Math.max(7, Math.min(11, Math.min(dispW, dispH) * 0.45));
      const opts = labelAt(rotation, bx, by, bw, bh, fs, 0.5, 4);
      page.drawText(value, {
        x: opts.x, y: opts.y, size: fs,
        rotate: opts.rotate, font: fontBold,
        color: rgb(0.08, 0.08, 0.35),
      });
    }
  }

  return pdfDoc.save();
}
