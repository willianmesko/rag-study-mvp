import type { QuestionResponse } from "@rag-study/contracts";

export function getRefusalCopy(reason: QuestionResponse["refusalReason"]): [string, string] | null {
  switch (reason) {
    case "insufficient_context":
      return ["I could not find enough information in the workspace documents to answer. Try a more specific question or check that the relevant document is indexed.",
        "Não encontrei informações suficientes nos documentos deste espaço para responder. Faça uma pergunta mais específica ou verifique se o documento relevante foi indexado."];
    case "invalid_citations":
      return ["I could not match the answer’s citations to the passages I found. Try again or make your question more specific.",
        "Não consegui vincular as citações da resposta aos trechos encontrados. Tente novamente ou faça uma pergunta mais específica."];
    case "unstructured_model_output":
      return ["I could not prepare an answer with sources this time. Try again or make your question more specific.",
        "Desta vez, não consegui preparar uma resposta com fontes. Tente novamente ou faça uma pergunta mais específica."];
    default:
      return reason ? ["I could not answer this question. Try asking it a different way.",
        "Não consegui responder a essa pergunta. Tente perguntar de outra forma."] : null;
  }
}
