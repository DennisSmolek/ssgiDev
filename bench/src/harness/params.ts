import type { FolderApi } from 'tweakpane';

export type NumberParam = {
  type: 'number';
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
};
export type BooleanParam = { type: 'boolean'; value: boolean; label?: string };
export type EnumParam<T extends string = string> = {
  type: 'enum';
  value: T;
  options: readonly T[];
  label?: string;
};

export type ParamSpec = NumberParam | BooleanParam | EnumParam;
export type ParamSchema = Record<string, ParamSpec>;

type ValueOf<S extends ParamSpec> = S extends NumberParam
  ? number
  : S extends BooleanParam
    ? boolean
    : S extends EnumParam<infer T>
      ? T
      : never;

export type ParamValues<T extends ParamSchema> = { -readonly [K in keyof T]: ValueOf<T[K]> };

export interface ParamGroup<T extends ParamSchema> {
  values: ParamValues<T>;
  onChange(cb: (key: keyof T) => void): void;
  // Re-syncs the Tweakpane widgets after mutating `values` programmatically.
  refresh(): void;
  exportJSON(): string;
  importJSON(json: string): void;
}

// Builds a Tweakpane folder from a schema and returns a typed values object.
// Values export/import as JSON (used for presets and screenshot-embedded config).
export function buildParams<T extends ParamSchema>(
  folder: FolderApi,
  schema: T,
): ParamGroup<T> {
  const values = {} as ParamValues<T>;
  const listeners: Array<(key: keyof T) => void> = [];
  const bindings = new Map<keyof T, { refresh(): void }>();

  for (const key of Object.keys(schema) as Array<keyof T>) {
    const spec = schema[key];
    (values as Record<string, unknown>)[key as string] = spec.value;

    let opts: Record<string, unknown> = { label: spec.label ?? (key as string) };
    if (spec.type === 'number') {
      opts = { ...opts, min: spec.min, max: spec.max, step: spec.step };
    } else if (spec.type === 'enum') {
      const map: Record<string, string> = {};
      for (const o of spec.options) map[o] = o;
      opts = { ...opts, options: map };
    }

    const binding = folder.addBinding(
      values as Record<string, unknown>,
      key as string,
      opts,
    );
    binding.on('change', () => {
      for (const cb of listeners) cb(key);
    });
    bindings.set(key, binding);
  }

  const group: ParamGroup<T> = {
    values,
    onChange(cb: (key: keyof T) => void) {
      listeners.push(cb);
    },
    refresh() {
      for (const b of bindings.values()) b.refresh();
    },
    exportJSON() {
      return JSON.stringify(values, null, 2);
    },
    importJSON(json: string) {
      const parsed = JSON.parse(json) as Partial<ParamValues<T>>;
      for (const key of Object.keys(schema) as Array<keyof T>) {
        if (key in parsed && parsed[key] !== undefined) {
          (values as Record<string, unknown>)[key as string] = parsed[key];
        }
      }
      for (const b of bindings.values()) b.refresh();
      for (const cb of listeners) for (const key of Object.keys(schema) as Array<keyof T>) cb(key);
    },
  };

  // Copy/paste current values as JSON (screenshot-embeddable presets).
  folder.addButton({ title: 'copy config' }).on('click', () => {
    void navigator.clipboard?.writeText(group.exportJSON());
  });
  folder.addButton({ title: 'paste config' }).on('click', () => {
    void navigator.clipboard?.readText().then((t) => {
      try {
        group.importJSON(t);
      } catch {
        /* ignore malformed clipboard */
      }
    });
  });

  return group;
}
