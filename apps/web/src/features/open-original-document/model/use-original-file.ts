import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../../../shared/api/rag-api";

export type OriginalDocumentProps = { documentId: string; documentName: string; accessToken: string; workspaceId: string };
type FileState = { status: "loading" } | { status: "ready"; filename: string; isPdf: boolean; url: string }
  | { status: "error"; code?: number };

export function useOriginalFile({ documentId, accessToken, workspaceId }: OriginalDocumentProps) {
  const [attempt, setAttempt] = useState(0);
  const resource = useMemo(() => ({ documentId, workspaceId, accessToken, attempt }), [documentId, workspaceId, accessToken, attempt]);
  const [loaded, setLoaded] = useState<{ resource: typeof resource; value: FileState }>({ resource, value: { status: "loading" } });

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    let objectUrl: string | undefined;
    setLoaded({ resource, value: { status: "loading" } });
    void api.getOriginalDocument({ ...resource, signal })
      .then(({ blob, filename, isPdf }) => {
        if (signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ resource, value: { status: "ready", url: objectUrl, filename, isPdf } });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({ resource, value: { status: "error", code: error instanceof ApiError ? error.status : undefined } });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resource]);

  // Never display a previous document/account's URL while its effect is retiring.
  const state: FileState = loaded.resource === resource ? loaded.value : { status: "loading" };
  return { state, retry: () => setAttempt((value) => value + 1) };
}
