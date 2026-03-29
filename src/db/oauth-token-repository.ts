import { eq } from 'drizzle-orm';

import type { Database } from './types';
import { oauthTokens as oauthTokensTable } from './schema';
import type { StoredOAuthToken, OAuthProvider } from '../domain/oauth';

export class OAuthTokenRepository {
  constructor(private readonly db: Database) {}

  async getByProvider(provider: OAuthProvider): Promise<StoredOAuthToken | null> {
    const token = await this.db.query.oauthTokens.findFirst({
      where: eq(oauthTokensTable.provider, provider),
    });

    if (!token) {
      return null;
    }

    return {
      provider,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      tokenType: token.tokenType,
      scopeBlob: token.scopeBlob,
      expiryUtc: token.expiryUtc,
    };
  }

  async save(token: StoredOAuthToken): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .insert(oauthTokensTable)
      .values({
        provider: token.provider,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        tokenType: token.tokenType,
        scopeBlob: token.scopeBlob,
        expiryUtc: token.expiryUtc,
        updatedAtUtc: now,
      })
      .onConflictDoUpdate({
        target: oauthTokensTable.provider,
        set: {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          tokenType: token.tokenType,
          scopeBlob: token.scopeBlob,
          expiryUtc: token.expiryUtc,
          updatedAtUtc: now,
        },
      });
  }
}
