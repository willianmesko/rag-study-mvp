import { createContext, useContext, type PropsWithChildren } from "react";

const QueryIdentityContext = createContext<string | null>(null);

export function QueryIdentityProvider({ userId, children }: PropsWithChildren<{ userId: string }>) {
  return <QueryIdentityContext.Provider value={userId}>{children}</QueryIdentityContext.Provider>;
}

export function useQueryIdentity() {
  return useContext(QueryIdentityContext);
}
