import { useLocale } from "../../../shared/i18n/locale";

export function GuideConcepts() {
  const { t } = useLocale();
  const concepts = [
    [t("Document", "Documento"), t("A file your team has permission to use here. Check its owner and review date before uploading.", "Um arquivo que sua equipe tem autorização para usar aqui. Confira o responsável e a data de revisão antes de enviar.")],
    [t("Passages (chunks)", "Trechos (chunks)"), t("Lumora divides one document into smaller passages so it can find the part that answers your question. One file can produce many passages.", "O Lumora divide um documento em trechos menores para encontrar a parte que responde à pergunta. Um arquivo pode gerar vários trechos.")],
    [t("Embeddings", "Embeddings"), t("Numeric representations help match the meaning of a question to the meaning of a passage, even when the wording differs.", "Representações numéricas ajudam a relacionar o significado da pergunta ao de um trecho, mesmo com palavras diferentes.")],
    [t("Retrieval", "Busca de contexto"), t("Lumora searches only the selected workspace for useful passages before asking the answer model to respond.", "O Lumora procura trechos úteis somente no espaço selecionado antes de pedir uma resposta ao modelo.")],
    [t("Citations", "Citações"), t("Open a source below an answer to read the supporting passage. A valid source link does not prove every claim; check the actual text.", "Abra uma fonte abaixo da resposta para ler o trecho de apoio. Uma fonte válida não comprova cada afirmação; confira o texto.")],
    [t("Similarity score", "Score de similaridade"), t("This measures how closely a passage matches your question. It is not a probability that the answer is true or a guarantee of factual accuracy.", "Mede o quanto um trecho combina com sua pergunta. Não é a probabilidade de a resposta ser verdadeira nem uma garantia de exatidão factual.")]
  ];
  return <details className="workspace-guide__example">
    <summary>{t("A few terms, in plain language", "Alguns termos, com palavras simples")}</summary>
    <dl className="mt-4 space-y-4">
      {concepts.map(([term, description]) => <div key={term}>
        <dt className="text-sm font-medium text-slate-100">{term}</dt>
        <dd className="mt-1 text-sm leading-6 text-slate-300">{description}</dd>
      </div>)}
    </dl>
  </details>;
}
