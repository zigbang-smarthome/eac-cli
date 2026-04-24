export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class ApiError extends Error {
  readonly namedServiceId: string;
  readonly status: number;
  readonly responseBody: string;
  constructor(namedServiceId: string, status: number, message: string, responseBody: string) {
    super(`${namedServiceId} (${status}): ${message}`);
    this.name = "ApiError";
    this.namedServiceId = namedServiceId;
    this.status = status;
    this.responseBody = responseBody;
  }
}
