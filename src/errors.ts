/** Raised when the Blue Reacher API returns a non-2xx response. */
export class BlueReacherError extends Error {
  /** HTTP status code. */
  readonly status: number;
  /** Machine-readable error code from the API, when present. */
  readonly code?: string;
  /** A hint from the API on how to resolve the error, when present. */
  readonly help?: string;
  /** The parsed response body, when JSON. */
  readonly body?: unknown;

  constructor(
    message: string,
    status: number,
    opts: { code?: string; help?: string; body?: unknown } = {}
  ) {
    super(message);
    this.name = "BlueReacherError";
    this.status = status;
    this.code = opts.code;
    this.help = opts.help;
    this.body = opts.body;
    Object.setPrototypeOf(this, BlueReacherError.prototype);
  }
}
