export class LoginResponseDto {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  user: {
    id: string;
    email: string;
    is_platform_admin: boolean;
    email_verified: boolean;
  };
}

export class MeResponseDto {
  id: string;
  email: string;
  is_platform_admin: boolean;
  full_name: string | null;
  avatar_url: string | null;
  email_verified: boolean;
}
