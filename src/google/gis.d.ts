/** The small part of Google Identity Services (accounts.google.com/gsi/client) the app uses. */
declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token: string;
    expires_in: number;
    scope: string;
    error?: string;
    error_description?: string;
  }
  interface ClientConfigError {
    type: 'popup_failed_to_open' | 'popup_closed' | 'unknown';
    message?: string;
  }
  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: ClientConfigError) => void;
  }
  interface OverridableTokenClientConfig {
    prompt?: '' | 'none' | 'consent' | 'select_account';
    login_hint?: string;
  }
  interface TokenClient {
    callback: (response: TokenResponse) => void;
    error_callback?: (error: ClientConfigError) => void;
    requestAccessToken(overrides?: OverridableTokenClientConfig): void;
  }
  function initTokenClient(config: TokenClientConfig): TokenClient;
  function hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean;
}

interface Window {
  google?: { accounts?: { oauth2?: typeof google.accounts.oauth2 } };
}
