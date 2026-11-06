import type { GuidePath, GuideStep } from "./guide";

type StepCopy = { label: string; title: string; description: string };
type PathCopy = { label: string; example: string; question: string; answer: string; source: string; excerpt: string };
type GuideCopy = {
  guideLabel: string;
  welcome: string;
  workspaceIntroduction: (name: string) => string;
  stepCount: (step: number, total: number) => string;
  steps: Record<GuideStep, StepCopy>;
  paths: Record<GuidePath, PathCopy>;
  choosePath: string;
  viewerKnowledge: string;
  sampleDocument: string;
  sampleQuestion: string;
  sampleAnswer: string;
  sampleSource: string;
  similarity: string;
  back: string;
  next: string;
  finish: string;
};

export const guideCopy: Record<"en" | "pt-BR", GuideCopy> = {
  en: {
    guideLabel: "Workspace setup",
    welcome: "Hi, I’m Milo.",
    workspaceIntroduction: (name) => `Let’s get ${name} ready. I’ll show you how Lumora finds answers in your team’s documents.`,
    stepCount: (step, total) => `Step ${step} of ${total}`,
    steps: {
      purpose: { label: "Your goal", title: "What will you use Lumora for?", description: "Pick the closest fit. Milo will suggest a document and show an example from your field." },
      knowledge: { label: "Documents", title: "Start with a document you trust", description: "A current guide, policy, or checklist gives your team a good place to start." },
      answer: { label: "Answers and sources", title: "See how an answer comes together", description: "Try an example, then check the source before relying on the answer." }
    },
    paths: {
      legal: {
        label: "Legal",
        example: "An approved checklist for opening a new matter",
        question: "What steps should we take before opening a new matter?",
        answer: "Check for conflicts of interest and record the supervisor’s approval before opening a new matter.",
        source: "Sample matter intake checklist",
        excerpt: "Complete a conflict check and record supervisor approval before opening a new matter."
      },
      it: {
        label: "IT",
        example: "A support playbook with your team's escalation rules",
        question: "When should we escalate a support request?",
        answer: "If a critical service is unavailable, escalate the request to the on-call team.",
        source: "Sample support playbook",
        excerpt: "Escalate a request to the on-call team when a critical service is unavailable."
      },
      custom: {
        label: "Another team",
        example: "An internal guide for onboarding new teammates",
        question: "What should a new teammate do on their first day?",
        answer: "Attend orientation and set up your account on your first day.",
        source: "Sample team handbook",
        excerpt: "New teammates should attend their orientation and set up their account on the first day."
      }
    },
    choosePath: "Choose a starting point",
    viewerKnowledge: "You can browse the documents in this workspace. An editor or owner can add new files.",
    sampleDocument: "A good first document",
    sampleQuestion: "Example question",
    sampleAnswer: "Example answer",
    sampleSource: "Show the source",
    similarity: "A similarity score shows how closely a passage matches your question. Check what the passage actually says.",
    back: "Back",
    next: "Continue",
    finish: "Finish and open workspace"
  },
  "pt-BR": {
    guideLabel: "Configuração do espaço",
    welcome: "Oi, eu sou o Milo.",
    workspaceIntroduction: (name) => `Vamos preparar ${name}. Vou mostrar como o Lumora encontra respostas nos documentos da equipe.`,
    stepCount: (step, total) => `Etapa ${step} de ${total}`,
    steps: {
      purpose: { label: "Seu objetivo", title: "Como você quer usar o Lumora?", description: "Escolha a opção mais próxima da sua realidade. O Milo vai sugerir um documento e mostrar um exemplo da sua área." },
      knowledge: { label: "Documentos", title: "Comece com um documento confiável", description: "Um guia, uma política ou um checklist atualizado já é um bom ponto de partida para sua equipe." },
      answer: { label: "Respostas e fontes", title: "Veja como uma resposta é construída", description: "Experimente o exemplo e confira a fonte antes de usar a resposta." }
    },
    paths: {
      legal: {
        label: "Jurídico",
        example: "Um checklist aprovado para a abertura de um novo caso",
        question: "Quais etapas devemos seguir antes de abrir um novo caso?",
        answer: "Verifique se há conflitos de interesse e registre a aprovação da supervisão antes de abrir o caso.",
        source: "Exemplo de checklist de abertura de casos",
        excerpt: "Verifique conflitos de interesse e registre a aprovação da supervisão antes de abrir um novo caso."
      },
      it: {
        label: "TI",
        example: "Um guia de suporte com as regras de escalonamento da equipe",
        question: "Quando devemos encaminhar um chamado de suporte para outro nível?",
        answer: "Se um serviço crítico estiver indisponível, encaminhe o chamado à equipe de plantão.",
        source: "Exemplo de guia de suporte",
        excerpt: "Encaminhe o chamado à equipe de plantão quando um serviço crítico estiver indisponível."
      },
      custom: {
        label: "Outra equipe",
        example: "Um guia interno de integração para novos colegas",
        question: "O que um novo colega deve fazer no primeiro dia?",
        answer: "Participe da orientação inicial e configure sua conta no primeiro dia.",
        source: "Exemplo de manual da equipe",
        excerpt: "No primeiro dia, novos colegas devem participar da orientação inicial e configurar sua conta."
      }
    },
    choosePath: "Escolha um ponto de partida",
    viewerKnowledge: "Você pode consultar os documentos deste espaço. Um editor ou proprietário pode adicionar novos arquivos.",
    sampleDocument: "Um bom primeiro documento",
    sampleQuestion: "Pergunta de exemplo",
    sampleAnswer: "Resposta de exemplo",
    sampleSource: "Ver a fonte",
    similarity: "A pontuação de similaridade mostra o quanto um trecho combina com a pergunta. Leia o próprio trecho para conferir o que ele diz.",
    back: "Voltar",
    next: "Continuar",
    finish: "Concluir e abrir espaço"
  }
};
