import { plainToInstance } from 'class-transformer';
import {
  IsBooleanString,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  ValidateIf,
  validateSync,
} from 'class-validator';

class EnvDto {
  @IsUrl()
  @IsNotEmpty()
  SUPABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  SUPABASE_ANON_KEY!: string;

  @IsOptional()
  @IsString()
  SUPABASE_JWT_SECRET?: string;

  @IsOptional()
  @IsString()
  GEMINI_API_KEY?: string;

  @IsOptional()
  @IsString()
  FMP_API_KEY?: string;

  @IsOptional()
  @IsString()
  MASSIVE_API_KEY?: string;

  @IsOptional()
  @IsString()
  API_GLOBAL_PREFIX?: string;

  @IsOptional()
  @IsString()
  @ValidateIf((_, value) => value != null && String(value).trim() !== '')
  @Matches(/^sk_(test|live)_/, {
    message: 'STRIPE_SECRET_KEY must start with sk_test_ or sk_live_',
  })
  STRIPE_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  @ValidateIf((_, value) => value != null && String(value).trim() !== '')
  @Matches(/^whsec_/, {
    message: 'STRIPE_WEBHOOK_SECRET must start with whsec_',
  })
  STRIPE_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @ValidateIf((_, value) => value != null && String(value).trim() !== '')
  STRIPE_CHECKOUT_SUCCESS_URL?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @ValidateIf((_, value) => value != null && String(value).trim() !== '')
  STRIPE_CHECKOUT_CANCEL_URL?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @ValidateIf((_, value) => value != null && String(value).trim() !== '')
  STRIPE_BILLING_PORTAL_RETURN_URL?: string;

  @IsOptional()
  @IsString()
  STRIPE_TRIAL_DAYS?: string;

  @IsOptional()
  @IsBooleanString()
  ASSISTANT_TYPESENSE_ENABLED?: string;

  @ValidateIf((o: EnvDto) =>
    o.ASSISTANT_TYPESENSE_ENABLED != null &&
    ['true', '1'].includes(String(o.ASSISTANT_TYPESENSE_ENABLED).toLowerCase()),
  )
  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  TYPESENSE_HOST?: string;

  @ValidateIf((o: EnvDto) =>
    o.ASSISTANT_TYPESENSE_ENABLED != null &&
    ['true', '1'].includes(String(o.ASSISTANT_TYPESENSE_ENABLED).toLowerCase()),
  )
  @IsString()
  @IsNotEmpty()
  TYPESENSE_API_KEY?: string;

  @IsOptional()
  @IsString()
  ASSISTANT_TYPESENSE_COLLECTION?: string;

  @IsOptional()
  @IsNumberString()
  ASSISTANT_TYPESENSE_TIMEOUT_MS?: string;

  @IsOptional()
  @IsNumberString()
  ASSISTANT_TYPESENSE_SYNC_LIMIT?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvDto, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { whitelist: true });
  if (errors.length > 0) {
    const message = errors.map((e) => Object.values(e.constraints ?? {})).flat().join('; ');
    throw new Error(`Env validation failed: ${message}`);
  }

  return { ...config, ...validated };
}
