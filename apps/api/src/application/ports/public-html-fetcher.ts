export interface PublicHtmlFetcher {
  fetch(url: string): Promise<{ url: string; filename: string; payload: Buffer }>;
}

const errorMessages = {
  invalid_url: "Enter a valid HTTPS URL without credentials or a custom port.",
  unsafe_destination: "The URL must point to a public website.",
  dns_failed: "The website could not be resolved to a public IPv4 address.",
  redirect_limit: "The website exceeded the redirect limit.",
  fetch_failed: "The website could not be downloaded.",
  unsupported_content_type: "The URL must return an HTML page.",
  response_too_large: "The page exceeds the download size limit.",
  invalid_encoding: "The page must be uncompressed and use UTF-8.",
  fetch_timeout: "The website exceeded the download time limit."
} as const;

export type PublicHtmlFetchErrorCode = keyof typeof errorMessages;

export class PublicHtmlFetchError extends Error {
  constructor(public readonly code: PublicHtmlFetchErrorCode) {
    super(errorMessages[code]);
    this.name = "PublicHtmlFetchError";
  }
}
