import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  resolveEffectiveLocale,
  type LanguageModeT,
  type SupportedLocaleT,
} from '@kodax-space/space-ipc-schema';
import { messages, type MessageKey } from './messages.js';

const STORAGE_KEY = 'kodax-space.languageMode';

interface I18nContextValue {
  readonly languageMode: LanguageModeT;
  readonly effectiveLocale: SupportedLocaleT;
  readonly setLanguageMode: (mode: LanguageModeT) => Promise<boolean>;
  readonly t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readCachedLanguageMode(): LanguageModeT {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'system' || raw === 'zh-CN' || raw === 'en-US') return raw;
  } catch {
    /* ignore first-paint cache failures */
  }
  return 'system';
}

function writeCachedLanguageMode(mode: LanguageModeT): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore cache failures */
  }
}

function interpolate(message: string, vars?: Record<string, string | number>): string {
  if (!vars) return message;
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

export function I18nProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const initialMode = readCachedLanguageMode();
  const [languageMode, setLanguageModeState] = useState<LanguageModeT>(initialMode);
  const [effectiveLocale, setEffectiveLocale] = useState<SupportedLocaleT>(() =>
    resolveEffectiveLocale(initialMode, navigator.languages ?? []),
  );

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    void bridge
      .invoke('settings.get', {})
      .then((result) => {
        if (!result.ok) return;
        setLanguageModeState(result.data.languageMode);
        setEffectiveLocale(result.data.effectiveLocale);
        writeCachedLanguageMode(result.data.languageMode);
      })
      .catch(() => undefined);
  }, []);

  const setLanguageMode = useCallback(async (mode: LanguageModeT): Promise<boolean> => {
    const bridge = window.kodaxSpace;
    if (!bridge) return false;
    try {
      const result = await bridge.invoke('settings.setLanguageMode', { languageMode: mode });
      if (!result.ok) return false;
      setLanguageModeState(result.data.languageMode);
      setEffectiveLocale(result.data.effectiveLocale);
      writeCachedLanguageMode(result.data.languageMode);
      return true;
    } catch {
      return false;
    }
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>): string =>
      interpolate(messages[effectiveLocale][key], vars),
    [effectiveLocale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      languageMode,
      effectiveLocale,
      setLanguageMode,
      t,
    }),
    [effectiveLocale, languageMode, setLanguageMode, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (value === null) throw new Error('useI18n must be used within I18nProvider');
  return value;
}

export function localeDisplayName(locale: SupportedLocaleT): string {
  return locale === 'zh-CN' ? '简体中文' : 'English';
}
