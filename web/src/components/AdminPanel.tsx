import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";

export function AdminPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { void supabase?.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null)); }, []);
  const jobs = useQuery({ queryKey: ["ingestion-jobs", token], queryFn: () => api.listUploads(token as string), enabled: Boolean(token), refetchInterval: 3_000 });
  const login = useMutation({ mutationFn: async () => {
    if (!supabase) throw new Error("Supabase Auth ainda não foi configurado para esta demo.");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw error ?? new Error("Não foi possível iniciar a sessão.");
    return data.session.access_token;
  }, onSuccess: (accessToken) => { setToken(accessToken); setMessage("Sessão administrativa iniciada."); } });
  const upload = useMutation({ mutationFn: () => {
    if (!file || !token) throw new Error("Selecione um arquivo e entre como administrador.");
    return api.uploadDocument({ file, source: source || `upload/${file.name}`, title: title || undefined, accessToken: token });
  }, onSuccess: () => { setMessage("Upload enfileirado. O processamento continua em segundo plano."); void jobs.refetch(); } });
  async function logout() { await supabase?.auth.signOut(); setToken(null); setMessage("Sessão encerrada."); }
  function submitLogin(event: FormEvent) { event.preventDefault(); login.mutate(); }
  function submitUpload(event: FormEvent) { event.preventDefault(); upload.mutate(); }
  if (!supabase) return <section className="space-y-4"><h2 className="text-2xl font-semibold">Administração indisponível</h2><p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no frontend, além da lista ADMIN_EMAILS na API.</p></section>;
  if (!token) return <form className="space-y-5" onSubmit={submitLogin}><h2 className="text-2xl font-semibold">Entrar como administrador</h2><p className="text-sm text-slate-400">A senha é validada pelo Supabase Auth. A chave interna da API nunca chega ao navegador.</p><input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" required /><input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" required /><button className="primary-button" disabled={login.isPending}>{login.isPending ? "Entrando…" : "Entrar"}</button>{login.error && <p className="text-sm text-rose-300">{login.error.message}</p>}</form>;
  return <section className="space-y-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-[.18em] uppercase text-cyan-300">Área protegida</p><h2 className="mt-2 text-2xl font-semibold">Adicionar documento ao corpus</h2><p className="mt-2 text-sm text-slate-400">PDF, DOCX, TXT ou Markdown · até 5 MB · processamento assíncrono.</p></div><button className="text-sm text-slate-400 hover:text-white" onClick={() => void logout()}>Sair</button></div><form className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6" onSubmit={submitUpload}><input className="field" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Origem única (ex.: docs/arquitetura)" /><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título opcional" /><input className="field" type="file" accept=".pdf,.docx,.txt,.md,.markdown,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /><button className="primary-button w-fit" disabled={upload.isPending}>{upload.isPending ? "Enfileirando…" : "Enviar para processamento"}</button></form>{message && <p className="success-message">{message}</p>}{upload.error && <p className="text-sm text-rose-300">{upload.error.message}</p>}<div className="space-y-3"><h3 className="font-medium">Processamentos recentes</h3>{jobs.data?.jobs.map((job) => <article className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-sm" key={job.id}><div className="flex justify-between gap-4"><span>{job.title ?? job.filename}</span><span className="font-mono text-cyan-300">{job.status} · {job.progress}%</span></div><p className="mt-1 text-xs text-slate-500">{job.source} {job.chunkCount !== null ? `· ${job.chunkCount} chunks` : ""}</p>{job.error && <p className="mt-2 text-xs text-rose-300">{job.error}</p>}</article>)}</div></section>;
}
