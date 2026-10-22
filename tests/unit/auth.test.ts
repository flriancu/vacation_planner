import { describe, expect, it } from 'vitest';
import { AuthExpiredError, GoogleAuth } from '../../src/google/auth';

describe('GoogleAuth.accessToken', () => {
  it("never hands one account's storage another account's token", () => {
    const auth = new GoogleAuth('client', ['openid'], 'drive.file');
    Object.assign(auth, { token: 'tok-b', session: { user: { sub: 'b', name: 'B', email: 'b@x' }, expiresAt: Date.now() + 3_600_000 } });
    expect(auth.accessToken('b')).toBe('tok-b');
    expect(() => auth.accessToken('a')).toThrow(AuthExpiredError);
  });
});
