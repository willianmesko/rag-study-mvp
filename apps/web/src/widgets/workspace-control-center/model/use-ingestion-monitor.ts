import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { privateQueryKey } from "../../../shared/lib/query-keys";
import { ingestionJobsQuery } from "./queries";

/** One interval owner per mounted workspace; sections share its query/cache. */
export function useIngestionMonitor(token: string, workspaceId: string, userId: string | null) {
  const client = useQueryClient();
  const jobs = useQuery({
    ...ingestionJobsQuery(token, workspaceId, userId),
    refetchInterval: (query) => query.state.status !== "error" &&
      query.state.data?.jobs.some(({ status }) => status === "queued" || status === "processing") ? 3_000 : false,
  });
  const seen = useRef({ workspaceId, userId, revisions: new Map<string, string>() });

  useEffect(() => {
    if (seen.current.workspaceId !== workspaceId || seen.current.userId !== userId) {
      seen.current = { workspaceId, userId, revisions: new Map() };
    }
    if (jobs.isError || !jobs.data) return;
    let changed = false;
    const revisions = new Map<string, string>();
    for (const job of jobs.data.jobs) {
      if (job.status === "queued" || job.status === "processing") continue;
      const revision = JSON.stringify([job.status, job.updatedAt]);
      if (seen.current.revisions.get(job.id) !== revision) changed = true;
      revisions.set(job.id, revision);
    }
    seen.current.revisions = revisions;
    if (!changed) return;
    // Prefix invalidation includes every document filter; no mutation is replayed.
    for (const resource of ["documents", "knowledge-status"]) {
      void client.invalidateQueries({ queryKey: privateQueryKey(resource, userId, workspaceId) });
    }
  }, [client, workspaceId, userId, jobs.data, jobs.isError]);
}
