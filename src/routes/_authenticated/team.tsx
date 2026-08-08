import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insertRow, deleteRow, useList } from "@/lib/api";
import { useSession } from "@/hooks/use-session";
import { PageHeader } from "@/components/app-shell";
import { ErrorNote, Loading, StatusBadge, humanize } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [
      { title: "Team & Roles — VYBE Business System" },
      { name: "description", content: "Manage staff accounts and role-based permissions." },
    ],
  }),
  component: TeamPage,
});

const ROLES = ["owner", "staff", "accountant", "editor", "client"] as const;

type Profile = { id: string; full_name: string | null; email: string | null };
type UserRole = { id: string; user_id: string; role: string };

function TeamPage() {
  const qc = useQueryClient();
  const { isOwner } = useSession();
  const profiles = useList<Profile>("profiles", { order: { column: "full_name", ascending: true } });
  const roles = useList<UserRole>("user_roles");

  if (profiles.isLoading || roles.isLoading) return <Loading />;
  if (profiles.error) return <ErrorNote error={profiles.error} />;

  const rolesFor = (uid: string) => (roles.data ?? []).filter((r) => r.user_id === uid);

  const grant = async (uid: string, role: string) => {
    if (rolesFor(uid).some((r) => r.role === role)) return;
    try {
      await insertRow("user_roles", { user_id: uid, role });
      qc.invalidateQueries({ queryKey: ["user_roles"] });
      toast.success(`Granted ${role}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not grant role");
    }
  };

  return (
    <div>
      <PageHeader
        title="Team & roles"
        description="Anyone who signs up appears here. Owners assign what each person can access."
      />

      {!isOwner ? (
        <p className="mb-3 rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          Only owners can change roles.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead className="w-56 text-right">Grant role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(profiles.data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.full_name || "—"}</TableCell>
                <TableCell>{p.email || "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {rolesFor(p.id).map((r) => (
                      <span key={r.id} className="flex items-center gap-1">
                        <StatusBadge value={r.role} />
                        {isOwner ? (
                          <button
                            className="text-xs text-muted-foreground hover:text-destructive"
                            onClick={async () => {
                              await deleteRow("user_roles", r.id);
                              qc.invalidateQueries({ queryKey: ["user_roles"] });
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                    ))}
                    {rolesFor(p.id).length === 0 ? (
                      <span className="text-xs text-muted-foreground">No role</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {isOwner ? (
                    <Select onValueChange={(v) => void grant(p.id, v)}>
                      <SelectTrigger className="ml-auto w-40" aria-label="Grant role">
                        <SelectValue placeholder="Add role…" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {humanize(r)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Button size="sm" variant="ghost" disabled>
                      Locked
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
