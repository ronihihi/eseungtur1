import { useState } from "react";
import { Link } from "wouter";
import { useGetAdminAuditLog } from "@workspace/api-client-react";
import type { AuditEvent } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ClipboardList, Search, Upload, Send, Eye, PenLine, CheckCircle2, ExternalLink } from "lucide-react";

const EVENT_LABELS: Record<string, string> = {
  uploaded: "Uploaded",
  sent: "Sent for signing",
  viewed: "Viewed",
  signed: "Signed",
  completed: "Completed",
};

const EVENT_ICONS: Record<string, React.ReactNode> = {
  uploaded: <Upload className="h-3.5 w-3.5" />,
  sent: <Send className="h-3.5 w-3.5" />,
  viewed: <Eye className="h-3.5 w-3.5" />,
  signed: <PenLine className="h-3.5 w-3.5" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5" />,
};

const EVENT_COLORS: Record<string, string> = {
  uploaded: "bg-blue-50 text-blue-700 border-blue-200",
  sent: "bg-purple-50 text-purple-700 border-purple-200",
  viewed: "bg-amber-50 text-amber-700 border-amber-200",
  signed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  completed: "bg-green-50 text-green-700 border-green-200",
};

function EventBadge({ type }: { type: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${EVENT_COLORS[type] ?? "bg-muted text-muted-foreground border-border"}`}
    >
      {EVENT_ICONS[type]}
      {EVENT_LABELS[type] ?? type}
    </span>
  );
}

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let relative: string;
  if (diffMins < 1) relative = "just now";
  else if (diffMins < 60) relative = `${diffMins}m ago`;
  else if (diffHours < 24) relative = `${diffHours}h ago`;
  else if (diffDays < 7) relative = `${diffDays}d ago`;
  else relative = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  const absolute = date.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return { relative, absolute };
}

function AuditRow({ event }: { event: AuditEvent }) {
  const { relative, absolute } = formatTimestamp(event.timestamp);

  return (
    <div className="flex items-start gap-4 px-4 py-3 hover:bg-muted/30 transition-colors border-b last:border-0">
      <div className="w-36 shrink-0 pt-0.5">
        <EventBadge type={event.type} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground truncate">
          <Link
            href={`/documents/${event.documentId}`}
            className="hover:text-primary hover:underline truncate flex items-center gap-1"
          >
            {event.documentTitle}
            <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
          </Link>
        </div>
        {event.actorName && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {event.actorName}
            {event.actorEmail && (
              <span className="text-muted-foreground/70"> · {event.actorEmail}</span>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 text-right">
        {event.ipAddress && (
          <div className="text-xs font-mono text-muted-foreground mb-0.5">{event.ipAddress}</div>
        )}
        <time
          className="text-xs text-muted-foreground"
          title={absolute}
        >
          {relative}
        </time>
      </div>
    </div>
  );
}

export function AdminAuditPage() {
  const { data, isLoading, refetch } = useGetAdminAuditLog();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const events = data?.events ?? [];

  const filtered = events.filter(e => {
    const matchesType = typeFilter === "all" || e.type === typeFilter;
    const term = search.toLowerCase();
    const matchesSearch =
      !term ||
      e.documentTitle.toLowerCase().includes(term) ||
      (e.actorName ?? "").toLowerCase().includes(term) ||
      (e.actorEmail ?? "").toLowerCase().includes(term) ||
      (e.ipAddress ?? "").includes(term);
    return matchesType && matchesSearch;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" />
            Audit Log
          </h1>
          <p className="text-muted-foreground mt-1">
            All document and signing activity across your organisation
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Refresh
        </Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search document, person, or IP…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All events" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            <SelectItem value="uploaded">Uploaded</SelectItem>
            <SelectItem value="sent">Sent for signing</SelectItem>
            <SelectItem value="viewed">Viewed</SelectItem>
            <SelectItem value="signed">Signed</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            {isLoading ? "Loading…" : `${filtered.length} event${filtered.length !== 1 ? "s" : ""}`}
          </CardTitle>
          <CardDescription>
            Most recent activity first · up to 1 000 events stored
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-muted-foreground">Loading audit log…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              {events.length === 0 ? "No activity yet." : "No events match your filter."}
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              {filtered.map(event => (
                <AuditRow key={event.id} event={event} />
              ))}
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
