# Backlog de evolução

Este backlog separa o que está pronto para a demonstração do que precisa de
decisão, segredo ou custo antes de ser ativado. Ele é versionado junto ao código
para que a demo não esconda trabalho operacional pendente.

## Concluído

- RAG customizado com chunking, embeddings intercambiáveis, pgvector, busca
  híbrida (vetor + texto + RRF), proteção básica contra prompt injection e
  resposta com citações.
- Login administrativo via Supabase Auth, upload assíncrono de PDF, DOCX, TXT e
  Markdown, extração local, status de processamento e retry de jobs falhos.
- Bucket privado `rag-originals` no Supabase, com limite de 5 MB e tipos MIME
  restritos. O backend já conhece o adaptador de Storage privado.
- Isolamento por tenant no banco: documentos e jobs possuem `tenant_id`; a
  ingestão e as consultas híbridas recebem esse identificador obrigatoriamente.
  O tenant é derivado da membership validada da sessão, e não é aceito do
  navegador como dado de confiança.
- Guardrails iniciais de custo: quota diária de perguntas por tenant, quota diária
  de bytes enviados por administrador e auditoria de uploads/retries. A auditoria
  guarda somente identificadores e metadados técnicos; não guarda perguntas,
  conteúdo de documento ou IP em texto puro.
- Golden set determinístico, testes de prompt injection, testes unitários,
  typecheck, build e GitHub Actions.
- UX de produto: administrador lista documentos, visualiza chunks, reindexa a
  partir do original privado e exclui documento/chunks/original; fontes de Q&A
  são clicáveis e cada navegador mantém seu próprio histórico com feedback.
- Visualização do pipeline de ingestão no painel: o job exibe arquivo recebido,
  extração, chunking, triagem, embeddings e persistência vetorial. A próxima
  evolução é persistir duração e contagens de cada etapa, não apenas o progresso
  agregado atual.
- RBAC e multi-tenant para a demo: onboarding cria um workspace com owner;
  memberships suportam `owner`, `editor` e `viewer`; troca de workspace é
  persistida no navegador; viewers têm somente leitura; owners convidam por
  e-mail, alteram editor/viewer e removem membros não-owner. A API valida a
  sessão e o papel em toda rota, e a chave de serviço nunca chega ao frontend.

## Próximas etapas, por prioridade

1. **Evals no CI:** executar golden set, testes de prompt injection e Promptfoo
   a cada push; bloquear a publicação quando houver regressão. O golden set
   precisa usar corpus e provedor de teste isolados; Promptfoo não deve receber
   dados reais nem chaves em arquivos versionados.

2. **Segurança e custo:** limites por usuário e tenant, quotas de tokens e
   uploads, auditoria administrativa sem conteúdo sensível, redação de PII
   antes de provedores externos, cache semântico com chave por tenant e alertas
   de gasto antes de atingir o orçamento.

   **Progresso:** quotas de perguntas por tenant, limites diários de upload por
   administrador e trilha de auditoria já estão implementados. Restam quotas de
   tokens, PII, cache semântico e alertas de gasto.

   Próximos incrementos desta camada:

   1. **Redaction e detecção de PII:** detectar e mascarar dados pessoais antes
      de enviar pergunta ou contexto a provedores externos; preservar somente a
      versão mínima necessária para a resposta e registrar métricas, nunca o
      conteúdo sensível nos logs.
   2. **Cache semântico por tenant:** reutilizar respostas para perguntas muito
      semelhantes, com TTL, chave isolada por tenant e invalidação ao reindexar
      o corpus; reduzir chamadas repetidas ao LLM sem misturar dados entre
      clientes.
   3. **Quotas por usuário final:** substituir a quota compartilhada da demo
      por contadores atômicos ligados ao `user_id` autenticado, mantendo também
      limites agregados por tenant.
   4. **Métricas e alertas de gasto/uso:** medir requests, tokens estimados,
      latência, cache hit rate e falhas por tenant/provedor; configurar alertas
      antes de atingir um orçamento definido.

3. **Melhorar ingestão:** OCR para PDFs escaneados, importação de URLs/HTML,
   metadados, detecção de idioma e chunking por estrutura de documento.

   **OCR** (*Optical Character Recognition*, reconhecimento óptico de
   caracteres) lê uma imagem de texto e a converte em texto selecionável e
   pesquisável. Um PDF criado digitalmente normalmente já contém texto; um PDF
   escaneado contém páginas como imagens e precisa de OCR antes de gerar chunks
   e embeddings. A extração deve sinalizar baixa confiança para revisão humana.

4. **Detalhar a visualização do pipeline RAG:** persistir o processamento de
   documento em uma linha do tempo com duração e contagens: arquivo
   recebido → texto extraído → chunks criados → chunks sinalizados por risco →
   embeddings gerados → persistência vetorial → documento pronto para busca.
   A tela deve mostrar contagens, tempo por etapa, erros e um preview seguro de
   alguns chunks, sem vazar o documento para usuários não autorizados.

   - Um documento gera **vários chunks**; o número depende do tamanho e da
     estrutura do texto, `CHUNK_SIZE` e `CHUNK_OVERLAP`.
   - O **score de retrieval é similaridade/relevância relativa**, não uma
     probabilidade nem uma certeza de que a resposta está correta. A interface
     deve usar rótulos como “mais relacionado” e exibir fonte/citação, em vez
     de afirmar confiança factual.
   - A implementação precisa de eventos de progresso persistidos por job e uma
     API administrativa para ler o resumo de ingestão. O navegador somente
     consulta esse estado; nunca executa embeddings ou acessa segredos.

5. **Políticas RLS para acesso direto futuro:** hoje a API é a única camada que
   acessa as tabelas e valida membership. Antes de expor qualquer tabela pelo
   Data API, criar políticas explícitas por `auth.uid()` e tenant, testar BOLA
   e revisar as permissões do schema público.
6. **Arquitetura do frontend:** migrar a UI para Feature-Sliced Design, com
   `app`, `pages`, `widgets`, `features`, `entities` e `shared`; manter cada
   fluxo (perguntas, administração de corpus, autenticação) coeso e impedir
   que componentes de páginas acumulem regra de negócio e chamadas HTTP.
7. **Observabilidade:** traces no LangSmith *ou* Langfuse/Phoenix, métricas de
   latência, custo, falhas e volume sem registrar conteúdo ou segredos.
8. **Qualidade de retrieval:** habilitar e medir Jina reranker somente com
   `JINA_API_KEY`; comparar recall, MRR, latência e custo contra o golden set.
9. **Worker dedicado:** Redis + BullMQ e serviço Render separado quando jobs
   grandes, concorrência ou retries com backoff justificarem o custo adicional.
10. **Produção econômica:** Cloudflare Pages/Render/Supabase gratuitos para demo;
   alertas de orçamento, backups, domínio, limites por identidade e política de
   retenção antes de receber usuários reais.
