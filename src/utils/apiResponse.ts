/**
 * Standardized API Response Helper Class
 * Formats all successful controller JSON responses consistently.
 */
export class ApiResponse<T> {
  public statusCode: number;
  public success: boolean;
  public message: string;
  public data?: T;

  constructor(statusCode: number, message: string, data?: T) {
    this.statusCode = statusCode;
    this.success = statusCode < 400;
    this.message = message;
    if (data !== undefined) {
      this.data = data;
    }
  }

  static success<T>(data: T, message = 'Success', statusCode = 200): ApiResponse<T> {
    return new ApiResponse(statusCode, message, data);
  }

  static created<T>(data: T, message = 'Resource created successfully'): ApiResponse<T> {
    return new ApiResponse(201, message, data);
  }
}
