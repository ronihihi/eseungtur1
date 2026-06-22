import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const documentEventsTable = pgTable("document_events", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  recipientId: text("recipient_id"),
  eventType: text("event_type").notNull(),
  actorName: text("actor_name"),
  actorEmail: text("actor_email"),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DocumentEvent = typeof documentEventsTable.$inferSelect;
