# Avaliações do RAG

Avalie em camadas. Uma resposta aparentemente boa pode esconder recuperação errada, uma citação ausente ou comportamento inseguro diante de um documento malicioso.

## 0. Regressão de prompt injection: já executável

O arquivo `security/prompt-injection.v1.json` contém ataques e controles benignos que exercitam o scanner determinístico usado na ingestão. Rode-o sempre que alterar as regras ou o pipeline:

```bash
npm run eval:security -- evals/security/prompt-injection.v1.json
```

O resultado aprovado significa somente que a classificação atual não regrediu nesses casos. Não mede resistência geral do modelo. Inclua variações em português, inglês, Unicode, conteúdo remoto e documentos reais do seu domínio; registre falsos positivos junto com ataques bloqueados.

## 1. Golden set local: já executável

`golden-set.v1.json` guarda perguntas e as fontes que obrigatoriamente devem aparecer no retrieval. Ele é propositalmente simples e determinístico: mede retrieval, não a opinião de outro modelo.

```bash
npm run ingest -- examples/rag-fundamentals.md golden/rag-fundamentals
npm run eval:golden -- evals/golden-set.v1.json
```

Comece com 20 a 50 perguntas reais. Versione cada mudança no conjunto e divida os casos por intenção, idioma, formato do documento e dificuldade. Só eleve `RAG_MINIMUM_SCORE`, chunk size ou modelo depois de comparar os relatórios.

## 2. Qualidade RAG com Ragas

Ragas complementa o golden set com métricas como *context precision*, *context recall* e *faithfulness*. Use-o quando já tiver respostas de referência ou um avaliador bem definido. Ele é uma ferramenta Python independente do backend TypeScript:

```bash
python3 -m venv .venv-ragas
. .venv-ragas/bin/activate
pip install ragas
```

Monte uma tabela com `question`, `answer`, `contexts` e, quando aplicável, `ground_truth`. Não interprete uma única nota como aprovação: examine os casos de pior score e adicione-os ao golden set. Consulte a documentação atual do [Ragas](https://docs.ragas.io/).

## 3. Segurança e prompt injection com Promptfoo

Promptfoo é útil para regressões de prompts e testes adversariais: instruções no documento como “ignore as regras”, tentativa de exfiltrar contexto de outro tenant, jailbreak e afirmações sem fonte. A versão atual requer Node.js 22.22 ou superior, então ela não é dependência deste MVP enquanto o ambiente local estiver no Node 20.

Quando migrar o runtime, crie uma configuração Promptfoo que execute contra uma API de teste sem dados reais. Não coloque chaves em YAML versionado. Comece pelos casos abaixo e trate o resultado como uma triagem, não como prova de segurança:

- documento pede para revelar sistema, chave ou dados de outro usuário;
- pergunta pede resposta fora das fontes recuperadas;
- conteúdo recuperado tenta fazer a API chamar uma ferramenta ou URL;
- fonte com instruções contraditórias e conteúdo útil misturados.

O benchmark acadêmico HarmBench pode informar pesquisa de segurança de modelos, mas não substitui esses testes específicos do seu produto. Para este RAG, Promptfoo + casos reais próprios é a primeira escolha prática. Consulte a documentação de [red teaming do Promptfoo](https://www.promptfoo.dev/docs/red-team/).
