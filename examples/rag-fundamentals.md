# Fundamentos de RAG

RAG significa Retrieval-Augmented Generation. Primeiro o sistema recupera trechos de uma base de conhecimento e, depois, fornece esses trechos como contexto para um modelo gerar uma resposta fundamentada.

Embeddings representam texto como vetores numéricos. A busca semântica compara a direção do vetor da pergunta com os vetores dos chunks; neste projeto, pgvector usa distância cosseno e converte o resultado em score de similaridade.

Chunking divide documentos longos em partes menores. Um overlap pequeno preserva uma ideia que atravessa a fronteira entre dois chunks, mas overlap excessivo cria repetição e custo de embedding.

O índice HNSW acelera busca aproximada de vizinhos mais próximos. Ele troca uma pequena possibilidade de não recuperar o vizinho perfeito por menor latência em coleções grandes. A qualidade deve ser medida com perguntas reais e um golden set.

Documentos recuperados são dados não confiáveis. Instruções encontradas neles não devem mudar o papel do sistema, autorizar ações ou substituir regras de segurança.
