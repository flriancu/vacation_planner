/**
 * Google sign-in (DESIGN §5). The client ID is not a secret: it ships in the page anyway.
 * The app uses only the browser token flow, so there is no client secret anywhere.
 */
export const GOOGLE_CLIENT_ID = '533285619154-qpjkbq5aft50dbljbom30pk40vtc6p0o.apps.googleusercontent.com';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Non-sensitive scopes only (AUTH-2, AUTH-4): no verification, no warning screen. */
export const GOOGLE_SCOPES = ['openid', 'email', 'profile', DRIVE_FILE_SCOPE];
