import { forwardRef } from 'react';
import { useI18n } from '../i18n';
import type { Account } from './account';
import { LangSwitch } from './LangSwitch';
import { Menu } from './Menu';
import { SCHEMES, type Mode, type SchemeId } from './theme';
import type { SaveState } from './useDocument';
import type { WidthClass } from './useLayout';

export interface ThemeControls {
  scheme: SchemeId;
  setScheme: (s: SchemeId) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
}

interface Props {
  year: number;
  setYear: (update: (y: number) => number) => void;
  onToday: () => void;
  account: Account;
  saveState: SaveState;
  flush: () => Promise<void>;
  theme: ThemeControls;
  width: WidthClass;
  hidden: boolean;
}

/**
 * One header row: title · year · Today, then at most three groups on the right: save status,
 * Settings, account (Apple HIG toolbars; Material 3 app bars). The account slot is the same in
 * both states: "Sign in" signed out, the account menu signed in. On phones Settings moves into
 * the account menu, or a ⋯ menu when signed out.
 */
export const Header = forwardRef<HTMLElement, Props>(function Header(
  { year, setYear, onToday, account, saveState, flush, theme, width, hidden },
  ref,
) {
  const { t } = useI18n();
  const compact = width === 'compact';
  const settings = <SettingsControls theme={theme} />;

  return (
    <header ref={ref} className={`app-header${hidden ? ' is-hidden' : ''}`}>
      {!compact && <h1>{t('app.title')}</h1>}
      <nav className="year-nav" aria-label={t('year.label')}>
        <button type="button" className="square" onClick={() => setYear((y) => y - 1)} aria-label={t('year.prev')}>
          ‹
        </button>
        <span className="year" aria-live="polite">
          {year}
        </span>
        <button type="button" className="square" onClick={() => setYear((y) => y + 1)} aria-label={t('year.next')}>
          ›
        </button>
        <button type="button" onClick={onToday} data-tip={t('header.todayLabel')}>
          {t('header.today')}
        </button>
      </nav>
      <div className="header-end">
        <SaveStatus account={account} saveState={saveState} flush={flush} compact={compact} />
        {!compact && (
          <Menu label={t('settings.menu')} button={<>{t('settings.menu')} ▾</>}>
            {settings}
          </Menu>
        )}
        <AccountSlot account={account} settings={compact ? settings : null} compact={compact} />
      </div>
    </header>
  );
});

function SettingsControls({ theme }: { theme: ThemeControls }) {
  const { t } = useI18n();
  return (
    <div className="settings">
      <label className="picker">
        <span>{t('theme.scheme')}</span>
        <select value={theme.scheme} onChange={(e) => theme.setScheme(e.target.value as SchemeId)}>
          {SCHEMES.map((s) => (
            <option key={s} value={s}>
              {t(`theme.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="picker">
        <span>{t('theme.mode')}</span>
        <select value={theme.mode} onChange={(e) => theme.setMode(e.target.value as Mode)}>
          {(['auto', 'light', 'dark'] as const).map((m) => (
            <option key={m} value={m}>
              {t(`mode.${m}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="picker">
        <span>{t('lang.label')}</span>
        <LangSwitch />
      </div>
    </div>
  );
}

/** A lasting state, so an indicator in one place (NN/g): demo, saving, saved, error, or "reconnect". */
function SaveStatus({
  account,
  saveState,
  flush,
  compact,
}: {
  account: Account;
  saveState: SaveState;
  flush: () => Promise<void>;
  compact: boolean;
}) {
  const { t } = useI18n();
  if (account.kind === 'demo') {
    return (
      <output className="status status-demo" data-tip={t('status.demo')} aria-label={t('status.demo')}>
        {/* The long text only where it fits (app.css); phones always get the short one. */}
        {!compact && <span className="long">{t('status.demo')}</span>}
        <span className="short">{t('status.demoShort')}</span>
      </output>
    );
  }
  if (saveState === 'signin') {
    const reconnect = () =>
      void account.reconnect().then(async (ok) => {
        if (ok) await flush();
      });
    return (
      <button type="button" className="primary" onClick={reconnect} data-tip={t('auth.reconnect')}>
        {t('auth.reconnectShort')}
      </button>
    );
  }
  const label = t(`save.${saveState}`);
  return (
    <output className={`status status-${saveState}`} data-tip={label}>
      <span className="dot" aria-hidden="true" />
      <span className={compact ? 'sr-only' : undefined}>{label}</span>
    </output>
  );
}

function AccountSlot({ account, settings, compact }: { account: Account; settings: React.ReactNode; compact: boolean }) {
  const { t } = useI18n();
  if (account.kind === 'demo') {
    return (
      <>
        <button type="button" className="primary" onClick={() => account.signIn()} disabled={account.busy} data-tip={account.hint?.email}>
          {account.busy
            ? t('auth.signingIn')
            : account.hint
              ? t('auth.continueAs', { name: account.hint.name })
              : compact
                ? t('auth.signInShort')
                : t('auth.signIn')}
        </button>
        {settings && (
          <Menu label={t('settings.menu')} button="⋯" buttonClassName="square">
            {settings}
          </Menu>
        )}
      </>
    );
  }
  const initial = (account.name || account.email).trim().charAt(0).toLocaleUpperCase() || '?';
  return (
    <Menu
      label={t('account.menu', { email: account.email })}
      button={<span className="avatar">{initial}</span>}
      buttonClassName="avatar-btn"
    >
      <div className="account-info">
        <strong>{account.name}</strong>
        <span className="who">{account.email}</span>
      </div>
      {settings}
      <button type="button" onClick={account.signOut}>
        {t('auth.signOut')}
      </button>
    </Menu>
  );
}
