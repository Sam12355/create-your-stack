import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

export type AppRole = "owner" | "staff" | "accountant" | "editor" | "client";

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
};

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    let active = true;

    const loadExtras = async (uid: string) => {
      const [{ data: roleRows }, { data: prof }] = await Promise.all([
        sb.from("user_roles").select("role").eq("user_id", uid),
        sb.from("profiles").select("id, full_name, email, avatar_url").eq("id", uid).maybeSingle(),
      ]);
      if (!active) return;
      setRoles(((roleRows ?? []) as { role: AppRole }[]).map((r) => r.role));
      setProfile((prof as Profile) ?? null);
    };

    sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) void loadExtras(data.session.user.id);
      setLoading(false);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setUser(next?.user ?? null);
      if (next?.user) void loadExtras(next.user.id);
      else {
        setRoles([]);
        setProfile(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const hasRole = (...r: AppRole[]) => r.some((x) => roles.includes(x));

  return {
    session,
    user,
    profile,
    roles,
    loading,
    hasRole,
    isOwner: roles.includes("owner"),
    canFinance: roles.includes("owner") || roles.includes("accountant"),
    canOps: roles.includes("owner") || roles.includes("staff"),
  };
}
