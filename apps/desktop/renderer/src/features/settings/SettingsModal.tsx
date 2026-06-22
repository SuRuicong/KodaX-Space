import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  KeyRound,
  Languages,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { LanguageModeT, ProviderInfo } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import { localeDisplayName, useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';
import { pushToast } from '../../store/toastStore.js';
import { ProviderCard } from '../provider/ProviderCard.js';
import { CustomProviderForm } from '../provider/CustomProviderForm.js';
import { WorkflowPolicySection } from '../workflow/WorkflowPolicySection.js';

export type SettingsTab = 'providers' | 'preferences';

interface SettingsModalProps {
  readonly initialTab?: SettingsTab;
  readonly onClose: () => void;
}

interface SettingsTabMeta {
  readonly id: SettingsTab;
  readonly labelKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly Icon: LucideIcon;
}

const TABS: readonly SettingsTabMeta[] = [
  {
    id: 'preferences',
    labelKey: 'settings.preferences',
    descriptionKey: 'settings.preferences.description',
    Icon: SlidersHorizontal,
  },
  {
    id: 'providers',
    labelKey: 'settings.providers',
    descriptionKey: 'settings.providers.description',
    Icon: KeyRound,
  },
];

export function SettingsModal({
  initialTab = 'preferences',
  onClose,
}: SettingsModalProps): JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0];

  function selectTab(next: SettingsTab): void {
    setTab(next);
    window.requestAnimationFrame(() => {
      document.getElementById(`settings-tab-${next}`)?.focus();
    });
  }

  function handleTabListKeyDown(e: ReactKeyboardEvent<HTMLElement>): void {
    const currentIndex = TABS.findIndex((t) => t.id === tab);
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = TABS.length - 1;
    }

    if (nextIndex === null) return;
    e.preventDefault();
    selectTab(TABS[nextIndex].id);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 px-4 py-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      onMouseDown={onClose}
    >
      <div
        className="glass lift ix-zone flex h-[min(780px,calc(100vh-32px))] w-[min(1120px,calc(100vw-32px))] min-h-[560px] overflow-hidden rounded-xl border border-border-default bg-surface-2 text-sm text-fg-primary"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <aside className="flex w-64 shrink-0 flex-col border-r border-border-default bg-surface/55">
          <div className="border-b border-border-default px-4 py-4">
            <div className="mb-1 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-default bg-surface-3 text-accent-ink">
                <Settings2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              </div>
              <div className="min-w-0">
                <h2 id="settings-modal-title" className="text-base font-semibold leading-tight">
                  {t('common.settings')}
                </h2>
                <p className="truncate text-[11px] text-fg-muted">{t('settings.subtitle')}</p>
              </div>
            </div>
          </div>

          <nav
            role="tablist"
            aria-label={t('settings.sections')}
            className="flex-1 space-y-1 px-3 py-3"
            onKeyDown={handleTabListKeyDown}
          >
            {TABS.map((t) => (
              <SettingsNavButton
                key={t.id}
                tab={t}
                label={t.labelKey}
                description={t.descriptionKey}
                active={tab === t.id}
                onClick={() => selectTab(t.id)}
              />
            ))}
          </nav>

          <div className="m-3 rounded-lg border border-border-default bg-surface-2 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-fg-primary">
              <ShieldCheck className="h-3.5 w-3.5 text-ok" strokeWidth={1.8} aria-hidden />
              {t('settings.keySafety.title')}
            </div>
            <p className="text-[11px] leading-5 text-fg-muted">
              {t('settings.keySafety.description')}
            </p>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-[72px] shrink-0 items-center gap-3 border-b border-border-default px-5 py-3">
            <activeTab.Icon className="h-5 w-5 text-fg-secondary" strokeWidth={1.8} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight">{t(activeTab.labelKey)}</div>
              <div className="truncate text-xs text-fg-muted">{t(activeTab.descriptionKey)}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ix-pop inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
              aria-label={t('settings.close')}
              title={t('settings.close')}
            >
              <X className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto bg-surface/30">
            <div
              id="settings-panel-preferences"
              role="tabpanel"
              aria-labelledby="settings-tab-preferences"
              hidden={tab !== 'preferences'}
              className="h-full"
            >
              <PreferencesPanel />
            </div>
            <div
              id="settings-panel-providers"
              role="tabpanel"
              aria-labelledby="settings-tab-providers"
              hidden={tab !== 'providers'}
              className="h-full"
            >
              <ProvidersPanel />
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function SettingsNavButton({
  tab,
  label,
  description,
  active,
  onClick,
}: {
  readonly tab: SettingsTabMeta;
  readonly label: MessageKey;
  readonly description: MessageKey;
  readonly active: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <button
      id={`settings-tab-${tab.id}`}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`settings-panel-${tab.id}`}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={[
        'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left',
        active
          ? 'border border-border-default bg-surface-3 text-fg-primary shadow-sm'
          : 'border border-transparent text-fg-secondary hover:bg-hover-bg hover:text-fg-primary',
      ].join(' ')}
    >
      <tab.Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-tight">{t(label)}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-fg-muted">{t(description)}</span>
      </span>
    </button>
  );
}

