import { Router, type IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import { db, documentsTable, recipientsTable, signatureFieldsTable } from "@workspace/db";
import { SetRecipientsBody } from "@workspace/api-zod";
import type { Request, Response } from "express";
import { sendSigningEmail } from "./emailService.js";
import { getAppBaseUrl } from "../lib/appUrl.js";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: () => void) {
  if (!req.session.userId) {
    res.status(401).json({ error: "Please log in first" });
    return;
  }
  next();
}

router.post("/documents/:id/recipients", requireAuth, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const parsed = SetRecipientsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid recipients data" });
      return;
    }

    const docs = await db
      .select()
      .from(documentsTable)
      .where(and(eq(documentsTable.id, id), eq(documentsTable.uploadedBy, req.session.userId!)))
      .limit(1);

    if (docs.length === 0) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const existing = await db
      .select()
      .from(recipientsTable)
      .where(eq(recipientsTable.documentId, id));
    existing.sort((a, b) => a.signOrder - b.signOrder);

    const newList = parsed.data.recipients;

    // Update existing recipients in place (preserves IDs → field references stay valid)
    for (let i = 0; i < newList.length; i++) {
      const r = newList[i];
      const existingRec = existing[i];
      if (existingRec) {
        await db
          .update(recipientsTable)
          .set({ teamName: r.teamName, email: r.email, signOrder: i + 1 })
          .where(eq(recipientsTable.id, existingRec.id));
      } else {
        await db.insert(recipientsTable).values({
          id: uuidv4(),
          documentId: id,
          teamName: r.teamName,
          email: r.email,
          signOrder: i + 1,
          status: "pending",
          token: uuidv4(),
        });
      }
    }

    // Remove recipients that were dropped from the list, along with their fields
    if (existing.length > newList.length) {
      for (const removed of existing.slice(newList.length)) {
        await db.delete(signatureFieldsTable).where(eq(signatureFieldsTable.recipientId, removed.id));
        await db.delete(recipientsTable).where(eq(recipientsTable.id, removed.id));
      }
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "set recipients error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/documents/:id/send", requireAuth, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const { subject, message } = req.body as { subject?: string; message?: string };

    const docs = await db
      .select()
      .from(documentsTable)
      .where(and(eq(documentsTable.id, id), eq(documentsTable.uploadedBy, req.session.userId!)))
      .limit(1);

    if (docs.length === 0) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const doc = docs[0];
    const recipients = await db.select().from(recipientsTable).where(eq(recipientsTable.documentId, id));
    recipients.sort((a, b) => a.signOrder - b.signOrder);

    if (recipients.length === 0) {
      res.status(400).json({ error: "No recipients added" });
      return;
    }

    const baseUrl = getAppBaseUrl(req);

    const toSend = doc.signingOrder === "sequential" ? [recipients[0]] : recipients;

    for (const r of toSend) {
      await sendSigningEmail(r, doc, `${baseUrl}/sign/${r.token}`, subject, message, req.session.userName);
    }

    await db.update(documentsTable).set({ status: "sent" }).where(eq(documentsTable.id, id));

    res.json({ success: true, sent: toSend.length });
  } catch (err) {
    req.log.error({ err }, "send document error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/recipients/:recipientId/remind", requireAuth, async (req: Request, res: Response) => {
  const recipientId = req.params.recipientId as string;
  try {
    const recs = await db
      .select()
      .from(recipientsTable)
      .where(eq(recipientsTable.id, recipientId))
      .limit(1);

    if (recs.length === 0) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }

    const r = recs[0];
    if (r.status === "signed") {
      res.status(400).json({ error: "Recipient has already signed" });
      return;
    }

    const docs = await db
      .select()
      .from(documentsTable)
      .where(and(eq(documentsTable.id, r.documentId), eq(documentsTable.uploadedBy, req.session.userId!)))
      .limit(1);
    if (docs.length === 0) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const doc = docs[0];

    const baseUrl = getAppBaseUrl(req);

    await sendSigningEmail(
      r,
      doc,
      `${baseUrl}/sign/${r.token}`,
      `Reminder: Please sign "${doc.title}"`,
      "This is a reminder that your signature is required on this document.",
      req.session.userName
    );

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "remind recipient error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
