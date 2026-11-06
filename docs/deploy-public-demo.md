# Publicar a demo pública

Esta configuração publica uma demonstração **somente leitura**. Ela não é uma produção comercial: serviços gratuitos podem pausar, reiniciar ou ter limites de uso. O objetivo é apresentar o fluxo de RAG sem expor a ingestão de documentos, chaves de provedor ou banco de dados.

## Arquitetura

```text
Cloudflare Pages (React estático)
            |
            | HTTPS + CORS restrito
            v
Render (Fastify / API)
            |                 \
            v                  v
Supabase Postgres + pgvector   OpenRouter
```

## 1. Banco no Supabase

1. Crie um projeto Postgres e habilite a extensão `vector`.
2. Copie a connection string de acesso direto para `DATABASE_URL`.
3. No computador local, use temporariamente essa URL para aplicar as migrations:

   ```bash
   DATABASE_URL='postgresql://...' npm run db:migrate
   ```

4. Carregue somente o corpus de demonstração:

   ```bash
   DATABASE_URL='postgresql://...' \
   EMBEDDING_PROVIDER=openrouter \
   OPENROUTER_API_KEY='...' \
   npm run ingest -- examples/rag-fundamentals.md demo/rag-fundamentals
   ```

Não use a chave de banco no frontend e não versione a URL com senha.

## 2. API no Render

1. Faça push deste repositório no GitHub e crie um Blueprint apontando para `render.yaml`.
2. Preencha os valores secretos: `DATABASE_URL`, `OPENROUTER_API_KEY` e `ALLOWED_ORIGINS`.
3. Confirme que o serviço tem `HOST=0.0.0.0`, `DEMO_MODE=true`, `RERANKER_PROVIDER=none` e `LANGSMITH_TRACING=false`.
4. Espere o health check `GET /health` responder `200`.

`ADMIN_API_KEY` é gerada pelo Blueprint. Guarde-a no gerenciador de segredos; ela serve apenas para reindexação administrativa com o header `x-admin-api-key`.

## 3. Frontend no Cloudflare Pages

1. Importe o mesmo repositório.
2. Use `npm run build:web` como comando de build e `apps/web/dist` como diretório de saída.
3. Adicione as variáveis públicas de build:

   ```text
   VITE_API_BASE_URL=https://SEU-SERVICO.onrender.com
   VITE_DEMO_MODE=true
   ```

4. Copie a URL final do Pages para `ALLOWED_ORIGINS` na API e faça novo deploy da API.

`VITE_*` entra no JavaScript enviado ao visitante: nunca use esse prefixo para segredos.

## 4. Critérios de aceite

- A interface não mostra a aba de ingestão.
- `GET /health`, busca e Q&A funcionam pela URL pública.
- `POST /v1/documents` sem `x-admin-api-key` retorna `401`.
- A origem publicada recebe CORS; outra origem não recebe autorização no preflight.
- A chave OpenRouter não está no repositório, frontend ou logs.
- O golden set e a suíte de segurança passam antes de cada publicação.

## Antes de chamar de produção

Adicione autenticação individual, `tenant_id` obrigatório nas tabelas e queries, rate limit compartilhado, backups, logs sem conteúdo sensível, alertas e política de retenção. Só então habilite uploads, PDF/DOCX, ferramentas MCP ou ações externas.
