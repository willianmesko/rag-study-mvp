export interface AnswerGenerator {
  generate(question: string, context: string, signal?: AbortSignal): Promise<string>;
  stream?(question: string, context: string, onDelta: (delta: string) => void | Promise<void>, signal?: AbortSignal): Promise<string>;
}

