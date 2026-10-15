"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FormError, FormSuccess, Select } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { saveSettings, type SettingInput } from "@/lib/actions/settings";
import {
  parseSettingInput,
  SETTINGS,
  settingToInput,
  type SettingDefinition,
  type SettingValue,
} from "@/lib/settings";
import { useFieldIds } from "@/lib/use-field-ids";

export function SettingsForm({
  branchId,
  branches,
  defaults,
  overrides,
}: {
  branchId: string | null;
  branches: { id: string; name: string }[];
  defaults: Record<string, SettingValue>;
  overrides: Record<string, SettingValue>;
}) {
  const fid = useFieldIds();
  const router = useRouter();
  const [inputs, setInputs] = useState<Record<string, SettingInput>>(() =>
    Object.fromEntries(
      SETTINGS.map((def) => {
        const own = branchId ? overrides[def.key] : defaults[def.key];
        return [
          def.key,
          {
            value: settingToInput(
              def,
              own ?? defaults[def.key] ?? def.fallback,
            ),
            useDefault: branchId !== null && own === undefined,
          },
        ];
      }),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function update(key: string, patch: Partial<SettingInput>) {
    setSaved(false);
    setInputs((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const clientErrors: Record<string, string> = {};
    for (const def of SETTINGS) {
      const input = inputs[def.key];
      if (branchId && input.useDefault) continue;
      const parsed = parseSettingInput(def, input.value);
      if (!parsed.ok) clientErrors[def.key] = parsed.error;
    }
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) {
      setError("Check the highlighted settings.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveSettings(branchId, inputs);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Field
        id={fid("scope")}
        label="Settings for"
        hint={
          branchId
            ? "Untick “Use default” to give this branch its own value."
            : "Every branch uses these unless it has its own value."
        }
      >
        <Select
          id={fid("scope")}
          value={branchId ?? ""}
          onChange={(e) =>
            router.push(
              e.target.value
                ? `/admin/settings?branch=${e.target.value}`
                : "/admin/settings",
            )
          }
        >
          <option value="">All branches (defaults)</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>

      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FormError message={error} />
        {SETTINGS.map((def) => (
          <SettingField
            key={def.key}
            def={def}
            input={inputs[def.key]}
            error={errors[def.key]}
            defaultValue={defaults[def.key] ?? def.fallback}
            branchScope={branchId !== null}
            onChange={(patch) => update(def.key, patch)}
          />
        ))}
        <FormSuccess message={saved ? "Settings saved." : null} />
        <div>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function describe(def: SettingDefinition, value: SettingValue): string {
  if (def.kind === "boolean") return value ? "Yes" : "No";
  if (def.kind === "choice")
    return def.options.find((o) => o.value === value)?.label ?? String(value);
  if (def.kind === "percent") return `${settingToInput(def, value)}%`;
  return String(value);
}

function SettingField({
  def,
  input,
  error,
  defaultValue,
  branchScope,
  onChange,
}: {
  def: SettingDefinition;
  input: SettingInput;
  error?: string;
  defaultValue: SettingValue;
  branchScope: boolean;
  onChange: (patch: Partial<SettingInput>) => void;
}) {
  const fid = useFieldIds();
  const id = fid(def.key.replace(/\./g, "-"));
  const disabled = branchScope && input.useDefault;
  const control =
    def.kind === "boolean" ? (
      <Select
        id={id}
        value={input.value}
        disabled={disabled}
        onChange={(e) => onChange({ value: e.target.value })}
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    ) : def.kind === "choice" ? (
      <Select
        id={id}
        value={input.value}
        disabled={disabled}
        onChange={(e) => onChange({ value: e.target.value })}
      >
        {def.options.map((o) => (
          <option key={o.value} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </Select>
    ) : (
      <Input
        id={id}
        inputMode={def.kind === "percent" ? "decimal" : "numeric"}
        value={input.value}
        disabled={disabled}
        onChange={(e) => onChange({ value: e.target.value })}
        aria-invalid={error ? true : undefined}
        className="max-w-40"
      />
    );

  return (
    <div className="flex flex-col gap-2 rounded-xl border p-4">
      <Field id={id} label={def.label} error={error} hint={def.help}>
        {control}
      </Field>
      {branchScope ? (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={input.useDefault}
            onCheckedChange={(checked) =>
              onChange({
                useDefault: checked === true,
                value:
                  checked === true
                    ? settingToInput(def, defaultValue)
                    : input.value,
              })
            }
          />
          Use default ({describe(def, defaultValue)})
        </label>
      ) : null}
    </div>
  );
}
