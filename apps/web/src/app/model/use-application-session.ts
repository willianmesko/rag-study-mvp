import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../shared/lib/supabase";
import { transitionQueryIdentity } from "../../shared/lib/query-keys";

export function useApplicationSession(onIdentityChange: () => void) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const identity = useRef<string | null>(null);
  const logoutPending = useRef(false);

  const acceptSession = useCallback((next: Session | null) => {
    const nextUserId = next?.user.id ?? null;
    if (transitionQueryIdentity(queryClient, identity.current, nextUserId)) onIdentityChange();
    identity.current = nextUserId;
    setSession(next);
    setAuthReady(true);
  }, [queryClient, onIdentityChange]);

  useEffect(() => {
    let active = true;
    const listener = supabase?.auth.onAuthStateChange((_event, next) => { if (active) acceptSession(next); });
    return () => { active = false; listener?.data.subscription.unsubscribe(); };
  }, [acceptSession]);

  async function signOut(): Promise<boolean> {
    if (!supabase || logoutPending.current) return false;
    logoutPending.current = true;
    setSigningOut(true);
    setSignOutError(false);
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      acceptSession(null);
      return true;
    } catch {
      setSignOutError(true);
      return false;
    } finally {
      logoutPending.current = false;
      setSigningOut(false);
    }
  }

  return { session, authReady, acceptSession, signingOut, signOutError, signOut };
}
