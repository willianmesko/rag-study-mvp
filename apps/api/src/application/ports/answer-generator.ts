export interface AnswerGenerator {
  generate(question: string, context: string): Promise<string>;
}

