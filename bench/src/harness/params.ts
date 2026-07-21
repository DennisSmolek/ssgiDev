import type { FolderApi } from 'tweakpane';

// `group` nests the control in a sub-folder of that title (created on first
// use, in schema order; ungrouped controls stay at the folder root). `hint`
// becomes a native hover tooltip (title attr) explaining what/why.
type CommonParam = { label?: string; group?: string; hint?: string };
export type NumberParam = CommonParam & {
  type: 'number';
  value: number;
  min?: number;
  max?: number;
  step?: number;
};
export type BooleanParam = CommonParam & { type: 'boolean'; value: boolean };
export type EnumParam<T extends string = string> = CommonParam & {
  type: 'enum';
  value: T;
  options: readonly T[];
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
  const subFolders = new Map<string, FolderApi>();

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

    let target = folder;
    if (spec.group) {
      let sub = subFolders.get(spec.group);
      if (!sub) {
        sub = folder.addFolder({ title: spec.group, expanded: true });
        subFolders.set(spec.group, sub);
      }
      target = sub;
    }

    const binding = target.addBinding(
      values as Record<string, unknown>,
      key as string,
      opts,
    );
    if (spec.hint) binding.element.title = spec.hint;
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
      // Notify only keys whose value actually changed: blanket notification
      // made every applyConfig fire ref-view listeners (refRays/refSteps/...)
      // in demos 03/04/05, silently resetting the oracle's accumulation on
      // unrelated config touches (caught by the Track A runner, 2026-07-21).
      const changed: Array<keyof T> = [];
      for (const key of Object.keys(schema) as Array<keyof T>) {
        if (key in parsed && parsed[key] !== undefined) {
          if ((values as Record<string, unknown>)[key as string] !== parsed[key]) changed.push(key);
          (values as Record<string, unknown>)[key as string] = parsed[key];
        }
      }
      for (const b of bindings.values()) b.refresh();
      for (const cb of listeners) for (const key of changed) cb(key);
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

  // Scripted-driver hook (bench/scripts runners): programmatic config
  // import/export without clipboard permission grants. Each demo builds one
  // group; runners use the last-registered entry (or find by folder title).
  type BenchParamsHook = { title: string; export(): string; import(json: string): void };
  const w = window as unknown as { __benchParams?: BenchParamsHook[] };
  (w.__benchParams ??= []).push({
    title: folder.title ?? 'params',
    export: () => group.exportJSON(),
    import: (json: string) => group.importJSON(json),
  });

  return group;
}
