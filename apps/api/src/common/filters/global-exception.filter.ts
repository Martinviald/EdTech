import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import type { JwtPayload } from '../../auth/jwt-payload.types';
import { reportServerError } from '../observability/report-error';

type RequestWithUser = {
  method: string;
  url: string;
  user?: JwtPayload;
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const request = ctx.getRequest<RequestWithUser>();
    reportServerError(exception, {
      method: request.method,
      url: request.url,
      userId: request.user?.userId,
      orgId: request.user?.orgId,
    });

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
  }
}