function PreferencesPanel(): JSX.Element {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);

  const [defaultWorkspace, setDefaultWorkspace] = useState('');
  const [originalDefault, setOriginalDefault] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!window.kodaxSpace) return;
    void window.kodaxSpace.invoke('settings.get', {}).then((r) => {
      if (r.ok) {
        setDefaultWorkspace(r.data.defaultWorkspace);
        setOriginalDefault(r.data.defaultWorkspace);
      }
    });
  }, []);

  async function browseFolder(): Promise<void> {
    if (!window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('project.openDialog', undefined);
    if (r.ok && r.data.path !== null) {
      setDefaultWorkspace(r.data.path);
      setSaved(false);
    }
  }

  async function save(): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const trimmed = defaultWorkspace.trim();
      if (!trimmed) {
        setErr(t('settings.workspace.emptyError'));
        return;
      }
      const r = await window.kodaxSpace.invoke('settings.setDefaultWorkspace', { path: trimmed });
      if (!r.ok) {
        setErr(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'save failed'}`);
        return;
      }
      if (currentProjectPath === originalDefault) {
        setCurrentProject(r.data.defaultWorkspace);
        await window.kodaxSpace
          .invoke('project.recent.add', { path: r.data.defaultWorkspace })
          .catch(() => {});
        const listR = await window.kodaxSpace.invoke('project.list', undefined);
        if (listR.ok) useAppStore.getState().setProjects(listR.data.projects);
      }
      setOriginalDefault(r.data.defaultWorkspace);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  const changed = defaultWorkspace.trim() !== originalDefault.trim();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5">
      <LanguageSection />

      <SettingsSection
        title={t('settings.workspace.title')}
        description={t('settings.workspace.description')}
        icon={FolderOpen}
      >
        <label
          htmlFor="settings-default-workspace"
          className="block text-[11px] font-medium uppercase tracking-wide text-fg-muted"
        >
          {t('settings.workspace.default')}
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="settings-default-workspace"
            type="text"
            value={defaultWorkspace}
            onChange={(e) => {
              setDefaultWorkspace(e.target.value);
              setSaved(false);
            }}
            className="min-h-9 flex-1 rounded-lg border border-border-default bg-surface px-3 py-2 font-mono text-xs text-fg-primary outline-none focus:border-info"
            placeholder={t('settings.workspace.placeholder')}
            aria-describedby="settings-default-workspace-hint"
          />
          <button
            type="button"
            onClick={() => void browseFolder()}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-3 px-3 text-xs text-fg-primary hover:bg-hover-bg"
            title={t('settings.workspace.browseTitle')}
          >
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
            {t('common.browse')}
          </button>
        </div>
        <div
          id="settings-default-workspace-hint"
          className="mt-2 text-[11px] leading-5 text-fg-muted"
        >
          {t('settings.workspace.hint')}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !changed}
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-ok/50 bg-ok/15 px-3 text-xs font-medium text-ok hover:bg-ok/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />}
            {busy ? t('common.saving') : t('settings.workspace.save')}
          </button>
          {err && <span className="text-xs text-danger">{err}</span>}
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ok">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              {t('common.saved')}
            </span>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('settings.interface.title')}
        description={t('settings.interface.description')}
        icon={SlidersHorizontal}
      >
        <div className="space-y-3">
          <SmartPopoutToggle />
          <NativeCompletionNotificationToggle />
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('settings.workflowHost.title')}
        description={t('settings.workflowHost.description')}
        icon={Settings2}
      >
        <WorkflowPolicySection />
      </SettingsSection>
    </div>
  );
}

function LanguageSection(): JSX.Element {
  const { languageMode, effectiveLocale, setLanguageMode, t } = useI18n();
  const [busy, setBusy] = useState<LanguageModeT | null>(null);
  const options: ReadonlyArray<{ readonly mode: LanguageModeT; readonly label: MessageKey }> = [
    { mode: 'system', label: 'language.followSystem' },
    { mode: 'zh-CN', label: 'language.zhCN' },
    { mode: 'en-US', label: 'language.enUS' },
  ];

  async function chooseLanguage(next: LanguageModeT): Promise<void> {
    if (next === languageMode || busy !== null) return;
    setBusy(next);
    try {
      const ok = await setLanguageMode(next);
      if (ok) pushToast(t('toast.languageSaved'), 'success', 1800);
      else pushToast(t('toast.languageSaveFailed'), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsSection
      title={t('settings.language.title')}
      description={t('settings.language.description')}
      icon={Languages}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.mode}
            type="button"
            onClick={() => void chooseLanguage(option.mode)}
            disabled={busy !== null}
            aria-pressed={languageMode === option.mode}
            className={[
              'min-h-10 rounded-lg border px-3 text-left text-sm transition-colors',
              languageMode === option.mode
                ? 'border-info/70 bg-info/10 text-fg-primary'
                : 'border-border-default bg-surface text-fg-secondary hover:bg-hover-bg hover:text-fg-primary',
            ].join(' ')}
          >
            <span className="block font-medium">{t(option.label)}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 text-xs leading-5 text-fg-muted">
        {t('language.effective', { locale: localeDisplayName(effectiveLocale) })}
      </div>
      <div className="mt-1 text-[11px] leading-5 text-fg-muted">{t('settings.language.help')}</div>
    </SettingsSection>
  );
}

function SmartPopoutToggle(): JSX.Element {
  const { t } = useI18n();
  const enabled = useAppStore((s) => s.smartPopoutEnabled);
  const setEnabled = useAppStore((s) => s.setSmartPopoutEnabled);
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-default bg-surface px-3 py-3">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
        className="mt-1 h-4 w-4 accent-ok"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg-primary">
          {t('settings.smartPopout.title')}
        </span>
        <span className="mt-1 block text-xs leading-5 text-fg-muted">
          {t('settings.smartPopout.description')}
        </span>
      </span>
    </label>
  );
}

function NativeCompletionNotificationToggle(): JSX.Element {
  const { t } = useI18n();
  const enabled = useAppStore((s) => s.nativeCompletionNotificationsEnabled);
  const setEnabled = useAppStore((s) => s.setNativeCompletionNotificationsEnabled);
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-default bg-surface px-3 py-3">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
        className="mt-1 h-4 w-4 accent-ok"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg-primary">
          {t('settings.notifications.title')}
        </span>
        <span className="mt-1 block text-xs leading-5 text-fg-muted">
          {t('settings.notifications.description')}
        </span>
      </span>
    </label>
  );
}

function ProvidersPanel(): JSX.Element {
  const { t } = useI18n();
  const providers = useAppStore((s) => s.providers);
  const keychainBackend = useAppStore((s) => s.keychainBackend);
  const setProviders = useAppStore((s) => s.setProviders);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const builtIn = useMemo(() => providers.filter((p) => !p.isCustom), [providers]);
  const custom = useMemo(() => providers.filter((p) => p.isCustom), [providers]);
  const configuredCount = useMemo(() => providers.filter((p) => p.configured).length, [providers]);
  const defaultProvider = useMemo(() => providers.find((p) => p.isDefault), [providers]);

  const filteredBuiltIn = useMemo(() => filterProviders(builtIn, query), [builtIn, query]);
  const filteredCustom = useMemo(() => filterProviders(custom, query), [custom, query]);

  async function refresh(): Promise<void> {
    if (!window.kodaxSpace) return;
    setLoading(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('provider.list', undefined);
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setProviders(
        result.data.providers,
        result.data.defaultProviderId,
        result.data.keychainBackend,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4 p-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ProviderStat
            label={t('settings.providers.configured')}
            value={`${configuredCount}/${providers.length}`}
            detail={t('settings.providers.configured.detail')}
          />
          <ProviderStat
            label={t('settings.providers.default')}
            value={defaultProvider?.displayName ?? t('settings.providers.default.none')}
            detail={defaultProvider?.defaultModel ?? t('settings.providers.default.detail')}
          />
          <ProviderStat
            label={t('settings.providers.custom')}
            value={String(custom.length)}
            detail={t('settings.providers.custom.detail')}
          />
          <ProviderStat
            label={t('settings.providers.keyStorage')}
            value={
              keychainBackend === 'memory'
                ? t('settings.providers.keyStorage.memory')
                : t('settings.providers.keyStorage.keychain')
            }
            detail={
              keychainBackend === 'memory'
                ? t('settings.providers.keyStorage.memoryDetail')
                : t('settings.providers.keyStorage.keychainDetail')
            }
          />
        </div>
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-3 px-3 text-xs text-fg-primary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              strokeWidth={1.8}
              aria-hidden
            />
            {t('common.refresh')}
          </button>
          <button
            type="button"
            onClick={() => setShowCustomForm((v) => !v)}
            className="btn-accent inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium"
          >
            {showCustomForm ? (
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            ) : (
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
            {showCustomForm ? t('settings.providers.closeForm') : t('settings.providers.addCustom')}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-danger/40 bg-danger/12 px-3 py-2 text-xs text-danger">
          {err}
        </div>
      )}

      {keychainBackend === 'memory' && (
        <div className="flex gap-3 rounded-lg border border-warn/45 bg-warn/12 px-3 py-3 text-xs text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
          <div className="leading-5">
            <div className="font-semibold">{t('settings.providers.keychainUnavailable.title')}</div>
            <div className="text-warn/90">
              {t('settings.providers.keychainUnavailable.description')}
            </div>
          </div>
        </div>
      )}

      {showCustomForm && (
        <CustomProviderForm
          onAdded={async () => {
            setShowCustomForm(false);
            await refresh();
          }}
          onPartialAdded={async () => {
            await refresh();
          }}
          onCancel={() => setShowCustomForm(false)}
        />
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border-default bg-surface-2 p-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted"
            strokeWidth={1.8}
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-full rounded-lg border border-border-default bg-surface pl-9 pr-3 text-xs text-fg-primary outline-none focus:border-info"
            placeholder={t('settings.providers.search.placeholder')}
            aria-label={t('settings.providers.search.aria')}
          />
        </label>
        <div className="text-xs text-fg-muted">
          {t('settings.providers.search.shown', {
            count: filteredBuiltIn.length + filteredCustom.length,
          })}
        </div>
      </div>

      <ProviderGroup
        title={t('settings.providers.customGroup.title')}
        description={t('settings.providers.customGroup.description')}
        providers={filteredCustom}
        empty={
          query.trim()
            ? t('settings.providers.customGroup.emptySearch')
            : t('settings.providers.customGroup.empty')
        }
        onChanged={refresh}
      />

      <ProviderGroup
        title={t('settings.providers.builtInGroup.title')}
        description={t('settings.providers.builtInGroup.description')}
        providers={filteredBuiltIn}
        empty={
          query.trim()
            ? t('settings.providers.builtInGroup.emptySearch')
            : t('settings.providers.builtInGroup.empty')
        }
        onChanged={refresh}
      />

      <section className="rounded-lg border border-border-default bg-surface-2 p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          {t('settings.providers.storage.title')}
        </h3>
        <div className="grid gap-2 text-xs leading-5 text-fg-muted sm:grid-cols-2">
          <div>{t('settings.providers.storage.keychain')}</div>
          <div>{t('settings.providers.storage.customProviders')}</div>
          <div>{t('settings.providers.storage.rendererState')}</div>
          <div>{t('settings.providers.storage.defaultProvider')}</div>
        </div>
      </section>
    </div>
  );
}

function filterProviders(
  providers: readonly ProviderInfo[],
  query: string,
): readonly ProviderInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return providers;
  return providers.filter((p) => {
    const fields = [
      p.displayName,
      p.id,
      p.apiKeyEnv,
      p.protocol,
      p.defaultModel,
      p.baseUrl ?? '',
      ...(p.models ?? []),
    ];
    return fields.some((field) => field.toLowerCase().includes(q));
  });
}

function ProviderGroup({
  title,
  description,
  providers,
  empty,
  onChanged,
}: {
  readonly title: string;
  readonly description: string;
  readonly providers: readonly ProviderInfo[];
  readonly empty: string;
  readonly onChanged: () => Promise<void>;
}): JSX.Element {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg-primary">{title}</h3>
          <p className="text-xs text-fg-muted">{description}</p>
        </div>
        <span className="text-xs text-fg-muted">{providers.length}</span>
      </div>
      {providers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-default bg-surface-2 px-4 py-5 text-center text-xs text-fg-muted">
          {empty}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} onChanged={onChanged} />
          ))}
        </div>
      )}
    </section>
  );
}

function ProviderStat({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}): JSX.Element {
  return (
    <div
      role="group"
      aria-label={`${label}: ${value}. ${detail}`}
      className="min-w-0 rounded-lg border border-border-default bg-surface-2 p-3"
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-fg-primary" title={value}>
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-fg-muted" title={detail}>
        {detail}
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border-default bg-surface-2 p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-default bg-surface-3 text-fg-secondary">
          <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg-primary">{title}</h3>
          <p className="mt-0.5 text-xs leading-5 text-fg-muted">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
