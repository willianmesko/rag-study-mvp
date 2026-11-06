# RAG de estudo: TypeScript + pgvector + LangGraph

Este repositório é um MVP de RAG **customizado**: o fluxo de ingestão e recuperação permanece explícito, enquanto LangGraph orquestra o caminho de Q&A. Ele foi desenhado para você enxergar, depurar e trocar cada parte do pipeline antes de abstrair tudo em um framework.

> Objetivo: aprender a relação entre documento → chunks → embeddings → busca vetorial → contexto → resposta, com componentes que também aparecem em sistemas de produção.

## Arquitetura

```text
                    POST /v1/documents  ou  npm run ingest
                                  |
                    chunker (sentenças + sobreposição)
                                  |
     Ollama local | OpenRouter | Bedrock embeddings (1024d)
                                  |
                    PostgreSQL + pgvector (HNSW/cosseno)
                                  |
GET /v1/search ──> embedding ──> HNSW (semântico) ─┐
                    texto da pergunta ──> GIN/FTS ─┼──> RRF ──> reranker opcional ──> top-K
                                                    |
POST /v1/qa ───────────────────────────────────────└──> LangGraph → LLM → resposta com fontes
                                                           |
                                                   LangSmith opcional (traces)
```

O banco e a aplicação são deliberadamente separados: o Docker Compose executa apenas PostgreSQL/pgvector, enquanto Node.js roda localmente. O padrão é Ollama, portanto você pode entender o RAG sem uma conta paga ou chave externa. OpenRouter, Bedrock e LangSmith são integrações opcionais. O banco do MVP é exposto em `localhost:5433`, evitando conflito com um PostgreSQL local comum em `5432`.

## Estrutura

```text
.
├── compose.yaml                 # PostgreSQL 16 + pgvector
├── db/migrations/               # esquema versionado, índices HNSW e GIN
├── src/
│   ├── domain/                  # entidades e regra de chunking, sem I/O
│   ├── application/             # casos de uso, portas e políticas de resposta
│   ├── infrastructure/          # adaptadores de provedores, LangGraph e pgvector
│   ├── interfaces/              # adaptadores de entrada: HTTP Fastify e CLI
│   ├── bootstrap.ts             # composição das dependências concretas
│   └── server.ts                # inicialização e desligamento da API
├── web/                          # React, TypeScript, Tailwind, Zod e React Query
└── README.md
```

### Clean Architecture no backend

```text
HTTP / CLI  →  casos de uso  →  portas  ←  Ollama / OpenRouter / Bedrock / PostgreSQL
                  ↑
               domínio
```

- `domain` não conhece bibliotecas, banco, HTTP ou AWS.
- `application` implementa ingestão, busca, Q&A e a avaliação determinística do golden set; ela depende apenas de portas.
- `infrastructure` implementa essas portas com Ollama, OpenRouter, Bedrock, LangGraph, LangSmith e pgvector.
- `interfaces` traduz HTTP e CLI para os casos de uso, sem lógica de RAG.
- `bootstrap.ts` é o único lugar que junta implementações concretas. Assim, trocar Bedrock por Ollama não exige alterar os casos de uso nem a API.
- A política de resposta fica centralizada em `application/policies`, evitando que cada provedor de LLM tenha um prompt de segurança diferente.

## Pré-requisitos

