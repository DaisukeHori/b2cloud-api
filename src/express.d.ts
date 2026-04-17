import type { B2Session } from './types';

declare global {
  namespace Express {
    interface Request {
      b2session?: B2Session;
    }
  }
}
