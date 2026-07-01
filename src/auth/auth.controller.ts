import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Request } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { EmailVerificationConfirmDto } from './dto/email-verification-confirm.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginResponseDto, MeResponseDto } from './dto/login-response.dto';
import { CurrentUser, RequestUser } from './decorators/current-user.decorator';
import { SupabaseAuthGuard } from './guards/supabase-auth.guard';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 5, ttl: 60000 } })
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 5, ttl: 60000 } })
  async register(@Body() dto: RegisterDto): Promise<LoginResponseDto> {
    return this.authService.register(dto.email, dto.password, dto.full_name);
  }

  @Post('email-verification/confirm')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 10, ttl: 60000 } })
  async confirmEmailVerification(
    @Body() dto: EmailVerificationConfirmDto,
  ): Promise<LoginResponseDto> {
    return this.authService.confirmEmailVerification(dto.token_hash.trim(), dto.type);
  }

  @Post('password-reset/request')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 5, ttl: 60000 } })
  async requestPasswordReset(
    @Req() req: Request,
    @Body() dto: PasswordResetRequestDto,
  ): Promise<{ message: string }> {
    const ip =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
        : undefined) ?? req.socket?.remoteAddress;
    this.logger.log(
      `password-reset/request: HTTP received maskedEmail=${AuthService.maskEmailForLogs(dto.email)} ip=${ip ?? 'unknown'}`,
    );
    return this.authService.requestPasswordReset(dto.email, ip);
  }

  @Post('password-reset/confirm')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 5, ttl: 60000 } })
  async confirmPasswordReset(
    @Req() req: Request,
    @Body() dto: PasswordResetConfirmDto,
  ): Promise<{ message: string }> {
    const ip =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
        : undefined) ?? req.socket?.remoteAddress;
    this.logger.log(
      `password-reset/confirm: HTTP received ip=${ip ?? 'unknown'} hasToken=${Boolean(dto.token)}`,
    );
    return this.authService.confirmPasswordReset(dto);
  }

  @Get('me')
  @UseGuards(SupabaseAuthGuard)
  async me(
    @Req() req: Request,
    @CurrentUser() user: RequestUser,
  ): Promise<MeResponseDto> {
    const raw = req.headers.authorization;
    const token =
      typeof raw === 'string' && raw.startsWith('Bearer ') ? raw.slice(7) : '';
    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }
    return this.authService.buildMeResponse(token, user);
  }

  @Patch('me')
  @UseGuards(SupabaseAuthGuard)
  async updateMe(
    @Req() req: Request,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<MeResponseDto> {
    const raw = req.headers.authorization;
    const token =
      typeof raw === 'string' && raw.startsWith('Bearer ') ? raw.slice(7) : '';
    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }
    await this.authService.updateProfile(token, user.id, dto);
    return this.authService.buildMeResponse(token, user);
  }


  @Patch('me/password')
  @UseGuards(SupabaseAuthGuard)
  async changePassword(
    @Req() req: Request,
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const raw = req.headers.authorization;
    const token =
      typeof raw === 'string' && raw.startsWith('Bearer ') ? raw.slice(7) : '';
    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }
    return this.authService.changePassword(token, user, dto.current_password, dto.new_password);
  }

  @Post('me/avatar')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async uploadAvatar(
    @Req() req: Request,
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<MeResponseDto> {
    const raw = req.headers.authorization;
    const token =
      typeof raw === 'string' && raw.startsWith('Bearer ') ? raw.slice(7) : '';
    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }
    if (!file) {
      throw new BadRequestException('Missing file');
    }
    return this.authService.uploadAvatar(token, user, file);
  }

  @Delete('me/avatar')
  @UseGuards(SupabaseAuthGuard)
  async deleteAvatar(
    @Req() req: Request,
    @CurrentUser() user: RequestUser,
  ): Promise<MeResponseDto> {
    const raw = req.headers.authorization;
    const token =
      typeof raw === 'string' && raw.startsWith('Bearer ') ? raw.slice(7) : '';
    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }
    return this.authService.deleteAvatar(token, user);
  }
}
