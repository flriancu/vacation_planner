import { forwardRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { Account } from './account';
import { errorMessage } from './errors';
import { LangSwitch } from './LangSwitch';
import { closeMenu, Menu } from './Menu';
import { SCHEMES, type Mode, type SchemeId } from './theme';
import type { SaveState } from './useDocument';
import type { WidthClass } from './useLayout';

/** Saving and adding copies of the plan, and the calendar export (IO-2, IO-4). */
export interface DataActions {
  exportPlan: () => void;
  importPlan: () => void;
  exportCalendar: () => void;
  /** Signed in only: share my plan read-only (PPL-3). */
  share?: () => void;
}

export interface ThemeControls {
  scheme: SchemeId;
  setScheme: (s: SchemeId) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
}

interface Props {
  year: number;
  setYear: (update: (y: number) => number) => void;
  /** The years the app can show (the holiday rules' range). */
  minYear: number;
  maxYear: number;
  onToday: () => void;
  account: Account;
  saveState: SaveState;
  saveError: unknown;
  flush: () => Promise<void>;
  theme: ThemeControls;
  data: DataActions;
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
  { year, setYear, minYear, maxYear, onToday, account, saveState, saveError, flush, theme, data, width, hidden },
  ref,
) {
  const { t } = useI18n();
  const compact = width === 'compact';
  const settings = <SettingsControls theme={theme} data={data} />;

  return (
    <header ref={ref} className={`app-header${hidden ? ' is-hidden' : ''}`}>
      {/* Phones show no title, but the page still has its heading for screen readers. */}
      <h1 className={compact ? 'sr-only' : undefined}>{t('app.title')}</h1>
      <nav className="year-nav" aria-label={t('year.label')}>
        <button
          type="button"
          className="square"
          onClick={() => year > minYear && setYear((y) => y - 1)}
          // aria-disabled, not disabled: a disabled button drops keyboard focus to the top of the page.
          aria-disabled={year <= minYear}
          aria-label={t('year.prev')}
        >
          ‹
        </button>
        <span className="year" aria-live="polite">
          {year}
        </span>
        <button
          type="button"
          className="square"
          onClick={() => year < maxYear && setYear((y) => y + 1)}
          aria-disabled={year >= maxYear}
          aria-label={t('year.next')}
        >
          ›
        </button>
        <button type="button" onClick={onToday} data-tip={t('header.todayLabel')}>
          {t('header.today')}
        </button>
      </nav>
      <div className="header-end">
        <SaveStatus account={account} saveState={saveState} saveError={saveError} flush={flush} compact={compact} />
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

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The avatar's letter: the first character as people see it (a whole emoji, a flag, a letter
 * with its accent), skipping invisible ones, as a capital ("ß" gives "S", not "SS").
 */
function initialOf(text: string): string {
  const visible = text.normalize('NFC').replace(/^[\s\u200B-\u200D\u2060\uFEFF]+/u, '');
  const first = graphemes.segment(visible)[Symbol.iterator]().next().value?.segment;
  if (!first) return '?';
  const upper = first.toLocaleUpperCase();
  return graphemes.segment(upper)[Symbol.iterator]().next().value?.segment ?? first;
}

function SettingsControls({ theme, data }: { theme: ThemeControls; data: DataActions }) {
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
      <div className="data-actions" role="group" aria-label={t('data.label')}>
        <span className="data-label">{t('data.label')}</span>
        <button
          type="button"
          className="link"
          onClick={() => {
            closeMenu();
            data.exportPlan();
          }}
        >
          {t('data.exportPlan')}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            closeMenu();
            data.importPlan();
          }}
        >
          {t('data.importPlan')}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            closeMenu();
            data.exportCalendar();
          }}
        >
          {t('data.exportCalendar')}
        </button>
        {data.share && (
          <button
            type="button"
            className="link"
            onClick={() => {
              closeMenu();
              data.share!();
            }}
          >
            {t('share.action')}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A lasting state, so an indicator in one place (NN/g): demo, saving, saved, or one action when
 * something needs the user: "try again" after a failed save (it also retries by itself), or
 * "reconnect" when the Google session expired.
 */
function SaveStatus({
  account,
  saveState,
  saveError,
  flush,
  compact,
}: {
  account: Account;
  saveState: SaveState;
  saveError: unknown;
  flush: () => Promise<void>;
  compact: boolean;
}) {
  const { t } = useI18n();
  const [reconnectFailed, setReconnectFailed] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
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
    const reconnect = () => {
      if (reconnecting) return; // one Google popup at a time
      setReconnecting(true);
      void account
        .reconnect()
        .then(async (failed) => {
          setReconnectFailed(failed);
          if (!failed) await flush();
        })
        .finally(() => setReconnecting(false));
    };
    const why =
      reconnectFailed && t(reconnectFailed === 'other_account' ? 'auth.errOtherAccount' : 'auth.reconnectFailed', { email: account.email });
    return (
      <>
        <button type="button" className="primary" onClick={reconnect} data-tip={why || t('auth.reconnect')}>
          {t('auth.reconnectShort')}
        </button>
        {why && (
          <span className="sr-only" role="alert">
            {why}
          </span>
        )}
      </>
    );
  }
  if (saveState === 'error') {
    const why = t(errorMessage(saveError));
    return (
      <button type="button" className="status status-error" onClick={() => void flush()} data-tip={why} aria-describedby="save-why">
        <span className="dot" aria-hidden="true" />
        <span>{t(compact ? 'save.retryShort' : 'save.retry')}</span>
        <span id="save-why" className="sr-only">
          {why}
        </span>
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
  const initial = initialOf(account.name || account.email);
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
      <button type="button" onClick={() => account.signOut()}>
        {t('auth.signOut')}
      </button>
    </Menu>
  );
}
