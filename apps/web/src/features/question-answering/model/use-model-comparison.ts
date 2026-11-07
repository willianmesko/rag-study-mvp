import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import type { QuestionComparisonInput, QuestionComparisonResponse } from "@rag-study/contracts";
import { api } from "../../../shared/api/rag-api";

type Saved = {conversationId:string;runId:string};
type Request = { input: QuestionComparisonInput; accessToken: string; workspaceId: string; controller: AbortController; saved?:Saved;recover?:boolean };
export type ComparisonOutcome = { data: QuestionComparisonResponse } | { error: unknown } | { cancelled: true };

export function useModelComparison(onFinished: (result: ComparisonOutcome) => void) {
  const active = useRef<AbortController | null>(null);
  const savedActive=useRef<{saved:Saved;accessToken:string;workspaceId:string}|null>(null);
  const mutation = useMutation({
    networkMode: "always",
    mutationFn: async ({ input, accessToken, workspaceId, controller,saved,recover }: Request) => {
      if(!saved)return api.compareAnswers(input, accessToken, workspaceId, controller.signal);
      return api.savedComparison(input,accessToken,workspaceId,saved,controller.signal,recover);
    }
  });

  useEffect(() => () => active.current?.abort(), []);

  function start(input: QuestionComparisonInput, accessToken: string, workspaceId: string,saved?:Saved,recover=false) {
    if (active.current) return false;
    const controller = new AbortController();
    active.current = controller;
    savedActive.current=saved?{saved,accessToken,workspaceId}:null;
    function finish(result: ComparisonOutcome) {
      if (active.current !== controller) return;
      active.current = null;
      savedActive.current=null;
      onFinished(result);
    }
    mutation.mutate({ input, accessToken, workspaceId, controller,saved,recover }, {
      onSuccess: (data) => finish({ data }),
      onError: (error) => finish({ error })
    });
    return true;
  }

  async function stop() {
    const controller = active.current;
    if (!controller) return;
    const saved=savedActive.current;
    if(saved){
      try{const turn=await api.cancelConversationTurn(saved.accessToken,saved.workspaceId,saved.saved.conversationId,saved.saved.runId);
        if(active.current!==controller)return;
        active.current=null;savedActive.current=null;controller.abort();mutation.reset();
        onFinished(turn.comparison?{data:turn.comparison}:turn.status==='cancelled'?{cancelled:true}:{error:new Error('The comparison could not complete.')});
      }catch(error){if(active.current===controller){active.current=null;savedActive.current=null;controller.abort();mutation.reset();onFinished({error});}}
      return;
    }
    active.current = null;
    controller.abort();
    mutation.reset();
    onFinished({ cancelled: true });
  }

  function detach(){active.current?.abort();active.current=null;savedActive.current=null;mutation.reset();}
  return { isPending: mutation.isPending, start, stop, detach, recover:(input:QuestionComparisonInput,accessToken:string,workspaceId:string,saved:Saved)=>start(input,accessToken,workspaceId,saved,true) };
}
