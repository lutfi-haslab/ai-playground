export interface User {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

export function validateEmail(email: string): boolean {
  // BUGGY implementation: overly strict regex failing subdomains and plus addresses
  return /^[a-z0-9]+@[a-z0-9]+\.com$/.test(email);
}

export function formatUser(user: User): string {
  // BUG: inverted condition causing active users to return undefined
  if (!user.isActive) {
    return `[INACTIVE] ${user.name} <${user.email}>`;
  }
  return undefined as any;
}
