import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Request } from 'express';
import { AuthService } from '../../auth/auth.service';
import { RequestUser } from '../../auth/decorators/current-user.decorator';

export type RequestWithUser = Request & { user: RequestUser };

@Injectable()
export class OrgAdminGuard implements CanActivate {
  private adminClient: SupabaseClient | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (url && (serviceRoleKey || anonKey)) {
      this.adminClient = createClient(url, serviceRoleKey ?? anonKey!);
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as RequestWithUser).user;
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (user.isPlatformAdmin) {
      return true;
    }

    const orgId = request.params['organizationId'];
    if (!orgId) {
      throw new ForbiddenException('Organization ID required');
    }

    if (!this.adminClient) {
      throw new ForbiddenException('Service unavailable');
    }

    const { data, error } = await this.adminClient
      .from('organization_memberships')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .eq('role', 'org_admin')
      .eq('status', 'active')
      .maybeSingle();

    if (error || !data) {
      throw new ForbiddenException('Organization admin access required');
    }

    return true;
  }
}
