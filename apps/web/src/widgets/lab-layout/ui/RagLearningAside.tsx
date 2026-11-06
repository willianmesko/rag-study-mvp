import { useLocale } from "../../../shared/i18n/locale";
import { Mascot } from "../../../shared/ui/Mascot";

export function RagLearningAside() {
  const { t } = useLocale();
  const tips = [
    t("One document can be split into several short passages for search.",
      "Um documento pode ser dividido em vários trechos curtos para facilitar a busca."),
    t("A relevance score measures how closely a passage matches your question. Check the original source to verify the facts.",
      "A pontuação de relevância indica o quanto um trecho se aproxima da sua pergunta. Confira a fonte para verificar os fatos."),
    t("Open a citation to read the passage that supports an answer.",
      "Abra uma citação para ler o trecho que embasa a resposta.")
  ];

  return (
    <aside className="panel hidden h-fit border-slate-800/80 lg:block">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">{t("Tips from Milo", "Dicas do Milo")}</p>
          <p className="mt-2 text-sm font-medium text-slate-200">{t("Good answers start with good sources.", "Boas respostas começam com boas fontes.")}</p>
        </div>
        <Mascot size="sm" decorative />
      </div>
      <ol className="mt-5 space-y-5 text-sm leading-6 text-slate-400">
        {tips.map((tip, index) => <li key={index}><span aria-hidden="true" className="mr-2 font-mono text-cyan-300">{String(index + 1).padStart(2, "0")}</span>{tip}</li>)}
      </ol>
    </aside>
  );
}
