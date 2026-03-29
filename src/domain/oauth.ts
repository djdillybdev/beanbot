export type OAuthProvider = 'todoist' | 'google-calendar';

export interface StoredOAuthToken {
  provider: OAuthProvider;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scopeBlob: string | null;
  expiryUtc: string | null;
}
