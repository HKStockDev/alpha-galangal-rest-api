import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { RequestUser } from '../decorators/current-user.decorator';

export type RequestWithUser = Request & { user: RequestUser };

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as RequestWithUser).user;
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }
    if (!user.isPlatformAdmin) {
      throw new ForbiddenException('Platform admin access required');
    }
    return true;
  }
}
