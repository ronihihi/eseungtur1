import { useLogout, useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { LogOut, FileSignature, LayoutDashboard, Plus, PenLine, Users, ClipboardList, ChevronDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SavedSignatureDialog } from "@/components/saved-signature-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface LayoutProps {
  children: React.ReactNode;
}

function NavLink({ href, icon: Icon, label, active }: { href: string; icon: React.ElementType; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-full transition-all ${
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { data: me } = useGetMe();
  const logoutMutation = useLogout();
  const queryClient = useQueryClient();

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      },
    });
  };

  const initials = me?.user?.name
    ? me.user.name.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2)
    : "U";

  const isAdmin = me?.user?.role === "admin";
  const canSeeAudit = me?.user?.role === "admin" || me?.user?.role === "auditor";

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="sticky top-0 z-30 w-full border-b bg-card/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center shrink-0">
            <div className="rounded-lg bg-[#1c325d] px-3 py-1.5">
              <img src="/sos-logo.png" alt="SOS Children's Villages Palestine" className="h-7 w-auto object-contain" />
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <NavLink href="/" icon={LayoutDashboard} label="Dashboard" active={location === "/"} />
            <NavLink href="/documents/upload" icon={Plus} label="New Document" active={location === "/documents/upload"} />
            {isAdmin && (
              <NavLink href="/admin/users" icon={Users} label="Users" active={location === "/admin/users"} />
            )}
            {canSeeAudit && (
              <NavLink href="/admin/audit" icon={ClipboardList} label="Audit Log" active={location === "/admin/audit"} />
            )}
          </nav>

          <div className="flex items-center gap-2 ml-auto">
            <SavedSignatureDialog>
              <Button variant="ghost" size="sm" className="hidden sm:flex gap-1.5 text-muted-foreground hover:text-foreground" title="My saved signature">
                <PenLine className="h-4 w-4" />
                <span className="text-xs font-medium">Signature</span>
              </Button>
            </SavedSignatureDialog>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:inline text-sm font-medium text-foreground max-w-28 truncate">{me?.user?.name}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <div className="px-2 py-1.5">
                  <p className="text-xs font-medium text-foreground truncate">{me?.user?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{me?.user?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive gap-2">
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
