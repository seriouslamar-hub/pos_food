"use client";

import { useState, useTransition } from "react";
import { FormError } from "@/components/admin/form";
import { SortableList } from "@/components/admin/sortable-list";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { reorderMenu, saveStation } from "@/lib/actions/menu";

type Station = { id: string; name: string; is_active: boolean };

export function StationsEditor({ stations }: { stations: Station[] }) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <FormError message={error} />
      {stations.length ? (
        <SortableList
          id="kds-stations"
          label="Kitchen stations"
          items={stations}
          onReorder={(ids) =>
            startTransition(async () => {
              const result = await reorderMenu("kds_stations", ids);
              setError(result.ok ? null : result.error);
            })
          }
          renderItem={(s) => (
            <StationEditor
              stationId={s.id}
              initialName={s.name}
              initialActive={s.is_active}
            />
          )}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No stations yet.</p>
      )}
      <div className="rounded-xl border border-dashed p-3">
        <p className="mb-2 text-sm font-medium">Add a station</p>
        <StationEditor key={stations.length} initialName="" initialActive />
      </div>
    </div>
  );
}

function StationEditor({
  stationId,
  initialName,
  initialActive,
}: {
  stationId?: string;
  initialName: string;
  initialActive: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [active, setActive] = useState(initialActive);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={
            stationId ? `Station name ${initialName}` : "New station name"
          }
          placeholder="Station name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-48"
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={active}
            onCheckedChange={(c) => setActive(c === true)}
          />
          In use
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await saveStation(stationId ?? null, {
                name,
                isActive: active,
              });
              setError(result.ok ? null : result.error);
              if (result.ok && !stationId) setName("");
            })
          }
        >
          {stationId ? "Save" : "Add"}
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}
