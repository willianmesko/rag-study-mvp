import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

export function createBedrockClient(region: string, maxAttempts = 5): BedrockRuntimeClient {
  return new BedrockRuntimeClient({ region, maxAttempts, retryMode: "adaptive" });
}

