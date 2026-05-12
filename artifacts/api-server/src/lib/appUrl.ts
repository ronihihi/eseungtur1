import type { Request } from "express";

export function getAppBaseUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const primary = replitDomains.split(",")[0].trim();
    return `https://${primary}`;
  }
  const protocol = req.protocol || "https";
  const host = req.get("host") || "localhost";
  return `${protocol}://${host}`;
}
