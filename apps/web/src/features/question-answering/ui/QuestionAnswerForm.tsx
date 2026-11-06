import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { QuestionResponse, QuestionSource } from "../../../shared/api/rag-api";
import { api } from "../../../shared/api/rag-api";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { questionInputSchema } from "@rag-study/contracts";
import { InputLabel } from "../../../shared/ui/InputLabel";
import { SectionTitle } from "../../../shared/ui/SectionTitle";

export function QuestionAnswerForm({ onAnswered, onInspectSource }: { onAnswered: (input: { question: string; response: QuestionResponse }) => void; onInspectSource: (source: QuestionSource) => void }) {
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(5);
  const [validationError, setValidationError] = useState<string | null>(null);
  const answer = useMutation({ mutationFn: api.answer, onSuccess: (response, input) => onAnswered({ question: input.question, response }) });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); try { setValidationError(null); answer.mutate(questionInputSchema.parse({ question, topK })); } catch (error) { setValidationError(error instanceof Error ? error.message : "Invalid input."); } }
  const error = validationError ?? (answer.error ? getRequestErrorMessage(answer.error) : null);
  return <form className="space-y-7" onSubmit={submit}><SectionTitle eyebrow="Step 03" title="Ask with retrieved context">The API retrieves the closest chunks, delimits untrusted material, and excludes high-risk chunks before calling the model.</SectionTitle><div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6"><InputLabel label="Question"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} className="field min-h-28 resize-y" placeholder="Explain RAG using my notes." /></InputLabel><div className="mt-5 flex justify-end"><button className="primary-button" disabled={answer.isPending} type="submit">{answer.isPending ? "Preparing answer…" : "Ask RAG"}</button></div></div>{answer.data && <div className="space-y-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-6"><p className="whitespace-pre-wrap text-sm leading-7 text-slate-200">{answer.data.answer}</p><div className="border-t border-cyan-400/10 pt-4"><p className="text-xs font-semibold tracking-[0.14em] text-cyan-300 uppercase">Retrieved sources</p><ul className="mt-3 grid gap-2">{answer.data.sources.map((item) => <li key={item.chunkId} className="flex justify-between gap-4 text-xs text-slate-400"><button type="button" onClick={() => onInspectSource(item)} className="truncate text-left hover:text-cyan-200 hover:underline">{item.title ?? item.source} · chunk {item.chunk}</button><span className="font-mono text-cyan-300">{item.score.toFixed(3)}</span></li>)}</ul></div></div>}{error && !answer.isPending && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{error}</p>}</form>;
}
