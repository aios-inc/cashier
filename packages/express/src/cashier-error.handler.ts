import type { ErrorRequestHandler } from 'express';
import { CashierError, toHttpError } from '@aios-inc/cashier';

export const cashierErrorHandler =
  (): ErrorRequestHandler => (error, _req, res, next) => {
    if (!(error instanceof CashierError) || res.headersSent) {
      next(error);

      return;
    }

    const { status, body } = toHttpError(error);

    res.status(status).json(body);
  };
