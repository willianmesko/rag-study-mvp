export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiResponseError(response: Response,
  fallback = "The request could not be completed."): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object") return new ApiError(fallback, response.status);
  const error = "error" in body && typeof body.error === "string" ? body.error : undefined;
  const message = "message" in body && typeof body.message === "string" ? body.message : undefined;
  const code = "code" in body && typeof body.code === "string" && /^[a-z][a-z0-9_.:-]{0,79}$/i.test(body.code)
    ? body.code : undefined;
  return new ApiError(error ?? message ?? fallback, response.status, code);
}
