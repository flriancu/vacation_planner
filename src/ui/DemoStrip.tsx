import { useI18n, type MessageKey } from '../i18n';
import type { Account } from './account';
import { Notice } from './Notice';
import { useDismissed } from './useLayout';

const SIGN_IN_ERRORS: Record<string, MessageKey> = {
  popup: 'auth.errPopup',
  drive_denied: 'auth.errDrive',
  not_ready: 'auth.errNotReady',
};

/**
 * A thin line under the header while signed out (GOV.UK phase-banner pattern). First visit: what
 * demo mode means, closable. Returning browser: your plan is in Drive (the one sign-in action,
 * "Continue as …", is in the header; here only "Another account").
 * Sign-in errors always show here.
 */
export function DemoStrip({ account }: { account: Extract<Account, { kind: 'demo' }> }) {
  const { t } = useI18n();
  const [closed, close] = useDismissed('vacation-planner.demoStripClosed');
  const error = account.error && (
    <p className="auth-error" role="alert">
      {t(SIGN_IN_ERRORS[account.error] ?? 'auth.errGeneric')}
    </p>
  );

  if (account.hint) {
    return (
      <Notice
        scope="page"
        label={t('auth.bannerLabel')}
        actions={
          <button type="button" className="link" onClick={() => account.signIn(true)} disabled={account.busy}>
            {t('auth.otherAccount')}
          </button>
        }
      >
        <p>{t('auth.welcomeBack')}</p>
        {error}
      </Notice>
    );
  }
  if (closed) return error ? <Notice scope="page">{error}</Notice> : null;
  return (
    <Notice scope="page" label={t('auth.bannerLabel')} onClose={close} closeLabel={t('strip.close')}>
      <p>{t('auth.demoIntro')}</p>
      {error}
    </Notice>
  );
}
