/**
 * Google sign-in (DESIGN §5). The client ID is not a secret: it ships in the page anyway.
 * The app uses only the browser token flow, so there is no client secret anywhere.
 */
export const GOOGLE_CLIENT_ID = '533285619154-qpjkbq5aft50dbljbom30pk40vtc6p0o.apps.googleusercontent.com';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Non-sensitive scopes only (AUTH-2, AUTH-4): no verification, no warning screen. */
export const GOOGLE_SCOPES = ['openid', 'email', 'profile', DRIVE_FILE_SCOPE];

/**
 * The Google Picker, to follow a plan someone shared with me (PPL-3): with `drive.file`, the
 * app may open a file only once I pick it there. The API key isn't secret either: Google
 * accepts it only from this site's pages (HTTP referrer restriction) and only for the Picker.
 * The app id is the Cloud project's number.
 */
export const GOOGLE_API_KEY = 'AIzaSyCzV9BUnGaRqxaavFLUys0ouzi7wsDNboI';
export const GOOGLE_APP_ID = '533285619154';
