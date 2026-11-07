import { assessPromptInjection } from "../../dist/platform/security/prompt-injection.js";

export default class SecurityScannerProvider {
  id() {
    return "rag-security-scanner";
  }

  async callApi(prompt) {
    return {
      output: JSON.stringify(assessPromptInjection(prompt)),
      tokenUsage: { prompt: 0, completion: 0, total: 0 }
    };
  }
}
