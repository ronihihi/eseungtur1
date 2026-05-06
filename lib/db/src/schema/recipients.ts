import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const recipientsTable = pgTable("recipients", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  teamName: text("team_name").notNull(),
  email: text("email").notNull(),
  signOrder: integer("sign_order").notNull(),
  status: text("status").notNull().default("pending"),
  token: text("token").notNull().unique(),
  signerName: text("signer_name"),
  ipAddress: text("ip_address"),
  signatureData: text("signature_data"),
  viewedAt: timestamp("viewed_at"),
  signedAt: timestamp("signed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRecipientSchema = createInsertSchema(recipientsTable).omit({
  createdAt: true,
  viewedAt: true,
  signedAt: true,
  signerName: true,
  ipAddress: true,
  signatureData: true,
});
export type InsertRecipient = z.infer<typeof insertRecipientSchema>;
export type Recipient = typeof recipientsTable.$inferSelect;
