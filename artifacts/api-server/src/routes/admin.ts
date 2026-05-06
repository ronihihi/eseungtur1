import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { eq, desc } from "drizzle-orm";
import { db, usersTable, documentsTable, recipientsTable } from "@workspace/db";
import type { Request, Response } from "express";

const router: IRouter = Router();

function requireAdmin(req: Request, res: Response, next: () => void) {
  if (!req.session.userId || req.session.userRole !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

router.get("/admin/users", requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        provider: usersTable.provider,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .orderBy(usersTable.createdAt);
    res.json({ users });
  } catch (err) {
    req.log.error({ err }, "list users error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/users", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body as { name?: string; email?: string; password?: string; role?: string };
    if (!name || !email || !password) {
      res.status(400).json({ error: "name, email and password are required" });
      return;
    }
    const normalizedEmail = email.toLowerCase();
    const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "Email already in use" });
      return;
    }
    const hashed = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await db.insert(usersTable).values({
      id,
      name,
      email: normalizedEmail,
      password: hashed,
      role: role === "admin" ? "admin" : "user",
      provider: "local",
    });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "create user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (id === req.session.userId) {
    res.status(400).json({ error: "You cannot delete your own account" });
    return;
  }
  try {
    await db.delete(usersTable).where(eq(usersTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "delete user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/users/:id/role", requireAdmin, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { role } = req.body as { role?: string };
  if (role !== "admin" && role !== "user") {
    res.status(400).json({ error: "role must be 'admin' or 'user'" });
    return;
  }
  if (id === req.session.userId && role !== "admin") {
    res.status(400).json({ error: "You cannot remove your own admin role" });
    return;
  }
  try {
    await db.update(usersTable).set({ role }).where(eq(usersTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "update role error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/audit", requireAdmin, async (req: Request, res: Response) => {
  try {
    const documents = await db
      .select({
        id: documentsTable.id,
        title: documentsTable.title,
        uploaderName: documentsTable.uploaderName,
        status: documentsTable.status,
        createdAt: documentsTable.createdAt,
        completedAt: documentsTable.completedAt,
      })
      .from(documentsTable)
      .orderBy(desc(documentsTable.createdAt))
      .limit(500);

    const recipients = await db
      .select({
        id: recipientsTable.id,
        documentId: recipientsTable.documentId,
        teamName: recipientsTable.teamName,
        email: recipientsTable.email,
        signerName: recipientsTable.signerName,
        ipAddress: recipientsTable.ipAddress,
        viewedAt: recipientsTable.viewedAt,
        signedAt: recipientsTable.signedAt,
      })
      .from(recipientsTable);

    const docTitleMap = new Map(documents.map(d => [d.id, d.title]));

    type AuditEvent = {
      id: string;
      type: string;
      documentId: string;
      documentTitle: string;
      actorName: string | null;
      actorEmail: string | null;
      ipAddress: string | null;
      timestamp: string;
    };

    const events: AuditEvent[] = [];

    for (const doc of documents) {
      events.push({
        id: `upload-${doc.id}`,
        type: "uploaded",
        documentId: doc.id,
        documentTitle: doc.title,
        actorName: doc.uploaderName,
        actorEmail: null,
        ipAddress: null,
        timestamp: doc.createdAt.toISOString(),
      });

      if (doc.status === "sent" || doc.status === "completed") {
        events.push({
          id: `sent-${doc.id}`,
          type: "sent",
          documentId: doc.id,
          documentTitle: doc.title,
          actorName: doc.uploaderName,
          actorEmail: null,
          ipAddress: null,
          // sent happens between upload and first view; use upload time as approximation
          // but mark it distinctly so it doesn't collide
          timestamp: doc.createdAt.toISOString(),
        });
      }

      if (doc.completedAt) {
        events.push({
          id: `complete-${doc.id}`,
          type: "completed",
          documentId: doc.id,
          documentTitle: doc.title,
          actorName: null,
          actorEmail: null,
          ipAddress: null,
          timestamp: doc.completedAt.toISOString(),
        });
      }
    }

    for (const r of recipients) {
      const docTitle = docTitleMap.get(r.documentId) ?? "Unknown Document";
      if (r.viewedAt) {
        events.push({
          id: `view-${r.id}`,
          type: "viewed",
          documentId: r.documentId,
          documentTitle: docTitle,
          actorName: r.teamName,
          actorEmail: r.email,
          ipAddress: null,
          timestamp: r.viewedAt.toISOString(),
        });
      }
      if (r.signedAt) {
        events.push({
          id: `sign-${r.id}`,
          type: "signed",
          documentId: r.documentId,
          documentTitle: docTitle,
          actorName: r.signerName ?? r.teamName,
          actorEmail: r.email,
          ipAddress: r.ipAddress ?? null,
          timestamp: r.signedAt.toISOString(),
        });
      }
    }

    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({ events: events.slice(0, 1000) });
  } catch (err) {
    req.log.error({ err }, "audit log error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
