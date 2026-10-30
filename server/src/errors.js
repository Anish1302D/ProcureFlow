import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code ?? defaultCode(status);
    this.details = details;
  }
}

function defaultCode(status) {
  return {
    400: 'BAD_REQUEST',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
    422: 'UNPROCESSABLE',
    429: 'TOO_MANY_REQUESTS',
    503: 'SERVICE_UNAVAILABLE',
  }[status] ?? 'ERROR';
}

export const notFound = (what = 'Not found') => new HttpError(404, what);
export const forbidden = (why = 'You do not have permission to do that') => new HttpError(403, why);
export const conflict = (why) => new HttpError(409, why);
export const unprocessable = (why, details) => new HttpError(422, why, { details });

// SQLSTATEs raised by the database functions (db/README.md, "Error codes"),
// plus the standard ones a well-formed request can still trigger.
const PG_ERRORS = {
  SP001: [404, 'Request not found'],
  SP002: [409, 'This request has not been submitted yet'],
  SP003: [409, 'This request has already been decided'],
  SP004: [403, 'You are not authorised to act on this request at its current stage'],
  SP005: [422, 'That action cannot be taken at a review stage'],
  SP006: [422, 'This is the final stage; it cannot be escalated'],
  SP007: [422, 'A reason is required to reject'],
  SP008: [422, 'Select which items are approved'],
  SP009: [409, 'Workflow misconfigured: no stage above the current one'],
  SP010: [422, 'The decision refers to items that are not on this request'],
  SP011: [409, 'This request has already been submitted'],
  SP012: [422, 'No approval route is configured for this amount'],
  SP013: [403, 'The action does not match the signed-in user'],
  SP014: [409, 'This request cannot be carried forward'],
  SP015: [422, 'The target financial year must be later than the current one'],
  SP016: [409, 'A request cannot move past the Principal without the Principal\'s decision'],
  SP017: [409, 'This request is waiting for the requester to correct and resubmit it'],
  SP018: [409, 'This request has not been returned for correction, so it cannot be resubmitted'],
  ST001: [404, 'Invalid or unknown setup token'],
  ST002: [400, 'This setup link has already been used'],
  ST003: [400, 'This setup link has expired. Please contact your administrator.'],
  23505: [409, 'That record already exists'],
  23503: [422, 'A referenced record does not exist'],
  23514: [422, 'A value is outside its allowed range'],
  23502: [422, 'A required value is missing'],
  '22P02': [400, 'Malformed value'],
  42501: [403, 'You do not have permission to do that'],
};

function fromPostgres(err) {
  const mapped = PG_ERRORS[err.code];
  if (!mapped) return null;
  const [status, message] = mapped;
  // The constraint name tells the client which field was rejected without
  // exposing the SQL. Nothing else from the driver error is forwarded.
  const details = err.constraint ? { constraint: err.constraint } : undefined;
  return new HttpError(status, message, { code: err.code, details });
}

export function errorHandler(err, req, res, _next) {
  let httpErr;

  if (err instanceof HttpError) {
    httpErr = err;
  } else if (err instanceof ZodError) {
    httpErr = new HttpError(422, 'Validation failed', {
      code: 'VALIDATION',
      details: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  } else if (err.type === 'entity.parse.failed') {
    httpErr = new HttpError(400, 'Request body is not valid JSON');
  } else if (err.type === 'entity.too.large') {
    httpErr = new HttpError(413, 'Request body is too large');
  } else if (err.name === 'MulterError') {
    httpErr = err.code === 'LIMIT_FILE_SIZE'
      ? new HttpError(413, 'File is too large')
      : new HttpError(400, 'Invalid upload');
  } else {
    httpErr = fromPostgres(err);
  }

  if (!httpErr) {
    const sanitizedUrl = req.originalUrl ? req.originalUrl.replace(/([?&]token=)[^&]+/gi, '$1[REDACTED]') : '';
    console.error(`[${req.method} ${sanitizedUrl}]`, err);
    httpErr = new HttpError(500, 'Something went wrong', { code: 'INTERNAL' });
  }

  res.status(httpErr.status).json({
    error: {
      code: httpErr.code,
      message: httpErr.message,
      ...(httpErr.details ? { details: httpErr.details } : {}),
    },
  });
}
