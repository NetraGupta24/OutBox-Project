export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, message, details);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const unauthorized = (message = 'Not signed in') => new HttpError(401, message);
