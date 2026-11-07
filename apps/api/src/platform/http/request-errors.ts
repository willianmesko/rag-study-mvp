type RequestFailure = { status: number; body: { code: string; error: string } };

// Only known framework failures get a public 4xx response. Never relay an
// arbitrary provider/database status or message through the HTTP boundary.
const frameworkFailures = new Map<string, RequestFailure>([
  ["FST_ERR_CTP_INVALID_JSON_BODY", { status: 400, body: { code: "invalid_json", error: "Send a valid JSON request." } }],
  ["FST_ERR_CTP_EMPTY_JSON_BODY", { status: 400, body: { code: "invalid_json", error: "Send a valid JSON request." } }],
  ["FST_ERR_CTP_INVALID_CONTENT_LENGTH", { status: 400, body: { code: "invalid_request", error: "Invalid request length." } }],
  ["FST_ERR_CTP_INVALID_MEDIA_TYPE", { status: 415, body: { code: "unsupported_media_type", error: "This content type is not supported." } }],
  ...["FST_ERR_CTP_BODY_TOO_LARGE", "FST_REQ_FILE_TOO_LARGE", "FST_FILES_LIMIT", "FST_FIELDS_LIMIT", "FST_PARTS_LIMIT"]
    .map((code): [string, RequestFailure] => [code, { status: 413, body: { code: "request_too_large", error: "The request exceeds the allowed size." } }]),
]);

export function frameworkRequestFailure(error: unknown): RequestFailure | undefined {
  if (typeof error !== "object" || error === null || !("code" in error) || typeof error.code !== "string") return;
  if (error.code === "rate_limit_exceeded" && "statusCode" in error && error.statusCode === 429)
    return { status: 429, body: { code: "rate_limit_exceeded", error: "Too many requests. Try again later." } };
  return frameworkFailures.get(error.code);
}

export function isWorkspaceSlugConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505"
    && "constraint" in error && error.constraint === "tenants_slug_key";
}
