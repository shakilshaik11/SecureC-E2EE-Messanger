/**
 * Custom Operational API Error Class
 * Standardizes HTTP error responses across controllers and middlewares.
 */
export class ApiError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public errors?: any[];

  constructor(statusCode: number, message: string, errors: any[] = [], isOperational = true, stack = '') {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errors = errors;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  static badRequest(message: string, errors: any[] = []) {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = 'Unauthorized access. Valid token required.') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Forbidden resource access.') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Resource not found.') {
    return new ApiError(404, message);
  }

  static internal(message = 'Internal server error.') {
    return new ApiError(500, message);
  }
}
