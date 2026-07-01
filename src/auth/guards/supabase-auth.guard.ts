import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth.service';
import { RequestUser } from '../decorators/current-user.decorator';

export type RequestWithUser = Request & { user: RequestUser };

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;

    if (!token) {
      throw new UnauthorizedException('Missing or invalid authorization.');
    }

    const user = await this.authService.getUserFromToken(token);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token.');
    }

    (request as RequestWithUser).user = user;
    return true;
  }
}
