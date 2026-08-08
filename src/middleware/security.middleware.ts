import { Request, Response, NextFunction } from 'express';

/**
 * NoSQL Injection & Input Sanitization Guard
 * Prevents operators like $gt, $ne, or script tags in incoming request bodies or query params.
 */
export const sanitizeInput = (req: Request, _res: Response, next: NextFunction): void => {
  const sanitize = (obj: any): any => {
    if (typeof obj === 'string') {
      // Strip dangerous HTML/script tags for XSS protection
      return obj.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const key of Object.keys(obj)) {
        if (key.startsWith('$') || key.includes('.')) {
          delete obj[key]; // Strip dangerous MongoDB operators
        } else {
          obj[key] = sanitize(obj[key]);
        }
      }
    }
    return obj;
  };

  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  if (req.params) req.params = sanitize(req.params);

  next();
};
