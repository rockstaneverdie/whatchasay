import type { UiLang } from '../core/storage/settings';
import en from './en.json';
import ru from './ru.json';

export type MessageKey = keyof typeof ru;
type Dict = Record<MessageKey, string>;

const DICTS: Record<UiLang, Dict> = { ru, en: en satisfies Dict };

export function translate(lang: UiLang, key: MessageKey, params?: Record<string, string | number>): string {
  const template = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    params[name] !== undefined ? String(params[name]) : m,
  );
}

export function detectUiLang(): UiLang {
  const lang = (globalThis.navigator?.language ?? 'en').toLowerCase();
  return lang.startsWith('ru') ? 'ru' : 'en';
}
