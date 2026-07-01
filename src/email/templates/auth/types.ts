export type PasswordResetEmailContext = {
  resetUrl: string;
  expiresMinutes: number;
};

export type PasswordChangedEmailContext = {
  changedAt: Date;
  settingsUrl: string;
};

export type SignupVerificationEmailContext = {
  confirmUrl: string;
};
