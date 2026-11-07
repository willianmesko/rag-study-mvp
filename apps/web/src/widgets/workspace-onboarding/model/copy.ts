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
      purpose: { label: "Your goal", title: "What will you use Lumora for?", description: "Choose a starting point for your team. Milo will suggest a document and show how to find an answer." },
      knowledge: { label: "Documents", title: "Start with a document you trust", description: "A current guide, policy, or checklist gives your team a good place to start." },
      answer: { label: "Answers and sources", title: "Ask your first question", description: "Use a prepared document, then open the source to check what supports the answer." }
    },
    paths: {
      knowledge: {
        label: "Knowledge and processes",
        example: "A handbook with your team's request and approval process",
        question: "What do I need before submitting a request?",
        answer: "Include a short description and the responsible person's approval.",
        source: "Sample request checklist",
        excerpt: "Before submitting a request, include a short description and the responsible person's approval."
      },
      support: {
        label: "Customer and team support",
        example: "An FAQ with answers and steps for getting help",
        question: "When should I ask another teammate for help?",
        answer: "If the guide does not cover the issue, share the request and the steps already tried with the responsible team.",
        source: "Sample support guide",
        excerpt: "If this guide does not cover the issue, contact the responsible team with the request and the steps already tried."
      },
      learning: {
        label: "Learning and onboarding",
        example: "A getting-started guide for new teammates",
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
      purpose: { label: "Seu objetivo", title: "Como você quer usar o Lumora?", description: "Escolha um ponto de partida para sua equipe. O Milo vai sugerir um documento e mostrar como encontrar uma resposta." },
      knowledge: { label: "Documentos", title: "Comece com um documento confiável", description: "Um guia, uma política ou um checklist atualizado já é um bom ponto de partida para sua equipe." },
      answer: { label: "Respostas e fontes", title: "Faça sua primeira pergunta", description: "Use um documento pronto e abra a fonte para conferir o que sustenta a resposta." }
    },
    paths: {
      knowledge: {
        label: "Conhecimento e processos",
        example: "Um manual com o processo de solicitações e aprovações da equipe",
        question: "O que preciso antes de enviar uma solicitação?",
        answer: "Inclua uma breve descrição e a aprovação da pessoa responsável.",
        source: "Exemplo de checklist de solicitações",
        excerpt: "Antes de enviar uma solicitação, inclua uma breve descrição e a aprovação da pessoa responsável."
      },
      support: {
        label: "Atendimento e suporte",
        example: "Um guia de perguntas frequentes com respostas e orientações de ajuda",
        question: "Quando devo pedir ajuda a outra pessoa da equipe?",
        answer: "Se o guia não cobrir a situação, compartilhe a solicitação e as etapas já tentadas com a equipe responsável.",
        source: "Exemplo de guia de atendimento",
        excerpt: "Se este guia não cobrir a situação, entre em contato com a equipe responsável e informe a solicitação e as etapas já tentadas."
      },
      learning: {
        label: "Aprendizado e integração",
        example: "Um guia de primeiros passos para novos colegas",
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
