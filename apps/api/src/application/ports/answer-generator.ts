export interface AnswerGenerator {
  generate(question: string, context: string): Promise<string>;
  stream?(question: string, context: string, onDelta: (delta: string) => void | Promise<void>): Promise<string>;
}