- Node.js 22+ e Docker Desktop. Node 20 executa o MVP, mas ferramentas futuras como Promptfoo requerem Node mais recente.
- Para o caminho local: [Ollama](https://ollama.com/) em execução e os modelos indicados abaixo.
- Para OpenRouter: uma chave de API; o custo e disponibilidade dependem do modelo selecionado.
- Para Bedrock: conta AWS, AWS CLI configurado (`aws configure` ou `aws sso login`), acesso aos modelos escolhidos e `bedrock:InvokeModel` restrito aos ARNs necessários.

As APIs `InvokeModel` e `Converse` são as APIs usadas pelo código; a segunda fornece uma interface comum de mensagens para modelos que a suportam. Veja a documentação da AWS sobre [InvokeModel](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-api.html) e [Converse](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-runtime/command/ConverseCommand/).

## Subir localmente

```bash
docker compose up -d db
cp .env.example .env
npm install
npm run db:migrate
```

Para o caminho local padrão, em outro terminal instale/inicie o Ollama e baixe uma vez os modelos:

```bash
ollama pull mxbai-embed-large
ollama pull llama3.2
```

Depois inicie a API:

```bash
npm run dev:api
```

Em outro terminal, abra a interface web:

```bash
npm run dev:web
```

Abra `http://localhost:5173`. O Vite direciona chamadas à API em `http://localhost:3000`; não há CORS ou chave expostos no navegador. Confira a aplicação também por HTTP:

```bash
curl http://localhost:3000/health
```

Se utilizar Bedrock, altere `EMBEDDING_PROVIDER=bedrock` e/ou `CHAT_PROVIDER=bedrock` no `.env`. Se utilizar um perfil AWS diferente do padrão, altere `AWS_PROFILE` no `.env` ou exporte-o na sessão. O SDK usa a cadeia padrão de credenciais da AWS; não coloque `AWS_ACCESS_KEY_ID` ou `AWS_SECRET_ACCESS_KEY` no repositório.

### OpenRouter: quando faz sentido

Sim, OpenRouter faz sentido para **experimentação**: você pode trocar o modelo de resposta sem reescrever os adaptadores, comparar custo/qualidade e manter uma chave fora do frontend. Para usar, adicione `OPENROUTER_API_KEY` ao `.env` e selecione `openrouter` somente no papel que deseja trocar:

```dotenv
CHAT_PROVIDER=openrouter
# ou EMBEDDING_PROVIDER=openrouter
OPENROUTER_API_KEY=...
```

Para aprender retrieval, comece com o mesmo modelo de embedding local para documento e consulta. Só troque o embedding após decidir a dimensão, recriar/reindexar a coleção e medir o golden set. Não misture vetores de modelos diferentes na mesma coluna. OpenRouter usa APIs compatíveis com OpenAI para [chat completions](https://openrouter.ai/docs/api-reference/chat-completion) e [embeddings](https://openrouter.ai/docs/api-reference/embeddings); consulte o catálogo antes de fixar um modelo, pois preço e disponibilidade mudam.

### Reranking opcional com Jina

O reranker é um segundo estágio: o banco primeiro busca candidatos baratos com RRF; um modelo especializado então lê a pergunta e cada candidato para ordenar os mais relevantes. Por padrão ele está desligado (`RERANKER_PROVIDER=none`), mantendo o caminho totalmente local. Para comparar qualidade/custo, configure Jina somente no backend:

```dotenv
RERANKER_PROVIDER=jina
JINA_API_KEY=...
JINA_RERANKER_MODEL=jina-reranker-v2-base-multilingual
```

Com reranking ligado, para `topK=5` a aplicação busca até 20 candidatos híbridos, filtra chunks de alto risco antes da chamada externa e pede os cinco melhores ao reranker. O frontend exibirá o rank e o score de relevância retornados. Os documentos ainda podem conter dados confidenciais mesmo sem risco de injection: não envie conteúdo sensível a um provedor externo sem política, contrato e aprovação apropriados. A API Jina recebe `query`, `documents` e `top_n`, devolvendo resultados ordenados pelo score de relevância; confira a [referência oficial](https://docs.jina.ai/).

### LangGraph e LangSmith

`POST /v1/qa` passa por `LangGraphRagWorkflow`: `retrieve → prepare_context → generate_answer`, ou encerra com uma recusa quando nenhum score supera `RAG_MINIMUM_SCORE`. O grafo torna as etapas, tentativas de retrieval e futuras ramificações (reranking, aprovação humana, ferramentas) visíveis no código.

Para enviar traces ao LangSmith, mantenha o conteúdo enviado em mente e habilite explicitamente:

```dotenv
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=rag-study-mvp
```

O tracing é desligado por padrão. A aplicação não exige LangSmith para funcionar localmente.

### Executar a primeira volta completa

Crie um arquivo de estudo simples fora do controle de versão, por exemplo `notes.md`, e indexe-o:

```bash
npm run ingest -- notes.md notes/estudo-rag
curl --get http://localhost:3000/v1/search --data-urlencode 'q=O que é busca semântica?'
curl -X POST http://localhost:3000/v1/qa \
  -H 'content-type: application/json' \
  -d '{"question":"Explique busca semântica usando apenas as minhas notas."}'
```

Há também um corpus e golden set pequenos, versionados para estudo:

```bash
npm run ingest -- examples/rag-fundamentals.md golden/rag-fundamentals
npm run eval:golden -- evals/golden-set.v1.json
```

O relatório mede `hitRate` (a fonte esperada apareceu no top-K?) e `MRR` (quão cedo ela apareceu). As metas vivem no JSON e o comando retorna código de erro se não forem atendidas, o que permite usá-lo depois em CI. Veja [evals/README.md](evals/README.md) para Ragas e Promptfoo.

Ou envie o documento diretamente:

```bash
curl -X POST http://localhost:3000/v1/documents \
  -H 'content-type: application/json' \
  -d '{
    "source":"https://example.test/rag-notes",
    "title":"Minhas notas sobre RAG",
    "text":"RAG combina recuperação de contexto com geração. Embeddings representam significado como vetores.",
    "metadata":{"subject":"rag"}
  }'
```

Reenviar o mesmo `source` substitui seus chunks em uma transação. Os embeddings são calculados antes da transação, portanto uma falha na AWS não apaga a versão anterior.

Para proteger a API local quando ela for exposta, defina `API_KEY` no `.env` e envie `-H 'x-api-key: ...'` em toda chamada. Nunca exponha este serviço diretamente à internet sem autenticação, limites de requisição, TLS e uma camada de autorização por documento/tenant.

### Demo pública de baixo custo

O projeto inclui um caminho de publicação com frontend estático, API e banco separados. A demo pública é somente leitura: `DEMO_MODE=true` oculta a ingestão no frontend e exige `x-admin-api-key` na API para alterar o corpus. Veja o guia completo em [docs/deploy-public-demo.md](docs/deploy-public-demo.md). O `render.yaml` e o `Dockerfile` deixam a API pronta para um deploy em container; mantenha chaves e URLs de banco apenas nas variáveis de ambiente do provedor.

## O que está acontecendo de verdade

### 1. Chunking

Um embedding representa um texto em tamanho limitado. Indexar o documento inteiro mistura assuntos, piora a recuperação e pode exceder o limite do modelo. `src/domain/chunk.ts` agrupa sentenças por **caracteres** (1.200 por padrão), preservando cerca de 200 caracteres ao cruzar a fronteira.

É uma escolha didática, não uma regra universal. Em produção, meça chunks em *tokens*, mantenha títulos/metadata junto do conteúdo, use separadores de estrutura (Markdown/HTML) e avalie tamanhos e overlaps com perguntas reais. Chunks menores melhoram precisão; maiores carregam mais contexto, mas também ruído e custo.

### 2. Embeddings e similaridade

O provedor configurado transforma texto em 1.024 números. Textos semanticamente relacionados ficam apontados para direções próximas no espaço vetorial. Titan usa `normalize: true`; outros provedores podem ter sua própria normalização. A similaridade cosseno compara direção:

```text
cosine_similarity(a, b) = (a · b) / (||a|| × ||b||)
```

No SQL, `<=>` é a **distância cosseno**; portanto o código retorna `1 - distância` como `score` e ordena a menor distância primeiro. Scores são comparáveis sobretudo dentro do mesmo modelo, mesma normalização e corpus — não trate um corte fixo como verdade sem avaliação.

O embedding da consulta deve usar o mesmo modelo, dimensão e pré-processamento compatível com os chunks. Alterar dimensão exige uma migração/reindexação; misturar modelos no mesmo campo invalida a busca.

### 3. Índice vetorial

O esquema usa `HNSW` com `vector_cosine_ops`, apropriado para consultas aproximadas com boa latência e recall. Em uma base muito pequena, PostgreSQL pode escolher scan sequencial, que é correto e geralmente mais rápido. Ao crescer, compare recall contra uma busca exata e ajuste `hnsw.ef_search` com dados reais. Índices aproximados são uma troca explícita: menos latência/memória de consulta versus a possibilidade de não trazer o vizinho perfeito.

### 4. Retrieval e geração

`GET /v1/search` executa agora duas recuperações independentes:

1. **Semântica:** embedding da pergunta contra HNSW/pgvector; encontra significado semelhante, mesmo com palavras diferentes.
2. **Lexical:** a pergunta é reduzida aos seus termos relevantes e então passa por `websearch_to_tsquery('portuguese', pergunta)` contra um índice GIN/`tsvector`; favorece siglas, identificadores, nomes e termos exatos.

Os dois rankings não são somados por score bruto, pois cosseno e `ts_rank_cd` estão em escalas diferentes. Em vez disso, usamos Reciprocal Rank Fusion (RRF):

```text
RRF(documento) = Σ 1 / (RRF_K + posição_no_ranking)
```

Cada recuperador produz candidatos (`topK × multiplicador`); o RRF combina suas posições e devolve apenas o top-K final. Por padrão, `RRF_K=60` e ambos os multiplicadores são `4`. O campo `retrieval` de cada resultado mostra as posições de vetor/texto e o score RRF para estudo. O score principal continua sendo similaridade cosseno, pois o fluxo de segurança do Q&A usa esse valor para decidir se há contexto semântico suficiente.

O índice textual usa a configuração PostgreSQL `portuguese`, removendo stopwords e aplicando stemming às perguntas em português. Antes disso, uma pequena política de aplicação remove palavras funcionais comuns da consulta lexical; o embedding sempre recebe a pergunta original. Em produção com corpus multilíngue, guarde o idioma por documento e use um `tsvector`/índice apropriado para cada idioma. `POST /v1/qa` usa os chunks híbridos como contexto delimitado e instrui o modelo a responder somente a partir deles. A resposta devolve fontes, mas esse prompt não torna o modelo infalível: valide citações e faça avaliação automatizada antes de uso sério.

### 5. Reranking

RRF é excelente para montar uma lista de candidatos, mas ele não lê a pergunta e o trecho juntos. Quando `RERANKER_PROVIDER=jina`, `SearchDocumentsUseCase` pede mais candidatos ao repositório e a porta `Reranker` reordena somente os chunks considerados seguros. O adaptador Jina valida a resposta com Zod, preserva a correspondência pelo índice original e rejeita respostas com índices inválidos ou duplicados. `PassThroughReranker` mantém o mesmo contrato quando o recurso está desligado, sem rede nem custo.

## Testar e depurar

```bash
npm test
npm run typecheck
npm run eval:security -- evals/security/prompt-injection.v1.json
docker compose exec db psql -U rag -d rag -c 'SELECT source, count(*) FROM documents JOIN chunks ON documents.id = chunks.document_id GROUP BY source;'
```

Para entender a busca no banco, experimente o SQL abaixo depois de inserir um vetor válido:

```sql
SELECT content, 1 - (embedding <=> '[...]'::vector) AS score
FROM chunks
ORDER BY embedding <=> '[...]'::vector
LIMIT 5;
```

## Decisões e próximos experimentos

| Decisão do MVP | Por que | Próximo experimento |
| --- | --- | --- |
| Provedor intercambiável, 1.024 dimensões | Ollama local para estudo; OpenRouter/Bedrock para comparação | comparar embedding e dimensão após criar nova coluna/tabela e reindexar |
| pgvector no PostgreSQL | Pouca infraestrutura e SQL/metadata no mesmo lugar | Qdrant, Pinecone ou OpenSearch quando escala/filtros justificarem |
| HNSW + cosseno | Padrão prático para busca semântica | medir latência/recall contra busca exata |
| GIN + full-text search + RRF | Une termos exatos e significado sem comparar escalas incompatíveis | calibrar candidatos, idioma e `RRF_K` no golden set |
| Reranker opcional | Modelo especializado reordena candidatos antes do contexto | comparar precisão/latência/custo com o golden set |
| Chunker próprio por caracteres | Torna a mecânica fácil de observar | tokenizer + chunking estrutural por Markdown/HTML |
| Top-K sem reranker | Vertical slice curto e transparente | hybrid search (tsvector + vetor), filtros metadata e reranker |
| LangGraph para Q&A | Fluxo explícito, com ramificação por relevância e retries | streaming, reranker, histórico e aprovação humana |
| LangSmith opcional | Traces sem acoplar casos de uso ao SaaS | datasets, avaliadores LLM e observabilidade de produção |

## Limites de segurança e produção

Este é um MVP de estudo, mas já aplica algumas defesas úteis:

- A API e o PostgreSQL ficam ligados a `127.0.0.1` por padrão; expor `0.0.0.0` requer proxy reverso com TLS, autenticação e observabilidade.
- As entradas têm limites de tamanho e schemas Zod; SQL usa parâmetros; segredos ficam fora do repositório; CORS não é aberto; respostas recebem headers de não-cache, anti-frame e `nosniff`.
- Há rate limit por IP, com teto menor para Q&A. Ele é intencionalmente local/em memória neste MVP; em múltiplas réplicas use Redis e limite por identidade autenticada.
- Chamadas a provedores de IA têm timeout configurável; a pool PostgreSQL também limita o tempo de conexão. Isso reduz a retenção de recursos quando uma dependência fica indisponível.
- Chunks recebem uma classificação de risco no momento da ingestão. Chunks de risco **alto** são exibidos na busca para inspeção, mas são excluídos do contexto de Q&A. Dados antigos sem essa classificação falham fechados e precisam ser reindexados.
- Quando o reranker remoto está ligado, chunks de alto risco também são excluídos dessa chamada. Isso não é uma classificação de dados pessoais: decida quais documentos podem sair da sua infraestrutura antes de habilitar um provedor externo.
- O contexto que chega ao modelo é delimitado, escapado, sem `source` ou `title` controlados pelo usuário, e é marcado como material não confiável. As fontes devolvidas ao cliente são montadas pelo backend, nunca escolhidas pelo modelo.
- O MVP não dá ferramentas, acesso a rede ou permissões de escrita ao LLM. Se virar um agente, cada ferramenta deve validar autorização e argumentos fora do modelo e ações de alto impacto devem pedir aprovação humana.

### Prompt injection: o que isso cobre — e o que não cobre

O scanner detecta frases de override, pedido de segredo, alteração de papel, payload codificado e caracteres invisíveis em uma cópia normalizada do texto. Isso ajuda a bloquear ataques comuns, auditar decisões e reduzir exposição, mas **não prova segurança**: um atacante pode parafrasear, trocar de idioma ou usar uma técnica ainda não conhecida. O modelo também não é uma fronteira de autorização.

Por isso a defesa é em camadas: triagem e exclusão de risco alto, separação estrutural entre instruções e dados, mínimo privilégio, ausência de ferramentas neste fluxo, rate limiting e testes de regressão. Rode a suíte determinística abaixo sempre que mudar regras, modelo, prompt ou pipeline:

```bash
npm run eval:security -- evals/security/prompt-injection.v1.json
```

Acrescente casos benignos e casos de ataque encontrados no seu domínio; acompanhe também a taxa de falsos positivos. O guia de [segurança RAG da OWASP](https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html) recomenda escanear chunks antes de enviá-los ao contexto, e o guia de [prompt injection](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) ressalta que filtros de texto são apenas uma camada.

Para produção, ainda acrescente extração isolada de PDF/DOCX, autenticação por usuário/tenant em todas as queries, filtros de metadados obrigatórios, criptografia e segredos gerenciados, políticas IAM mínimas, retenção/exclusão de dados, logging estruturado sem conteúdo sensível, alertas, red team contínuo e revisão humana antes de operações irreversíveis.

## Limpeza

```bash
docker compose down
```

Isso preserva os dados no volume `postgres_data`. Para removê-lo intencionalmente também, execute `docker compose down -v`.
