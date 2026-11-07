import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { QuestionComparisonInput } from "@rag-study/contracts";
import { api } from "../../../shared/api/rag-api";

type Request = { input: QuestionComparisonInput; accessToken: string; workspaceId: string; controller: AbortController };

export function useModelComparison() {
  const active = useRef<AbortController | null>(null);
  const [stopped, setStopped] = useState(false);
  const mutation = useMutation({
    networkMode: "always",
    mutationFn: ({ input, accessToken, workspaceId, controller }: Request) =>
      api.compareAnswers(input, accessToken, workspaceId, controller.signal).finally(() => {
        if (active.current === controller) active.current = null;
      })
  });

  useEffect(() => () => active.current?.abort(), []);

  function start(input: QuestionComparisonInput, accessToken: string, workspaceId: string) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setStopped(false);
    mutation.mutate({ input, accessToken, workspaceId, controller });
  }

  function stop() {
    active.current?.abort();
    active.current = null;
    mutation.reset();
    setStopped(true);
  }

  return { data: mutation.data, error: mutation.error, isPending: mutation.isPending, stopped, start, stop };
}
