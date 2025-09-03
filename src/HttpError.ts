class HttpError extends Error {
  status: number | null;
  url: string | null;
  details: any;

  constructor(err: any) {
    super(err.message || "Unknown API error");
    this.name = "HttpError";
    this.status = err.status || null;
    this.url = err.response?.request?.url || null;
    this.details = err.response?.body || null;
  }
}

export function simplifySuperagentError(err: any): HttpError {
  if (!err) {
    return new HttpError({ message: "Unknown error" });
  }
  return new HttpError(err);
}

export function isSuperAgentError(err: any): boolean {
  return (
    err && typeof err === "object" && ("status" in err || "response" in err)
  );
}
