import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import type { QuestionComparisonInput, QuestionComparisonResponse } from "@rag-study/contracts";
import { api } from "../../../shared/api/rag-api";

type Request = { input: QuestionComparisonInput; accessToken: string; workspaceId: string; controller: AbortController };
export type ComparisonOutcome = { data: QuestionComparisonResponse } | { error: unknown } | { cancelled: true };

export function useModelComparison(onFinished: (result: ComparisonOutcome) => void) {
  const active = useRef<AbortController | null>(null);
  const mutation = useMutation({
    networkMode: "always",
    mutationFn: ({ input, accessToken, workspaceId, controller }: Request) =>
      api.compareAnswers(input, accessToken, workspaceId, controller.signal)
  });

  useEffect(() => () => active.current?.abort(), []);

  function start(input: QuestionComparisonInput, accessToken: string, workspaceId: string) {
    if (active.current) return false;
    const controller = new AbortController();
    active.current = controller;
    function finish(result: ComparisonOutcome) {
      if (active.current !== controller) return;
      active.current = null;
      onFinished(result);
    }
    mutation.mutate({ input, accessToken, workspaceId, controller }, {
      onSuccess: (data) => finish({ data }),
      onError: (error) => finish({ error })
    });
    return true;
  }

  function stop() {
    const controller = active.current;
    if (!controller) return;
    active.current = null;
    controller.abort();
    mutation.reset();
    onFinished({ cancelled: true });
  }

  return { isPending: mutation.isPending, start, stop };
}
