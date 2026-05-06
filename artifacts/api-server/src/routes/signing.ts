import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, documentsTable, recipientsTable, signatureFieldsTable } from "@workspace/db";
import fs from "fs";
import path from "path";
import { SubmitSignatureBody } from "@workspace/api-zod";
import type { Request, Response } from "express";
import { sendSigningEmail } from "./emailService.js";

const router: IRouter = Router();

router.get("/sign/:token", async (req: Request, res: Response) => {
  const token = req.params.token as string;
  try {
    const recs = await db
      .select()
      .from(recipientsTable)
      .where(eq(recipientsTable.token, token))
      .limit(1);

    if (recs.length === 0) {
      res.status(404).json({ error: "Invalid or expired signing link" });
      return;
    }

    const r = recs[0];
    const docs = await db.select().from(documentsTable).where(eq(documentsTable.id, r.documentId)).limit(1);
    const doc = docs[0];

    if (r.status !== "signed") {
      await db
        .update(recipientsTable)
        .set({ status: "viewed", viewedAt: new Date() })
        .where(eq(recipientsTable.token, token));
    }

    const fields = await db
      .select()
      .from(signatureFieldsTable)
      .where(eq(signatureFieldsTable.recipientId, r.id));

    res.json({
      recipient: r,
      documentTitle: doc?.title ?? "Unknown Document",
      documentFilename: doc?.filename ?? "",
      alreadySigned: r.status === "signed",
      fields,
    });
  } catch (err) {
    req.log.error({ err }, "get signing info error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/sign/:token", async (req: Request, res: Response) => {
  const token = req.params.token as string;
  try {
    const parsed = SubmitSignatureBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Full name and signature are required" });
      return;
    }

    const { fullName, signatureData } = parsed.data;

    const recs = await db
      .select()
      .from(recipientsTable)
      .where(eq(recipientsTable.token, token))
      .limit(1);

    if (recs.length === 0) {
      res.status(404).json({ error: "Invalid signing link" });
      return;
    }

    const r = recs[0];

    if (r.status === "signed") {
      res.status(400).json({ error: "Already signed" });
      return;
    }

    const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "";

    await db
      .update(recipientsTable)
      .set({
        status: "signed",
        signedAt: new Date(),
        signerName: fullName,
        ipAddress: ip,
        signatureData,
      })
      .where(eq(recipientsTable.token, token));

    const docs = await db.select().from(documentsTable).where(eq(documentsTable.id, r.documentId)).limit(1);
    const doc = docs[0];

    if (doc?.signingOrder === "sequential") {
      const allRecipients = await db
        .select()
        .from(recipientsTable)
        .where(eq(recipientsTable.documentId, r.documentId));

      allRecipients.sort((a, b) => a.signOrder - b.signOrder);
      const next = allRecipients.find((x) => x.signOrder === r.signOrder + 1 && x.status === "pending");

      if (next) {
        const host = req.get("host") || "localhost";
        const protocol = req.protocol || "https";
        const baseUrl = process.env.APP_URL || `${protocol}://${host}`;
        await sendSigningEmail(next, doc, `${baseUrl}/sign/${next.token}`, null, null, "E-Sign Workflow");
      }
    }

    const allRecipients = await db
      .select()
      .from(recipientsTable)
      .where(eq(recipientsTable.documentId, r.documentId));

    if (allRecipients.every((x) => x.status === "signed")) {
      await db
        .update(documentsTable)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(documentsTable.id, r.documentId));
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "submit signature error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/sign/:token/file", async (req: Request, res: Response) => {
  const token = req.params.token as string;
  try {
    const recs = await db
      .select()
      .from(recipientsTable)
      .where(eq(recipientsTable.token, token))
      .limit(1);

    if (recs.length === 0) {
      res.status(404).json({ error: "Invalid signing link" });
      return;
    }

    const doc = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, recs[0].documentId))
      .limit(1);

    if (!doc[0] || !fs.existsSync(doc[0].filepath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const ext = path.extname(doc[0].filepath).toLowerCase();
    const contentType = ext === ".pdf" ? "application/pdf" : "application/octet-stream";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=300");
    res.sendFile(path.resolve(doc[0].filepath));
  } catch (err) {
    req.log.error({ err }, "serve sign file error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
