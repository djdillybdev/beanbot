import type { AppConfig } from '../../config';
import type { StoredOAuthToken } from '../../domain/oauth';
import { createSignedOAuthState, verifySignedOAuthState } from '../../utils/oauth-state';

const TODOIST_AUTHORIZE_URL = 'https://api.todoist.com/oauth/authorize';
const TODOIST_TOKEN_URL = 'https://api.todoist.com/oauth/access_token';
const TODOIST_SCOPE = 'data:read';

export class TodoistOAuthService {
  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.env.OAUTH_STATE_SECRET &&
      this.config.env.TODOIST_CLIENT_ID &&
        this.config.env.TODOIST_CLIENT_SECRET &&
        this.config.env.TODOIST_REDIRECT_URI,
    );
  }

  getStartUrl(): string {
    if (!this.isConfigured()) {
      throw new Error('Todoist OAuth is not configured.');
    }

    const state = createSignedOAuthState('todoist', this.config.env.OAUTH_STATE_SECRET!);
    const url = new URL(TODOIST_AUTHORIZE_URL);
    url.searchParams.set('client_id', this.config.env.TODOIST_CLIENT_ID!);
    url.searchParams.set('scope', TODOIST_SCOPE);
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', this.config.env.TODOIST_REDIRECT_URI!);

    return url.toString();
  }

  validateCallbackState(state: string): boolean {
    return verifySignedOAuthState(state, 'todoist', this.config.env.OAUTH_STATE_SECRET!);
  }

  async exchangeCode(code: string): Promise<StoredOAuthToken> {
    if (!this.isConfigured()) {
      throw new Error('Todoist OAuth is not configured.');
    }

    const body = new URLSearchParams({
      client_id: this.config.env.TODOIST_CLIENT_ID!,
      client_secret: this.config.env.TODOIST_CLIENT_SECRET!,
      code,
      redirect_uri: this.config.env.TODOIST_REDIRECT_URI!,
    });

    const response = await fetch(TODOIST_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Todoist token exchange failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as {
      access_token: string;
      token_type?: string;
    };

    return {
      provider: 'todoist',
      accessToken: payload.access_token,
      refreshToken: null,
      tokenType: payload.token_type ?? 'Bearer',
      scopeBlob: TODOIST_SCOPE,
      expiryUtc: null,
    };
  }
}
