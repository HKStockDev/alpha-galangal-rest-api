import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient, User as SupabaseUser, type EmailOtpType } from '@supabase/supabase-js';
import { maskEmailForLogs } from '../email/email-log.util';
import { SupabaseClientProvider } from '../supabase/supabase.provider';
import { AuthEmailService } from './auth-email.service';
import { LoginResponseDto, MeResponseDto } from './dto/login-response.dto';
import { DEFAULT_FRONTEND_BASE_URL } from '../config/app-urls';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { RequestUser } from './decorators/current-user.decorator';

const GENERIC_LOGIN_ERROR = 'Invalid email or password.';
const PASSWORD_RESET_GENERIC_ERROR =
  'Password reset failed. The link may have expired. Request a new reset email.';
const PASSWORD_RESET_REQUEST_GENERIC_SUCCESS =
  'If an account exists for that email, you will receive password reset instructions shortly.';
const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;
const EMAIL_VERIFICATION_REQUIRED_MESSAGE =
  'Account created. Check your email to verify your account, then sign in.';

interface PasswordResetTokenRow {
  id: string;
  user_id: string;
  email: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** For logs only; avoids storing full addresses in log aggregators. */
  static maskEmailForLogs(email: string): string {
    return maskEmailForLogs(email);
  }


  constructor(
    private readonly supabase: SupabaseClientProvider,
    private readonly config: ConfigService,
    private readonly authEmailService: AuthEmailService,
  ) {}

  private userScopedClient(accessToken: string): SupabaseClient {
    const url = this.config.getOrThrow<string>('supabase.url');
    const anonKey = this.config.getOrThrow<string>('supabase.anonKey');
    return createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }

  private getPasswordResetRedirectUrl(): string {
    const raw =
      this.config.get<string>('invitations.frontendUrl') ?? DEFAULT_FRONTEND_BASE_URL;
    const base = raw.replace(/\/$/, '');
    return `${base}/reset-password/confirm`;
  }

  private getEmailVerificationRedirectUrl(email: string): string {
    const raw =
      this.config.get<string>('invitations.frontendUrl') ?? DEFAULT_FRONTEND_BASE_URL;
    const base = raw.replace(/\/$/, '');
    const params = new URLSearchParams({ email: email.trim().toLowerCase() });
    return `${base}/auth/callback?${params.toString()}`;
  }

  private getAdminClient(): SupabaseClient {
    const url = this.config.getOrThrow<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    if (!serviceRoleKey) {
      throw new ServiceUnavailableException(
        'SUPABASE_SERVICE_ROLE_KEY is required for password reset.',
      );
    }
    return createClient(url, serviceRoleKey);
  }

