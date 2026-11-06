import { z } from "zod";

export const documentInputSchema = z.object({
  source: z.string().trim().min(3, "Informe uma origem para identificar o documento."),
  title: z.string().trim().max(500, "O título pode ter no máximo 500 caracteres.").optional(),
  text: z.string().trim().min(20, "Cole pelo menos 20 caracteres para indexar."),
  metadata: z.record(z.string(), z.unknown())
});

export const searchInputSchema = z.object({
  query: z.string().trim().min(3, "Escreva uma pergunta com pelo menos 3 caracteres."),
  topK: z.number().int().min(1).max(20)
});

export const questionInputSchema = z.object({
  question: z.string().trim().min(3, "Escreva uma pergunta com pelo menos 3 caracteres."),
  topK: z.number().int().min(1).max(20)
});

