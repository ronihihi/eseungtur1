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
 *
 * pdfjs renders a page with Rotate=R by producing a canvas whose axes map to the
 * un-rotated MediaBox as follows:
 *
 *   R=0:   canvas_x = pdf_x,       canvas_y = ph - pdf_y    (standard y-flip)
 *   R=90:  canvas_x = pdf_y,       canvas_y = pdf_x         (canvas W=ph, H=pw)
 *   R=180: canvas_x = pw - pdf_x,  canvas_y = ph - pdf_y    (both flipped)
 *   R=270: canvas_x = ph - pdf_y,  canvas_y = pw - pdf_x    (canvas W=ph, H=pw)
 *
 * Inverting each mapping gives the pdf-lib (bottom-left) position of the
 * bottom-left corner of the field box.
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
 * Compute (x, y, rotate) for text drawn via pdf-lib so that it appears horizontal
 * to the viewer at visual position `frac` through the box (0 = visual top, 1 = visual bottom).
 *
 * When a page has Rotate=R, pdf-lib draws in the un-rotated MediaBox coordinate space
 * and the viewer then rotates everything R° CW. Passing `rotate: degrees(R)` to
 * drawText pre-rotates the text so it cancels out the page rotation and appears upright.
 * The anchor (x, y) is adjusted so the glyph body lands in the correct strip.
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
      // visual-Y = MediaBox-X axis (frac=0 → small x, frac=1 → large x)
      // text advances in +y; glyph height extends in −x direction
      return { x: bx + bw * frac + shift, y: by + pad, rotate: degrees(90) };
    case 180:
      // visual-Y = MediaBox-Y axis inverted (frac=0 → small y, frac=1 → large y)
      // text advances in −x; glyph height extends in −y direction
      return { x: bx + bw - pad, y: by + bh * frac + shift, rotate: degrees(180) };
    case 270:
      // visual-Y = MediaBox-X axis inverted (frac=0 → large x, frac=1 → small x)
      // text advances in −y; glyph height extends in +x direction
      return { x: bx + bw * (1 - frac) - shift, y: by + bh - pad, rotate: degrees(270) };
    default: // 0
      // visual-Y = MediaBox-Y axis (frac=0 → large y = top, frac=1 → small y = bottom)
      // text advances in +x; glyph height extends in +y direction
      return { x: bx + pad, y: by + bh * (1 - frac) - shift, rotate: degrees(0) };
  }
}

/**
 * Return the sub-box (in MediaBox coords) for the "visual top imgFrac of the field box".
 * Used to confine the signature image to the upper portion, leaving room for labels.
 */
function imageSubBox(
  pageRot: number,
  bx: number, by: number, bw: number, bh: number,
  imgFrac: number
): [number, number, number, number] {
  switch (pageRot) {
    case 90:  return [bx,                   by, bw * imgFrac,       bh];
    case 180: return [bx,                   by, bw,                 bh * imgFrac];
    case 270: return [bx + bw * (1 - imgFrac), by, bw * imgFrac,   bh];
    default:  return [bx, by + bh * (1 - imgFrac), bw,             bh * imgFrac];
  }
}

/**
 * Return the two endpoints of the divider line between the image strip and label strip.
 */
function dividerLine(
  pageRot: number,
  bx: number, by: number, bw: number, bh: number,
  imgFrac: number
): [number, number, number, number] {
  switch (pageRot) {
    case 90:  { const lx = bx + bw * imgFrac; return [lx, by, lx, by + bh]; }
    case 180: { const ly = by + bh * imgFrac; return [bx, ly, bx + bw, ly]; }
    case 270: { const lx = bx + bw * (1 - imgFrac); return [lx, by, lx, by + bh]; }
    default:  { const ly = by + bh * (1 - imgFrac); return [bx, ly, bx + bw, ly]; }
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

      // Signature image occupies the visual top 62% of the field box
      const imgFrac = 0.62;
      const [ix, iy, iw, ih] = imageSubBox(rotation, bx, by, bw, bh, imgFrac);
      const sigPad = 3;
      const scale = Math.min((iw - sigPad * 2) / pngImage.width, (ih - sigPad * 2) / pngImage.height);
      const sigW = pngImage.width * scale;
      const sigH = pngImage.height * scale;
      page.drawImage(pngImage, {
        x: ix + (iw - sigW) / 2,
        y: iy + (ih - sigH) / 2,
        width: sigW,
        height: sigH,
      });

      // Thin divider between image and label area
      const [x1, y1, x2, y2] = dividerLine(rotation, bx, by, bw, bh, imgFrac);
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: rgb(0.75, 0.75, 0.75) });

      // Signer name — at visual 75% (inside lower 38% strip)
      const nameFs = Math.max(4.5, Math.min(6.5, Math.min(bw, bh) * 0.14));
      const nameOpts = labelAt(rotation, bx, by, bw, bh, nameFs, 0.72, 3);
      page.drawText(entry.signerName, {
        x: nameOpts.x, y: nameOpts.y, size: nameFs,
        rotate: nameOpts.rotate, font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
      });

      // Signed date — at visual 90%
      const dateFs = Math.max(4, Math.min(5.5, Math.min(bw, bh) * 0.11));
      const dateOpts = labelAt(rotation, bx, by, bw, bh, dateFs, 0.89, 3);
      page.drawText(`Signed: ${fmtDate(entry.signedAt)}`, {
        x: dateOpts.x, y: dateOpts.y, size: dateFs,
        rotate: dateOpts.rotate, font,
        color: rgb(0.38, 0.38, 0.38),
      });

    } else {
      // Date or text field — draw value text, rotation-corrected and centered in the box
      const value = entry.fieldType === "date" && !entry.fieldValue
        ? fmtDate(entry.signedAt)
        : entry.fieldValue;

      const fs = Math.max(7, Math.min(11, Math.min(bw, bh) * 0.45));
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
