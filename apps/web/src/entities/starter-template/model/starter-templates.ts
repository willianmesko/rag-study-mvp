import type { Locale } from "../../../shared/i18n/locale";

export type StarterGoal = "knowledge" | "support" | "learning";
export type StarterTemplate = {
  filename: string;
  title: string;
  questions: string[];
  content: string;
};

const templates: Record<Locale, Record<StarterGoal, StarterTemplate>> = {
  en: {
    knowledge: {
      filename: "sample-request-checklist.md",
      title: "Sample request checklist",
      questions: ["What do I need before submitting a request?", "What happens when a request is incomplete?"],
      content: `# Sample request checklist

This is fictional practice content supplied by Lumora. It does not describe your organization's policies. Replace it with an approved, current document before using answers for real work.

## Before submitting a request

Include a short description of the request, the expected outcome, and the responsible person's approval. Add a link to any supporting material that the receiving team is authorized to read. Never include passwords, access tokens, or confidential customer information in a request.

## Review and follow-up

The receiving team checks whether the description, expected outcome, and approval are present. If a request is incomplete, the team asks the requester for the missing information before continuing. The requester receives an update when the review is finished.

## Keeping the checklist current

The document owner reviews this sample checklist every three months. The current version should have a clear title, an owner, and a review date. An outdated copy should be archived so it is not confused with the approved version.
`
    },
    support: {
      filename: "sample-support-guide.md",
      title: "Sample support guide",
      questions: ["When should I ask another teammate for help?", "What information should a support handoff include?"],
      content: `# Sample support guide

This fictional FAQ is provided for practice. It is not a service commitment or a real customer support policy.

## First response

Read the request and check the approved FAQ for a matching situation. Confirm what the person needs before suggesting a solution. Do not guess about account access, prices, or contractual terms that are not covered by the current documentation.

## Asking the team for help

If this guide does not cover the issue, contact the responsible team with the request and the steps already tried. Include a brief summary, the expected result, and what actually happened. Redact personal information and secrets before sharing examples. Ask the responsible team to confirm the next step.

## Closing the loop

Explain the confirmed resolution in plain language. Link to the approved source when one exists. If no solution has been confirmed, tell the requester that the issue is still being investigated. Do not describe an untested suggestion as a confirmed fix.
`
    },
    learning: {
      filename: "sample-team-handbook.md",
      title: "Sample team handbook",
      questions: ["What should a new teammate do on their first day?", "What should I do if a guide is unclear?"],
      content: `# Sample team handbook

This fictional handbook is safe practice content. Adapt it to your team's approved practices before relying on it.

## Your first day

New teammates should attend their orientation and set up their account on the first day. Read the team's getting-started guide and check that you can access the approved shared workspace. Use your own account and never share credentials.

## Learning the workflow

Start with one small task and review the relevant source document. Ask your teammate to explain unfamiliar terms. If a guide is unclear, ask the document owner for clarification and suggest a specific improvement. A generated answer can help you find a passage, but you should read the source before making an important decision.

## Your first week

Review one completed example with your teammate. Write down open questions and check that you know where the current guides are stored. The document owner maintains the approved version and removes obsolete instructions.
`
    }
  },
  "pt-BR": {
    knowledge: {
      filename: "exemplo-checklist-solicitacoes.md",
      title: "Exemplo de checklist de solicitações",
      questions: ["O que preciso antes de enviar uma solicitação?", "O que acontece quando uma solicitação está incompleta?"],
      content: `# Exemplo de checklist de solicitações

Este é um material fictício de prática fornecido pelo Lumora. Ele não descreve as políticas da sua organização. Substitua-o por um documento atual e aprovado antes de usar as respostas no trabalho real.

## Antes de enviar uma solicitação

Inclua uma breve descrição da solicitação, o resultado esperado e a aprovação da pessoa responsável. Adicione um link para materiais de apoio que a equipe destinatária tenha autorização para ler. Nunca inclua senhas, tokens de acesso ou informações confidenciais de clientes.

## Revisão e acompanhamento

A equipe destinatária verifica a descrição, o resultado esperado e a aprovação. Quando a solicitação está incompleta, a equipe pede as informações que faltam antes de continuar. A pessoa solicitante recebe uma atualização ao fim da revisão.

## Como manter o checklist atualizado

A pessoa responsável revisa este checklist de exemplo a cada três meses. A versão atual deve ter título claro, responsável e data de revisão. Cópias antigas devem ser arquivadas para evitar confusão com a versão aprovada.
`
    },
    support: {
      filename: "exemplo-guia-atendimento.md",
      title: "Exemplo de guia de atendimento",
      questions: ["Quando devo pedir ajuda a outra pessoa da equipe?", "Quais informações devo incluir ao pedir ajuda?"],
      content: `# Exemplo de guia de atendimento

Este guia de perguntas frequentes é fictício e serve para prática. Ele não representa um compromisso de serviço nem uma política real de atendimento.

## Primeiro contato

Leia a solicitação e consulte o guia aprovado para encontrar uma situação semelhante. Confirme a necessidade da pessoa antes de sugerir uma solução. Não suponha regras de acesso, preços ou condições contratuais que não estejam na documentação atual.

## Quando pedir ajuda à equipe

Se este guia não cobrir a situação, entre em contato com a equipe responsável e informe a solicitação e as etapas já tentadas. Inclua um resumo, o resultado esperado e o que aconteceu. Remova dados pessoais e segredos dos exemplos antes de compartilhá-los. Peça à equipe responsável que confirme o próximo passo.

## Como concluir o atendimento

Explique a solução confirmada com palavras simples. Inclua o link para a fonte aprovada, quando existir. Se a solução ainda não foi confirmada, informe que a situação continua em investigação. Não apresente uma sugestão sem teste como uma correção confirmada.
`
    },
    learning: {
      filename: "exemplo-manual-equipe.md",
      title: "Exemplo de manual da equipe",
      questions: ["O que um novo colega deve fazer no primeiro dia?", "O que fazer quando um guia não está claro?"],
      content: `# Exemplo de manual da equipe

Este manual fictício é um material seguro para prática. Adapte o conteúdo às orientações aprovadas da sua equipe antes de usá-lo no trabalho.

## Seu primeiro dia

No primeiro dia, novos colegas devem participar da orientação inicial e configurar sua conta. Leia o guia de primeiros passos e confira o acesso ao espaço compartilhado aprovado. Use sua própria conta e nunca compartilhe credenciais.

## Como aprender o fluxo de trabalho

Comece por uma tarefa pequena e leia o documento relacionado. Peça ajuda para entender termos desconhecidos. Se um guia não estiver claro, peça esclarecimentos à pessoa responsável pelo documento e sugira uma melhoria específica. Uma resposta gerada ajuda a encontrar um trecho, mas você deve ler a fonte antes de tomar uma decisão importante.

## Sua primeira semana

Revise um exemplo concluído com um colega. Anote as dúvidas e confirme onde estão os guias atuais. A pessoa responsável pelo documento mantém a versão aprovada e remove instruções antigas.
`
    }
  }
};

export function getStarterTemplate(goal: StarterGoal, locale: Locale): StarterTemplate {
  return templates[locale][goal];
}
