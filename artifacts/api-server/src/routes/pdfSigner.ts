import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
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
 *
 * Returns { x, y, w, h } in pdf-lib units (bottom-left origin, un-rotated MediaBox).
 */
function toDrawCoords(
  fx: number, fy: number, fw: number, fh: number, // fractional, display canvas space
  pw: number, ph: number,                          // un-rotated MediaBox size (pdf-lib)
  rotation: number                                 // 0 | 90 | 180 | 270 (CW degrees)
): { x: number; y: number; w: number; h: number } {
  switch (rotation) {
    case 90:
      // Canvas W=ph, H=pw.  canvas_x=pdf_y, canvas_y=pdf_x
      // Field canvas: left=fx*ph, top=fy*pw, w=fw*ph, h=fh*pw
      // PDF x = canvas_y → [fy*pw … (fy+fh)*pw];  bottom-left x = fy*pw
      // PDF y = canvas_x → [fx*ph … (fx+fw)*ph];  bottom-left y = fx*ph
      return {
        x: fy * pw,
        y: fx * ph,
        w: fh * pw,
        h: fw * ph,
      };

    case 180:
      // Canvas W=pw, H=ph.  canvas_x=pw-pdf_x, canvas_y=ph-pdf_y
      // PDF x = pw - canvas_x → pw - (fx+fw)*pw … pw-fx*pw; bottom-left x = pw*(1-fx-fw)
      // PDF y = ph - canvas_y → ph - (fy+fh)*ph … ph-fy*ph; bottom-left y = ph*(1-fy-fh)
      return {
        x: pw * (1 - fx - fw),
        y: ph * (1 - fy - fh),
        w: fw * pw,
        h: fh * ph,
      };

    case 270:
      // Canvas W=ph, H=pw.  canvas_x=ph-pdf_y, canvas_y=pw-pdf_x
      // PDF x = pw - canvas_y → [pw-(fy+fh)*pw … pw-fy*pw]; bottom-left x = pw*(1-fy-fh)
      // PDF y = ph - canvas_x → [ph-(fx+fw)*ph … ph-fx*ph]; bottom-left y = ph*(1-fx-fw)
      return {
        x: pw * (1 - fy - fh),
        y: ph * (1 - fx - fw),
        w: fh * pw,
        h: fw * ph,
      };

    default: // 0° — standard: canvas_x=pdf_x, canvas_y=ph-pdf_y
      return {
        x: fx * pw,
        y: ph * (1 - fy - fh),
        w: fw * pw,
        h: fh * ph,
      };
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

      // Scale signature image to fit inside the field box with a small pad
      const sigPad = 4;
      const scale = Math.min((bw - sigPad * 2) / pngImage.width, (bh - sigPad * 2) / pngImage.height);
      const sigW = pngImage.width * scale;
      const sigH = pngImage.height * scale;
      page.drawImage(pngImage, {
        x: bx + (bw - sigW) / 2,
        y: by + (bh - sigH) / 2,
        width: sigW,
        height: sigH,
      });

      // Name + date printed just below the field box
      const fs = Math.max(5.5, Math.min(7.5, bw / 18));
      const lineH = fs + 2;
      const nameY = by - lineH;
      const dateY = by - lineH * 2;
      if (nameY > 4) {
        page.drawText(entry.signerName, { x: bx, y: nameY, size: fs, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
      }
      if (dateY > 4) {
        page.drawText(`Signed: ${fmtDate(entry.signedAt)}`, { x: bx, y: dateY, size: fs, font, color: rgb(0.38, 0.38, 0.38) });
      }
    } else {
      // Date or text field — transparent background, just draw the value text
      const value = entry.fieldType === "date" && !entry.fieldValue
        ? fmtDate(entry.signedAt)
        : entry.fieldValue;

      const fs = Math.max(7, Math.min(11, bh * 0.55));
      const textY = by + (bh - fs) / 2;
      page.drawText(value, {
        x: bx + 4, y: textY, size: fs, font: fontBold,
        color: rgb(0.08, 0.08, 0.35),
        maxWidth: bw - 8,
      });
    }
  }

  return pdfDoc.save();
}
