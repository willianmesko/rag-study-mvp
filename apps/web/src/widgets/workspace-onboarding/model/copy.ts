import type { GuidePath, GuideStep } from "./guide";
type GuideCopy = {
  guideLabel: string;
  stepCount: (step: number, total: number) => string;
  steps: Record<
    GuideStep,
    { label: string; title: string; description: string }
  >;
  paths: Record<GuidePath, { label: string; example: string }>;
  choosePath: string;
  back: string;
  next: string;
  finish: string;
};

export const guideCopy: Record<"en" | "pt-BR", GuideCopy> = {
  en: {
    stepCount: (step, total) => `Step ${step} of ${total}`,
    guideLabel: "Workspace setup",
    steps: {
      purpose: {
        label: "Your goal",
        title: "What will you use Lumora for?",
        description:
          "Choose a starting point. Milo will guide you from a document to your first answer.",
      },
      knowledge: {
        label: "First document",
        title: "Start with a document you trust",
        description:
          "A current guide, policy, or checklist gives your team a good place to start.",
      },
      answer: {
        label: "First question",
        title: "Ask your first question",
        description:
          "Use a prepared document, then open the source to check what supports the answer.",
      },
    },
    paths: {
      knowledge: {
        label: "Knowledge and processes",
        example: "A handbook with your team's request and approval process",
      },
      support: {
        label: "Customer and team support",
        example: "An FAQ with answers and steps for getting help",
      },
      learning: {
        label: "Learning and onboarding",
        example: "A getting-started guide for new teammates",
      },
    },
    choosePath: "Choose a starting point",
    back: "Back",
    next: "Continue",
    finish: "Finish and open chat",
  },
  "pt-BR": {
    stepCount: (step, total) => `Etapa ${step} de ${total}`,
    guideLabel: "Configuração do espaço",
    steps: {
      purpose: {
        label: "Seu objetivo",
        title: "Como você quer usar o Lumora?",
        description:
          "Escolha um ponto de partida. O Milo vai guiar você de um documento até a primeira resposta.",
      },
      knowledge: {
        label: "Primeiro documento",
        title: "Comece com um documento confiável",
        description:
          "Um guia, uma política ou um checklist atualizado já é um bom ponto de partida para sua equipe.",
      },
      answer: {
        label: "Primeira pergunta",
        title: "Faça sua primeira pergunta",
        description:
          "Use um documento pronto e abra a fonte para conferir o que sustenta a resposta.",
      },
    },
    paths: {
      knowledge: {
        label: "Conhecimento e processos",
        example:
          "Um manual com o processo de solicitações e aprovações da equipe",
      },
      support: {
        label: "Atendimento e suporte",
        example:
          "Um guia de perguntas frequentes com respostas e orientações de ajuda",
      },
      learning: {
        label: "Aprendizado e integração",
        example: "Um guia de primeiros passos para novos colegas",
      },
    },
    choosePath: "Escolha um ponto de partida",
    back: "Voltar",
    next: "Continuar",
    finish: "Concluir e abrir conversa",
  },
};
