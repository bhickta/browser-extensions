type SettingType = 'boolean' | 'number' | 'hotkey' | 'color' | 'select' | 'list';

interface SettingSpec {
  type: SettingType;
  default: unknown;
  label?: string;
  group?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

interface SettingsGroup {
  title: string;
  fields: string[];
}

interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface StorageNamespace {
  local: StorageArea;
  onChanged: {
    addListener(callback: (changes: Record<string, StorageChange>, area: string) => void): void;
  };
}

interface TabsNamespace {
  query(query: { active?: boolean; currentWindow?: boolean }): Promise<Array<{ id?: number; url?: string }>>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

interface RuntimeNamespace {
  onMessage: {
    addListener(callback: (message: { type?: string } | undefined) => void): void;
  };
}

interface SvsWebExtApi {
  storage: StorageNamespace;
  tabs: TabsNamespace;
  runtime: RuntimeNamespace;
}

interface SvsShared {
  SETTINGS: Record<string, SettingSpec>;
  GROUPS: SettingsGroup[];
  DEFAULTS: Record<string, unknown>;
  sanitizeValue(key: string, value: unknown): unknown;
  sanitizeSettings(raw: unknown): Record<string, unknown>;
  sanitizePartial(raw: unknown): Record<string, unknown>;
  getApi(): SvsWebExtApi;
  hostFor(url: string): string;
  isEditable(element: EventTarget | null): boolean;
  formatTime(value: number): string;
  clamp(value: number, min: number, max: number): number;
}

declare var SVS: SvsShared;
declare var browser: SvsWebExtApi | undefined;
declare var chrome: SvsWebExtApi | undefined;
declare var __SVS_EXTENSION_LOADED__: boolean | undefined;
