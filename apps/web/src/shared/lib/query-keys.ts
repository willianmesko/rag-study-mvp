import type { Query, QueryClient } from "@tanstack/react-query";

// Credentials belong to request closures. Cache identity survives token refresh.
export function privateQueryKey(resource: string, userId: string | null | undefined,
  workspaceId?: string, ...parameters: readonly unknown[]) {
  return [resource, "private", userId ?? null, workspaceId ?? null, ...parameters] as const;
}

export function isPrivateQuery(query: Pick<Query, "queryKey">) {
  return query.queryKey[1] === "private";
}

export function clearPrivateQueries(client: QueryClient) {
  // Cancelling a query detaches HTTP readers; it never cancels a durable run.
  void client.cancelQueries({ predicate: isPrivateQuery });
  client.removeQueries({ predicate: isPrivateQuery });
  client.getMutationCache().clear();
}

export function transitionQueryIdentity(client: QueryClient,
  previousUserId: string | null, nextUserId: string | null) {
  if (previousUserId === nextUserId) return false;
  clearPrivateQueries(client);
  return true;
}
