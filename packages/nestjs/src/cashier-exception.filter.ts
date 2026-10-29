import { ArgumentsHost, Catch, ExceptionFilter, Inject } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { CashierError, toHttpError } from '@aios-inc/cashier';

@Catch(CashierError)
export class CashierExceptionFilter implements ExceptionFilter<CashierError> {
  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
  ) {}

  catch(error: CashierError, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw error;

    const { status, body } = toHttpError(error);

    this.adapterHost.httpAdapter.reply(
      host.switchToHttp().getResponse(),
      body,
      status,
    );
  }
}
