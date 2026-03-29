import type { AppConfig } from '../../config';
import type { StoredOAuthToken } from '../../domain/oauth';
import { createSignedOAuthState, verifySignedOAuthState } from '../../utils/oauth-state';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export class GoogleCalendarOAuthService {
  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.env.OAUTH_STATE_SECRET &&
      this.config.env.GOOGLE_CLIENT_ID &&
        this.config.env.GOOGLE_CLIENT_SECRET &&
        this.config.env.GOOGLE_REDIRECT_URI,
    );
  }

  getStartUrl(): string {
    if (!this.isConfigured()) {
      throw new Error('Google Calendar OAuth is not configured.');
    }

    const state = createSignedOAuthState('google-calendar', this.config.env.OAUTH_STATE_SECRET!);
    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.searchParams.set('client_id', this.config.env.GOOGLE_CLIENT_ID!);
    url.searchParams.set('redirect_uri', this.config.env.GOOGLE_REDIRECT_URI!);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);

    return url.toString();
  }

  validateCallbackState(state: string): boolean {
    return verifySignedOAuthState(state, 'google-calendar', this.config.env.OAUTH_STATE_SECRET!);
  }

  async exchangeCode(code: string): Promise<StoredOAuthToken> {
    if (!this.isConfigured()) {
      throw new Error('Google Calendar OAuth is not configured.');
    }

    const payload = await this.postTokenRequest({
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.config.env.GOOGLE_REDIRECT_URI!,
    });

    return {
      provider: 'google-calendar',
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      tokenType: payload.token_type ?? 'Bearer',
      scopeBlob: payload.scope ?? GOOGLE_SCOPE,
      expiryUtc: computeExpiryUtc(payload.expires_in),
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<StoredOAuthToken> {
    const payload = await this.postTokenRequest({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    return {
      provider: 'google-calendar',
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? refreshToken,
      tokenType: payload.token_type ?? 'Bearer',
      scopeBlob: payload.scope ?? GOOGLE_SCOPE,
      expiryUtc: computeExpiryUtc(payload.expires_in),
    };
  }

  private async postTokenRequest(
    params: Record<string, string>,
  ): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.config.env.GOOGLE_CLIENT_ID!,
      client_secret: this.config.env.GOOGLE_CLIENT_SECRET!,
      ...params,
    });

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google token exchange failed: ${response.status} ${text}`);
    }

    return (await response.json()) as GoogleTokenResponse;
  }
}

function computeExpiryUtc(expiresInSeconds?: number): string | null {
  if (!expiresInSeconds) {
    return null;
  }

  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}
