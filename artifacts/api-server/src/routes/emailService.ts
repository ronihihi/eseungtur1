import nodemailer from "nodemailer";
import { logger } from "../lib/logger.js";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
});

export async function sendSigningEmail(
  recipient: { teamName: string; email: string },
  doc: { title: string },
  signUrl: string,
  subject?: string | null,
  message?: string | null,
  senderName?: string | null
): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.warn({ recipientEmail: recipient.email, signUrl }, "SMTP not configured — skipping email send");
    return;
  }

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
    <div style="background:#f8f9fa;border-radius:8px;padding:30px;margin-bottom:20px">
      <h2 style="color:#1a1a2e;margin-top:0">Document Signature Required</h2>
      <p style="color:#555;line-height:1.6">${message || "Please review and sign the document below."}</p>
      <div style="background:white;border:1px solid #e0e0e0;border-radius:6px;padding:16px;margin:20px 0">
        <p style="margin:0;font-size:14px;color:#888">Document</p>
        <p style="margin:4px 0 0;font-weight:bold;font-size:16px">${doc.title}</p>
      </div>
      <a href="${signUrl}" style="display:inline-block;background:#1a1a2e;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px;margin-top:10px">Review &amp; Sign Document &rarr;</a>
    </div>
    <p style="font-size:12px;color:#999;text-align:center">Sent by ${senderName || "E-Sign Workflow"}<br>This link is unique to you — do not share it.</p>
    </body></html>`;

  await transporter.sendMail({
    from: `"E-Sign Workflow" <${process.env.SMTP_USER}>`,
    to: `${recipient.teamName} <${recipient.email}>`,
    subject: subject || `Action Required: Please sign "${doc.title}"`,
    html,
  });
}
