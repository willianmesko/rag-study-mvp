export function toVectorLiteral(values: number[], expectedDimensions: number): string {
  if (values.length !== expectedDimensions) {
    throw new Error(`Expected ${expectedDimensions} embedding dimensions, received ${values.length}.`);
  }
  if (!values.every(Number.isFinite)) throw new Error("Embedding contains a non-finite number.");
  return `[${values.join(",")}]`;
}

