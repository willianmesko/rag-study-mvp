import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { tap } from "rxjs";
/** Bridge existing JSON/binary/SSE handlers without sending a completed reply twice. */
@Injectable()
export class HttpReplyInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler) {
        const reply = context.switchToHttp().getResponse<FastifyReply>();
        return next.handle().pipe(tap((value: unknown) => {
            if (!reply.sent)
                reply.send(value);
        }));
    }
}
