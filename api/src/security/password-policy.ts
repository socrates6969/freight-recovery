/**
 * Password policy (C5): 12..128 characters, not in the built-in common-password list, not equal to the
 * local part of the account email. Violations map to 400 weak_password.
 */

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/**
 * Built-in list of common passwords (lowercased) long enough to pass the length rule. Shorter common
 * passwords are already rejected by PASSWORD_MIN. Compared case-insensitively.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '123456789012', '1234567890123', '12345678901234', '123456789123', '000000000000', '111111111111',
  '123123123123', '121212121212', '987654321098', '112233445566', 'password1234', 'password12345',
  'password123!', 'password2024', 'password2025', 'password2026', 'passwordpassword', 'passw0rd1234',
  'p@ssw0rd1234', 'p@ssword1234', 'password1!password', 'qwertyuiopas', 'qwerty123456', 'qwertyqwerty',
  'qwertyuiop12', 'qwerty123456!', 'asdfghjkl123', 'asdfasdfasdf', 'zxcvbnm12345', '1q2w3e4r5t6y',
  'q1w2e3r4t5y6', '1qaz2wsx3edc', 'zaq12wsxcde3', 'qazwsxedcrfv', 'abcdefghijkl', 'abc123456789',
  'abcd12345678', 'iloveyou1234', 'iloveyouiloveyou', 'letmein12345', 'letmeinletmein', 'welcome12345',
  'welcome123!', 'welcome2024!', 'welcome2025!', 'welcome2026!', 'changeme1234', 'changemechangeme',
  'administrator', 'administrator1', 'admin1234567', 'adminadmin123', 'football1234', 'baseball1234',
  'basketball12', 'trustno1trustno1', 'monkey123456', 'dragon123456', 'sunshine1234', 'princess1234',
  'superman1234', 'batman123456', 'starwars1234', 'master123456', 'shadow123456', 'michael12345',
  'jennifer1234', 'whatever1234', 'freedom12345', 'computer1234', 'internet1234', 'secret123456',
  'mypassword12', 'mypassword123', 'yourpassword', 'thisisapassword', 'correcthorsebatterystaple',
  'summer2024!!', 'summer2025!!', 'winter2025!!', 'spring2026!!', 'autumn2026!!', 'freight12345',
  'freightrecovery', 'freightrecovery1', 'logistics123', 'shipping1234', 'carrier12345',
]);

export type PasswordPolicyResult = { ok: true } | { ok: false; reason: 'length' | 'common' | 'email' | 'repetitive' };

export function checkPasswordPolicy(password: string, email: string): PasswordPolicyResult {
  const length = [...password].length;
  if (length < PASSWORD_MIN || length > PASSWORD_MAX) return { ok: false, reason: 'length' };
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return { ok: false, reason: 'common' };
  const local = email.trim().toLowerCase().split('@')[0] ?? '';
  if (local.length > 0 && lower === local) return { ok: false, reason: 'email' };
  if (/^(.)\1+$/su.test(password)) return { ok: false, reason: 'repetitive' };
  return { ok: true };
}
