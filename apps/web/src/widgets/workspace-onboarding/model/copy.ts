import type { GuidePath, GuideStep } from "./guide";

type StepCopy = { label: string; title: string; description: string };
type PathCopy = { label: string; example: string; question: string; source: string; excerpt: string };

type GuideCopy = {
  guideLabel: string;
  welcome: string;
  introduction: string;
  workspaceIntroduction: (name: string) => string;
  progress: (completed: number, total: number) => string;
  stepCount: (step: number, total: number) => string;
  steps: Record<GuideStep, StepCopy>;
  paths: Record<GuidePath, PathCopy>;
  choosePath: string;
  invite: string;
  addDocument: string;
  openLibrary: string;
  openProcessing: string;
  openAsk: string;
  tryQuestion: string;
  questionLabel: string;
  viewerKnowledge: string;
  editorKnowledge: string;
  ownerKnowledge: string;
  documentsAvailable: string;
  jobsAvailable: string;
  noJobs: string;
  processingStages: string[];
  sampleDocument: string;
  sampleSource: string;
  similarity: string;
  back: string;
  next: string;
  finish: string;
  close: string;
  resume: string;
  review: string;
  saved: string;
  completed: string;
  done: string;
  goToAsk: string;
};

export const guideCopy: Record<"en" | "pt-BR", GuideCopy> = {
  en: {
    guideLabel: "Workspace guide",
    welcome: "Hi, I’m Milo.",
    introduction: "I’ll show you how to find answers in your team’s documents and check where those answers came from.",
    workspaceIntroduction: (name) => `Let’s get ${name} ready for its first question. I’ll walk you through it, one step at a time.`,
    progress: (completed, total) => `${completed} of ${total} steps covered`,
    stepCount: (step, total) => `Step ${step} of ${total}`,
    steps: {
      purpose: { label: "Your goal", title: "What will you use Lumora for?", description: "Pick the closest fit. Milo will use it to suggest a first document and a question you can try." },
      team: { label: "Your team", title: "Give teammates the right access", description: "Editors can add and manage documents. Viewers can look up information and read sources. You can invite people now or come back to this later." },
      knowledge: { label: "Documents", title: "Start with a document you trust", description: "Start small. One up-to-date file is enough to learn how Lumora works." },
      processing: { label: "Preparation", title: "See when a file is ready", description: "Lumora reads the file, splits the text into searchable passages, and checks it before adding it to the library. Processing shows what is ready and what needs attention." },
      answer: { label: "First question", title: "Ask something your document can answer", description: "Start with a question whose answer you already know. You can edit this example before sending it." },
      understand: { label: "Sources", title: "Follow the answer back to its source", description: "Open a source under an answer to read the passage that informed it. Compare the passage with the answer before relying on it." }
    },
    paths: {
      legal: { label: "Legal", example: "An approved checklist for opening a new matter", question: "What steps should we take before opening a new matter?", source: "Sample matter intake checklist", excerpt: "Complete a conflict check and record supervisor approval before opening a new matter." },
      it: { label: "IT", example: "A support playbook with your team's escalation rules", question: "When should we escalate a support request?", source: "Sample support playbook", excerpt: "Escalate a request to the on-call team when a critical service is unavailable." },
      custom: { label: "Another team", example: "An internal guide for onboarding new teammates", question: "What should a new teammate do on their first day?", source: "Sample team handbook", excerpt: "New teammates should attend their orientation and set up their account on the first day." }
    },
    choosePath: "Choose a starting point",
    invite: "Open Team",
    addDocument: "Add a document",
    openLibrary: "Open the library",
    openProcessing: "Open Processing",
    openAsk: "Open Ask",
    tryQuestion: "Try this question",
    questionLabel: "Suggested question",
    viewerKnowledge: "You can browse documents here. Ask an owner or editor if the team needs a new source.",
    editorKnowledge: "As an editor, you can add files to this workspace. Choose a document your team is allowed to share here.",
    ownerKnowledge: "As an owner, you can upload files. Choose a document your team is allowed to share here.",
    documentsAvailable: "This workspace already has indexed documents.",
    jobsAvailable: "This workspace has processing activity you can inspect.",
    noJobs: "After an upload, its progress will appear here.",
    processingStages: ["Upload", "Read and prepare", "Ready to search"],
    sampleDocument: "A good first document",
    sampleSource: "Open a sample source",
    similarity: "A similarity score shows how closely a passage matches your question. The passage itself is what you should check.",
    back: "Back",
    next: "Continue",
    finish: "Finish guide",
    close: "Save and close",
    resume: "Resume guide",
    review: "Review guide",
    saved: "Pick up where you left off.",
    completed: "You’ve covered the essentials.",
    done: "Guide complete",
    goToAsk: "Ask Lumora"
  },
  "pt-BR": {
    guideLabel: "Guia do espaço de trabalho",
    welcome: "Oi, eu sou o Milo.",
    introduction: "Vou mostrar como encontrar respostas nos documentos da equipe e conferir de onde elas vieram.",
    workspaceIntroduction: (name) => `Vamos preparar ${name} para a primeira pergunta. Eu vou te acompanhar, uma etapa de cada vez.`,
    progress: (completed, total) => `${completed} de ${total} etapas concluídas`,
    stepCount: (step, total) => `Etapa ${step} de ${total}`,
    steps: {
      purpose: { label: "Seu objetivo", title: "Como você quer usar o Lumora?", description: "Escolha a opção mais próxima da sua realidade. O Milo vai sugerir um primeiro documento e uma pergunta para você testar." },
      team: { label: "Sua equipe", title: "Dê à equipe o acesso de que ela precisa", description: "Editores podem adicionar e gerenciar documentos. Leitores podem buscar informações e consultar fontes. Convide alguém agora ou deixe para depois." },
      knowledge: { label: "Documentos", title: "Comece com um documento confiável", description: "Um arquivo atualizado já é suficiente para aprender como o Lumora funciona." },
      processing: { label: "Preparação", title: "Veja quando o arquivo estiver pronto", description: "O Lumora lê o arquivo, divide o texto em trechos pesquisáveis e faz verificações antes de adicioná-lo à biblioteca. A seção Processamento mostra o que está pronto e o que precisa de atenção." },
      answer: { label: "Primeira pergunta", title: "Pergunte algo que o documento pode responder", description: "Comece com uma pergunta cuja resposta você já conhece. Você pode editar o exemplo antes de enviar." },
      understand: { label: "Fontes", title: "Confira a fonte por trás da resposta", description: "Abra uma fonte abaixo da resposta para ler o trecho usado. Compare o trecho com a resposta antes de usá-la." }
    },
    paths: {
      legal: { label: "Jurídico", example: "Um checklist aprovado para a abertura de um novo caso", question: "Quais etapas devemos seguir antes de abrir um novo caso?", source: "Exemplo de checklist de abertura de casos", excerpt: "Verifique conflitos de interesse e registre a aprovação da supervisão antes de abrir um novo caso." },
      it: { label: "TI", example: "Um guia de suporte com as regras de escalonamento da equipe", question: "Quando devemos encaminhar um chamado de suporte para outro nível?", source: "Exemplo de guia de suporte", excerpt: "Encaminhe o chamado à equipe de plantão quando um serviço crítico estiver indisponível." },
      custom: { label: "Outra equipe", example: "Um guia interno de integração para novos colegas", question: "O que um novo colega deve fazer no primeiro dia?", source: "Exemplo de manual da equipe", excerpt: "No primeiro dia, novos colegas devem participar da orientação inicial e configurar sua conta." }
    },
    choosePath: "Escolha um ponto de partida",
    invite: "Abrir Equipe",
    addDocument: "Adicionar um documento",
    openLibrary: "Abrir a biblioteca",
    openProcessing: "Abrir Processamento",
    openAsk: "Abrir o chat",
    tryQuestion: "Testar esta pergunta",
    questionLabel: "Pergunta sugerida",
    viewerKnowledge: "Você pode consultar os documentos aqui. Se a equipe precisar de uma nova fonte, fale com um editor ou proprietário.",
    editorKnowledge: "Como editor, você pode adicionar arquivos. Escolha um documento que a equipe tenha autorização para compartilhar neste espaço.",
    ownerKnowledge: "Como proprietário, você pode enviar arquivos. Escolha um documento que a equipe tenha autorização para compartilhar neste espaço.",
    documentsAvailable: "Este espaço já tem documentos pesquisáveis.",
    jobsAvailable: "Este espaço tem atividade de processamento que você pode consultar.",
    noJobs: "Depois de enviar um arquivo, você poderá acompanhar o progresso aqui.",
    processingStages: ["Envio", "Leitura e preparação", "Pronto para busca"],
    sampleDocument: "Um bom primeiro documento",
    sampleSource: "Abrir um exemplo de fonte",
    similarity: "A pontuação de similaridade mostra o quanto um trecho combina com a pergunta. Leia o próprio trecho para conferir o que ele diz.",
    back: "Voltar",
    next: "Continuar",
    finish: "Concluir guia",
    close: "Salvar e fechar",
    resume: "Retomar guia",
    review: "Rever guia",
    saved: "Continue de onde parou.",
    completed: "Você já passou pelo essencial.",
    done: "Guia concluído",
    goToAsk: "Perguntar ao Lumora"
  }
};
