import type { Session } from "@supabase/supabase-js";
import { useId, useRef, useState, type FormEvent } from "react";
import { useLocale } from "../../../shared/i18n/locale";
import { supabase } from "../../../shared/lib/supabase";
import { BrandMark } from "../../../shared/ui/BrandMark";
import { Mascot } from "../../../shared/ui/Mascot";
import "./sign-in.css";

type SignInPageProps = {
  onSuccess: (session: Session) => void;
  onDemo: () => void;
  demoAvailable?: boolean;
};

type SignInError = "credentials" | "rate-limit" | "unavailable";

export function SignInPage({ onSuccess, onDemo, demoAvailable = true }: SignInPageProps) {
  const { t } = useLocale();
  const titleId = useId();
  const emailId = useId();
  const passwordId = useId();
  const heroId = useId();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [miloLoaded, setMiloLoaded] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<SignInError | null>(null);

  const errorMessages: Record<SignInError, string> = {
    credentials: t("Check your email and password and try again.", "Confira seu e-mail e sua senha e tente de novo."),
    "rate-limit": t("Too many attempts. Wait a moment and try again.", "Muitas tentativas. Aguarde um pouco e tente novamente."),
    unavailable: t("Lumora couldn’t sign you in. Check your connection and try again.", "O Lumora não conseguiu conectar. Confira sua conexão e tente entrar novamente.")
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || inFlight.current) return;

    const form = event.currentTarget;
    const fields = new FormData(form);
    const email = String(fields.get("email") ?? "").trim();
    const password = String(fields.get("password") ?? "");
    let session: Session | null = null;

    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error?.status === 429) setError("rate-limit");
      else if (error?.name === "AuthRetryableFetchError" || (error?.status ?? 0) >= 500) setError("unavailable");
      else if (error || !data.session) setError("credentials");
      else session = data.session;
    } catch {
      setError("unavailable");
    } finally {
      inFlight.current = false;
      setPending(false);
    }

    if (session) {
      form.reset();
      onSuccess(session);
    }
  }

  return (
    <main className="app-shell text-slate-100">
      <div className="ambient-glow ambient-glow--cyan" aria-hidden="true" />
      <div className="ambient-glow ambient-glow--blue" aria-hidden="true" />
      <div className="relative mx-auto flex min-h-svh w-full max-w-6xl flex-col px-5 pb-8 pt-5 sm:px-8 sm:pb-12 sm:pt-8">
        <header className="flex items-center">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark />
            <span className="text-base font-semibold tracking-tight text-white">Lumora</span>
          </div>
        </header>

        <div className="my-auto grid gap-4 pt-6 sm:pt-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <section aria-labelledby={titleId} className="panel flex min-w-0 flex-col justify-center sm:p-8 lg:col-start-2 lg:row-start-1">
            <p className="eyebrow">{t("Your account", "Sua conta")}</p>
            <h1 id={titleId} className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {t("Sign in to Lumora", "Entre no Lumora")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {t("Open your workspace to search your team’s documents and ask questions with sources.", "Entre no seu espaço para buscar documentos da equipe e receber respostas com fontes.")}
            </p>

            {supabase ? (
              <form className="mt-6 grid gap-4" onSubmit={submit} aria-busy={pending}>
                <div className="grid gap-1.5">
                  <label htmlFor={emailId} className="text-sm font-medium text-slate-200">{t("Email address", "E-mail")}</label>
                  <input id={emailId} name="email" className="field text-base sm:text-sm" type="email"
                    placeholder={t("you@example.com", "voce@exemplo.com")} autoComplete="username"
                    autoCapitalize="none" spellCheck={false} required readOnly={pending} />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor={passwordId} className="text-sm font-medium text-slate-200">{t("Password", "Senha")}</label>
                  <div className="flex items-center gap-2">
                    <input id={passwordId} name="password" className="field min-w-0 flex-1 text-base sm:text-sm"
                      type={showPassword ? "text" : "password"} autoComplete="current-password"
                      required readOnly={pending} />
                    <button type="button" className="secondary-button min-h-11 shrink-0" aria-controls={passwordId}
                      onClick={() => setShowPassword((show) => !show)}>
                      {showPassword ? t("Hide", "Ocultar") : t("Show", "Mostrar")}
                      <span className="sr-only"> {t("password", "senha")}</span>
                    </button>
                  </div>
                </div>
                {error && <p className="error-message" role="alert">{errorMessages[error]}</p>}
                <button type="submit" className="primary-button w-full" disabled={pending}>
                  {pending && <span className="spinner" aria-hidden="true" />}
                  {pending ? t("Signing in…", "Entrando…") : t("Sign in", "Entrar")}
                </button>
              </form>
            ) : (
              <p className="error-message mt-6" role="status">
                {t("Sign-in is currently unavailable.", "O acesso à conta está indisponível no momento.")}
              </p>
            )}

            {demoAvailable && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-5">
                <p className="text-sm text-slate-400">{t("Try it with sample documents.", "Experimente com documentos de exemplo.")}</p>
                <button type="button" className="secondary-button" disabled={pending} onClick={onDemo}>
                  {t("Explore the public demo", "Explorar a demo pública")} <span aria-hidden="true">→</span>
                </button>
              </div>
            )}
          </section>

          <aside aria-labelledby={heroId} className="relative isolate flex min-w-0 flex-col justify-between overflow-hidden rounded-3xl border border-cyan-400/15 bg-slate-900/70 p-5 sm:p-8 lg:col-start-1 lg:row-start-1">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_70%_35%,#155e7570,transparent_66%)]" />
            <div>
              <p className="eyebrow">{t("Team knowledge", "Conhecimento da equipe")}</p>
              <h2 id={heroId} className="mt-2 max-w-sm text-2xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
                {t("Find answers in the documents your team trusts.", "Encontre respostas nos documentos que sua equipe usa.")}
              </h2>
              <p className="mt-3 max-w-sm text-sm leading-6 text-slate-300">
                {t("Search guides, policies, and notes, then open the sources behind each answer.",
                   "Busque em guias, políticas e anotações e confira as fontes de cada resposta.")}
              </p>
            </div>
            <div className="mt-5 flex items-center gap-3 sm:mt-7 sm:gap-5">
              <Mascot size="sm" className={`shrink-0 sm:!size-24${miloLoaded ? " sign-in-milo" : ""}`}
                decorative onLoad={() => setMiloLoaded(true)} />
              <p className="max-w-[16rem] rounded-2xl border border-cyan-400/20 bg-slate-950/50 px-3.5 py-3 text-sm leading-6 text-cyan-50">
                {t("Hi, I'm Milo. I'll help you get started.", "Oi, eu sou o Milo. Vou ajudar você nos primeiros passos.")}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
