import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

export function createBedrockClient(region: string): BedrockRuntimeClient {
  return new BedrockRuntimeClient({ region, maxAttempts: 5, retryMode: "adaptive" });
}

