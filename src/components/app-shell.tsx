import vybeLogo from "@/assets/vybe-logo.png.asset.json";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  Contact,
  Package,
  FileText,
  FolderKanban,
  CalendarDays,
  Receipt,
  Wallet,
  BarChart3,
  Settings as SettingsIcon,
  Bell,
  Workflow,
  LogOut,
  UserCog,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/customers", label: "Customers", icon: Contact },
  { to: "/packages", label: "Packages", icon: Package },
  { to: "/quotations", label: "Quotations", icon: FileText },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/tracker", label: "Workflow Tracker", icon: ListChecks },
  { to: "/workflows", label: "Workflows", icon: Workflow },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/invoices", label: "Invoices", icon: Receipt },
  { to: "/expenses", label: "Expenses", icon: Wallet },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/team", label: "Team & Roles", icon: UserCog },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, user, roles } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await getSupabase().auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const name = profile?.full_name || user?.email || "User";
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <img
            src={vybeLogo.url}
            alt="VYBE Creative Media logo"
            className="h-8 w-8 rounded-full bg-white object-contain"
          />
          <div className="leading-tight">
            <p className="text-sm font-semibold text-sidebar-accent-foreground">VYBE</p>
            <p className="text-[11px] text-sidebar-foreground/70">Business System</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-sidebar-accent text-xs text-sidebar-accent-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-xs font-medium text-sidebar-accent-foreground">{name}</p>
              <p className="truncate text-[11px] capitalize text-sidebar-foreground/60">
                {roles.join(", ") || "no role"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              aria-label="Sign out"
              className="h-8 w-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 overflow-x-auto border-b border-border bg-background px-4 py-2 md:hidden">
          {NAV.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs text-muted-foreground data-[status=active]:bg-accent data-[status=active]:text-accent-foreground"
            >
              {label}
            </Link>
          ))}
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
