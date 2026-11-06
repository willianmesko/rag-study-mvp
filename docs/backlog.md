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
  A demo usa o tenant fixo `demo` enquanto não há onboarding de organizações.
- Golden set determinístico, testes de prompt injection, testes unitários,
  typecheck, build e GitHub Actions.

## Pendente para ativar amanhã

### Ativar retenção de originais no Storage privado

**Ação manual necessária:** adicionar `SUPABASE_SERVICE_ROLE_KEY` somente ao
serviço `rag-study-demo-api` no Render, usando a chave `service_role` do projeto
Supabase. Não versionar, não enviar em chat e nunca usar o prefixo `VITE_`.

Sem essa variável, a demo continua segura e funcional: o upload fica no job do
banco apenas durante a extração e é removido ao concluir. Com a variável, o
arquivo original vai para o bucket privado e pode ser retido para auditoria ou
retry. Nenhuma chave é necessária no frontend.

## Próximas etapas, por prioridade

1. **Visualização do pipeline RAG no upload:** transformar o processamento de
   documento em uma linha do tempo visível na área administrativa: arquivo
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

2. **RBAC e tenant real:** tabela de memberships, papéis (`owner`, `editor`,
   `viewer`), tenant derivado da sessão autenticada e políticas RLS revisadas.
   A API não deve aceitar `tenant_id` vindo do navegador.
3. **Gestão do corpus:** listar documentos por tenant, apagar documento + chunks
   + original no Storage, retenção configurável e reindexação versionada.
4. **Observabilidade:** traces no LangSmith *ou* Langfuse/Phoenix, métricas de
   latência, custo, falhas e volume sem registrar conteúdo ou segredos.
5. **Evaluation harness:** aumentar o golden set com dados reais, rodar a suíte
   de segurança no CI, adicionar Promptfoo contra ambiente sem dados reais e,
   depois, Ragas para contexto/fidelidade.
6. **Qualidade de retrieval:** habilitar e medir Jina reranker somente com
   `JINA_API_KEY`; comparar recall, MRR, latência e custo contra o golden set.
7. **Worker dedicado:** Redis + BullMQ e serviço Render separado quando jobs
   grandes, concorrência ou retries com backoff justificarem o custo adicional.
8. **Produção econômica:** Cloudflare Pages/Render/Supabase gratuitos para demo;
   alertas de orçamento, backups, domínio, limites por identidade e política de
   retenção antes de receber usuários reais.
