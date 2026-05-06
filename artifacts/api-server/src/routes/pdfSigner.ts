import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { readFileSync } from "fs";

export interface SignatureEntry {
  signatureData: string;
  signerName: string;
  signedAt: Date;
  field: { page: number; x: number; y: number; width: number; height: number } | null;
}

function fmtDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export async function buildSignedPdf(filepath: string, entries: SignatureEntry[]): Promise<Uint8Array> {
  const pdfBytes = readFileSync(filepath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const entry of entries) {
    if (!entry.signatureData) continue;

    const match = entry.signatureData.match(/^data:image\/png;base64,(.+)$/);
    if (!match) continue;

    let pngImage;
    try {
      pngImage = await pdfDoc.embedPng(Buffer.from(match[1], "base64"));
    } catch {
      continue;
    }

    const dateLabel = `Signed: ${fmtDate(entry.signedAt)}`;

    if (entry.field) {
      const pageIdx = entry.field.page - 1;
      if (pageIdx < 0 || pageIdx >= pages.length) continue;
      const page = pages[pageIdx];
      const { width: pw, height: ph } = page.getSize();

      // Convert fractional coords (top-left origin) → pdf-lib coords (bottom-left origin)
      const fx = entry.field.x * pw;
      const fw = entry.field.width * pw;
      const fh = entry.field.height * ph;
      const fy = ph - entry.field.y * ph - fh;

      // Green border around the signature field
      page.drawRectangle({
        x: fx,
        y: fy,
        width: fw,
        height: fh,
        borderColor: rgb(0.08, 0.65, 0.33),
        borderWidth: 1,
        opacity: 0,
      });

      // Signature image centred and scaled within the field (leave 4px padding)
      const sigPad = 4;
      const scale = Math.min((fw - sigPad * 2) / pngImage.width, (fh - sigPad * 2) / pngImage.height);
      const sigW = pngImage.width * scale;
      const sigH = pngImage.height * scale;
      page.drawImage(pngImage, {
        x: fx + (fw - sigW) / 2,
        y: fy + (fh - sigH) / 2,
        width: sigW,
        height: sigH,
      });

      // Signer name + date printed just below the field box
      const fs = Math.max(5.5, Math.min(7.5, fw / 18));
      const lineH = fs + 2;
      const nameY = fy - lineH;
      const dateY = fy - lineH * 2;

      if (nameY > 4) {
        page.drawText(entry.signerName, {
          x: fx,
          y: nameY,
          size: fs,
          font: fontBold,
          color: rgb(0.1, 0.1, 0.1),
        });
      }
      if (dateY > 4) {
        page.drawText(dateLabel, {
          x: fx,
          y: dateY,
          size: fs,
          font,
          color: rgb(0.38, 0.38, 0.38),
        });
      }
    } else {
      // No field placed — skip; signature only appears at the placed field position
      continue;
    }
  }

  return pdfDoc.save();
}
