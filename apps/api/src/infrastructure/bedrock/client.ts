import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

export function createBedrockClient(region: string, maxAttempts = 1): BedrockRuntimeClient {
  return new BedrockRuntimeClient({ region, maxAttempts, retryMode: "adaptive" });
}