  private buildPasswordResetUrl(rawToken: string): string {
    const base = this.getPasswordResetRedirectUrl();
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}token=${encodeURIComponent(rawToken)}`;
  }

  private async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    await this.authEmailService.sendPasswordResetEmail(
      to,
      resetUrl,
      PASSWORD_RESET_TOKEN_TTL_MINUTES,
    );
  }

  private isEmailVerified(user: Pick<SupabaseUser, 'email_confirmed_at'>): boolean {
    return user.email_confirmed_at != null;
  }

  private async loadRequestUser(
    accessToken: string,
    userId: string,
    email: string,
  ): Promise<RequestUser> {
    const authClient = this.userScopedClient(accessToken);
    const { data: profile } = await authClient
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', userId)
      .maybeSingle();

    return {
      id: userId,
      email,
      isPlatformAdmin: profile?.is_platform_admin ?? false,
    };
  }

  async login(email: string, password: string): Promise<LoginResponseDto> {
    try {
      const client = this.supabase.getClient();
      const { data, error } = await client.auth.signInWithPassword({ email, password });

      if (error || !data.session) {
        throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
      }

      const { session } = data;
      const user = session.user;
      const expiresAt = session.expires_at
        ? session.expires_at
        : Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);

      const requestUser = await this.loadRequestUser(
        session.access_token,
        user.id,
        user.email ?? '',
      );

      return {
        access_token: session.access_token,
        refresh_token: session.refresh_token ?? undefined,
        expires_at: expiresAt,
        user: {
          id: requestUser.id,
          email: requestUser.email,
          is_platform_admin: requestUser.isPlatformAdmin,
          email_verified: this.isEmailVerified(user),
        },
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(
        `Login failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Authentication service unavailable. Check backend logs and Supabase configuration.',
      );
    }
  }


  async changePassword(
    _accessToken: string,
    user: RequestUser,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must be different from current password.');
    }

    const client = this.supabase.getClient();
    const { error: signInError } = await client.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (signInError) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const adminClient = this.getAdminClient();
    const { error: updateError } = await adminClient.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });

    if (updateError) {
      throw new BadRequestException(updateError.message);
    }

    await this.authEmailService.sendPasswordChangedEmail(user.email, new Date());

    return { message: 'Password updated successfully.' };
  }

  async getUserFromToken(accessToken: string): Promise<RequestUser | null> {
    const authClient = this.userScopedClient(accessToken);
    const {
      data: { user },
      error,
    } = await authClient.auth.getUser(accessToken);

    if (error || !user) {
      return null;
    }

    return this.loadRequestUser(accessToken, user.id, user.email ?? '');
  }

  async buildMeResponse(
    accessToken: string,
    user: RequestUser,
  ): Promise<MeResponseDto> {
    const c = this.userScopedClient(accessToken);
    const [{ data: profile }, { data: authData }] = await Promise.all([
      c.from('profiles').select('full_name, avatar_url').eq('id', user.id).maybeSingle(),
      c.auth.getUser(accessToken),
    ]);
    const authUser = authData.user;
    return {
      id: user.id,
      email: user.email,
      is_platform_admin: user.isPlatformAdmin,
      full_name: profile?.full_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
      email_verified: authUser ? this.isEmailVerified(authUser) : false,
    };
  }

  private async syncProfileAfterSignup(
    userId: string,
    email: string,
    fullName: string | undefined,
    accessToken: string | null,
  ): Promise<void> {
    const url = this.config.getOrThrow<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const row = {
      id: userId,
      email,
      full_name: fullName?.trim() ? fullName.trim() : null,
      status: 'active' as const,
    };

    if (serviceRoleKey) {
      const admin = createClient(url, serviceRoleKey);
      const { error } = await admin.from('profiles').upsert(row, { onConflict: 'id' });
      if (error) {
        this.logger.warn(`Profile upsert (service role): ${error.message}`);
      }
      return;
    }

    if (accessToken) {
      const c = this.userScopedClient(accessToken);
      const { error } = await c.from('profiles').upsert(row, { onConflict: 'id' });
      if (error) {
        this.logger.warn(`Profile upsert (session): ${error.message}`);
      }
    }
  }

  async register(
    email: string,
    password: string,
    fullName?: string,
  ): Promise<LoginResponseDto> {
    try {
      const client = this.supabase.getClient();
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: this.getEmailVerificationRedirectUrl(email),
          data: fullName?.trim() ? { full_name: fullName.trim() } : undefined,
        },
      });

      if (error) {
        const msg = error.message ?? 'Registration failed';
        if (
          msg.toLowerCase().includes('signups not allowed') ||
          msg.toLowerCase().includes('signup not allowed')
        ) {
          throw new BadRequestException(
            'New sign-ups are now allowed right now. Please contact to the administrator to get an invite.',
          );
        }
        throw new BadRequestException(msg);
      }
      if (!data.user) {
        throw new ServiceUnavailableException('Registration failed');
      }

      await this.syncProfileAfterSignup(
        data.user.id,
        email,
        fullName,
        data.session?.access_token ?? null,
      );

      if (!data.session || !this.isEmailVerified(data.user)) {
        throw new BadRequestException(EMAIL_VERIFICATION_REQUIRED_MESSAGE);
      }

      const { session } = data;
      const user = session.user;
      const expiresAt = session.expires_at
        ? session.expires_at
        : Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);

      const requestUser = await this.loadRequestUser(
        session.access_token,
        user.id,
        user.email ?? email,
      );

      return {
        access_token: session.access_token,
        refresh_token: session.refresh_token ?? undefined,
        expires_at: expiresAt,
        user: {
          id: requestUser.id,
          email: requestUser.email,
          is_platform_admin: requestUser.isPlatformAdmin,
          email_verified: this.isEmailVerified(user),
        },
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(
        `Register failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Registration service unavailable. Check backend logs and Supabase configuration.',
      );
    }
  }

  async confirmEmailVerification(
    tokenHash: string,
    type: EmailOtpType,
  ): Promise<LoginResponseDto> {
    const GENERIC_ERROR =
      'Email verification failed. The link may have expired — register again or request a new verification email.';

    try {
      const client = this.supabase.getClient();
      const { data, error } = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });

      if (error) {
        this.logger.warn(`email-verification/confirm: verifyOtp failed: ${error.message}`);
        throw new BadRequestException(GENERIC_ERROR);
      }

      const session = data.session;
      const user = session?.user ?? data.user;
      if (!session || !user) {
        throw new BadRequestException(GENERIC_ERROR);
      }

      const expiresAt = session.expires_at
        ? session.expires_at
        : Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);

      const requestUser = await this.loadRequestUser(
        session.access_token,
        user.id,
        user.email ?? '',
      );

      return {
        access_token: session.access_token,
        refresh_token: session.refresh_token ?? undefined,
        expires_at: expiresAt,
        user: {
          id: requestUser.id,
          email: requestUser.email,
          is_platform_admin: requestUser.isPlatformAdmin,
          email_verified: this.isEmailVerified(user),
        },
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(
        `email-verification/confirm failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Email verification service unavailable. Check backend logs and Supabase configuration.',
      );
    }
  }

  async updateProfile(
    accessToken: string,
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<{
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  }> {
    if (dto.full_name === undefined) {
      throw new BadRequestException('No profile fields to update');
    }

    const c = this.userScopedClient(accessToken);
    const { error: updErr } = await c
      .from('profiles')
      .update({ full_name: dto.full_name.trim() ? dto.full_name.trim() : null })
      .eq('id', userId);

    if (updErr) {
      throw new BadRequestException(updErr.message);
    }

    const { data, error } = await c
      .from('profiles')
      .select('id, email, full_name, avatar_url')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw new BadRequestException(error?.message ?? 'Profile not found');
    }

    return data as {
      id: string;
      email: string;
      full_name: string | null;
      avatar_url: string | null;
    };
  }

  private static readonly AVATAR_ALLOWED_MIME = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ]);

  private static readonly AVATAR_MAX_BYTES = 2 * 1024 * 1024;

  private avatarObjectPath(userId: string): string {
    return `${userId}/avatar`;
  }

  async uploadAvatar(
    accessToken: string,
    user: RequestUser,
    file: Express.Multer.File,
  ): Promise<MeResponseDto> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }
    if (file.size > AuthService.AVATAR_MAX_BYTES) {
      throw new BadRequestException('Image must be 2MB or smaller');
    }
    if (!AuthService.AVATAR_ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        'Use a JPEG, PNG, WebP, or GIF image',
      );
    }

    const admin = this.getAdminClient();
    const objectPath = this.avatarObjectPath(user.id);
    const { error: upErr } = await admin.storage
      .from('avatars')
      .upload(objectPath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (upErr) {
      this.logger.warn(`avatar upload storage: ${upErr.message}`);
      throw new BadRequestException('Could not store image');
    }

    const { data: pub } = admin.storage.from('avatars').getPublicUrl(objectPath);
    const base = pub.publicUrl;
    const sep = base.includes('?') ? '&' : '?';
    // Same storage path reuses the public URL string; browsers cache by URL — bump query so UI reloads.
    const publicUrl = `${base}${sep}t=${Date.now()}`;

    const c = this.userScopedClient(accessToken);
    const { error: updErr } = await c
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', user.id);

    if (updErr) {
      this.logger.warn(`avatar upload profile: ${updErr.message}`);
      throw new BadRequestException(updErr.message);
    }

    return this.buildMeResponse(accessToken, user);
  }

  async deleteAvatar(
    accessToken: string,
    user: RequestUser,
  ): Promise<MeResponseDto> {
    const admin = this.getAdminClient();
    const objectPath = this.avatarObjectPath(user.id);
    const { error: rmErr } = await admin.storage
      .from('avatars')
      .remove([objectPath]);
    if (rmErr) {
      this.logger.warn(`avatar remove storage: ${rmErr.message}`);
    }

    const c = this.userScopedClient(accessToken);
    const { error: updErr } = await c
      .from('profiles')
      .update({ avatar_url: null })
      .eq('id', user.id);

    if (updErr) {
      throw new BadRequestException(updErr.message);
    }

    return this.buildMeResponse(accessToken, user);
  }

  async requestPasswordReset(
    email: string,
    requestIp?: string,
  ): Promise<{ message: string }> {
    const normalized = email.trim().toLowerCase();
    const masked = AuthService.maskEmailForLogs(normalized);
    const started = Date.now();

    try {
      const adminClient = this.getAdminClient();
      const { data: profile, error: profileError } = await adminClient
        .from('profiles')
        .select('id, email')
        .eq('email', normalized)
        .maybeSingle();

      if (profileError) {
        this.logger.error(`password-reset: profile lookup failed: ${profileError.message}`);
        throw new ServiceUnavailableException('Password reset service unavailable.');
      }

      if (!profile?.id) {
        this.logger.log(`password-reset: no user found maskedEmail=${masked}`);
        return { message: PASSWORD_RESET_REQUEST_GENERIC_SUCCESS };
      }

      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(
        Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000,
      ).toISOString();

      await adminClient
        .from('password_reset_tokens')
        .update({ consumed_at: new Date().toISOString() })
        .eq('user_id', profile.id)
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString());

      const { error: insertError } = await adminClient.from('password_reset_tokens').insert({
        user_id: profile.id,
        email: normalized,
        token_hash: tokenHash,
        expires_at: expiresAt,
        request_ip: requestIp ?? null,
      });

      if (insertError) {
        this.logger.error(`password-reset: token insert failed: ${insertError.message}`);
        throw new ServiceUnavailableException('Password reset service unavailable.');
      }

      const resetUrl = this.buildPasswordResetUrl(rawToken);
      await this.sendPasswordResetEmail(normalized, resetUrl);
      this.logger.log(
        `password-reset: email sent maskedEmail=${masked} elapsedMs=${Date.now() - started}`,
      );

      return { message: PASSWORD_RESET_REQUEST_GENERIC_SUCCESS };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `password-reset: request failed maskedEmail=${masked} elapsedMs=${Date.now() - started} err=${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new ServiceUnavailableException('Password reset service unavailable.');
    }
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto): Promise<{ message: string }> {
    const password = dto.new_password;
    const token = dto.token.trim();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const now = new Date().toISOString();

    try {
      const adminClient = this.getAdminClient();
      const { data: resetRow, error: tokenError } = await adminClient
        .from('password_reset_tokens')
        .select('id, user_id, email, token_hash, expires_at, consumed_at')
        .eq('token_hash', tokenHash)
        .is('consumed_at', null)
        .gt('expires_at', now)
        .maybeSingle<PasswordResetTokenRow>();

      if (tokenError) {
        this.logger.warn(`password-reset/confirm: token lookup failed: ${tokenError.message}`);
        throw new BadRequestException(PASSWORD_RESET_GENERIC_ERROR);
      }
      if (!resetRow) {
        throw new BadRequestException(PASSWORD_RESET_GENERIC_ERROR);
      }

      const { error: updErr } = await adminClient.auth.admin.updateUserById(resetRow.user_id, {
        password,
      });

      if (updErr) {
        this.logger.warn(`password-reset/confirm: updateUserById failed: ${updErr.message}`);
        throw new BadRequestException(PASSWORD_RESET_GENERIC_ERROR);
      }

      const { error: consumeError } = await adminClient
        .from('password_reset_tokens')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', resetRow.id);

      if (consumeError) {
        this.logger.warn(`password-reset/confirm: consume token failed: ${consumeError.message}`);
      }

      return { message: 'Password updated. You can sign in with your new password.' };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(
        `password-reset/confirm failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new BadRequestException(PASSWORD_RESET_GENERIC_ERROR);
    }
  }
}
