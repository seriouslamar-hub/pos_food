"use client";

import { useState, useTransition } from "react";
import { FormError } from "@/components/admin/form";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { setRolePermission } from "@/lib/actions/catalog";
import {
  PERMISSION_LABELS,
  PERMISSIONS,
  type Permission,
} from "@/lib/permissions";

type EditableRole = "manager" | "cashier";

/**
 * Permissions × roles. Admins always have everything. A change applies to the
 * till from the next PIN sign-in, and to database checks immediately.
 */
export function PermissionGrid({
  granted,
}: {
  granted: Record<EditableRole, string[]>;
}) {
  const [state, setState] = useState(() => ({
    manager: new Set(granted.manager),
    cashier: new Set(granted.cashier),
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(role: EditableRole, permission: Permission, on: boolean) {
    const key = `${role}:${permission}`;
    setError(null);
    setBusy(key);
    setState((prev) => {
      const next = new Set(prev[role]);
      if (on) next.add(permission);
      else next.delete(permission);
      return { ...prev, [role]: next };
    });
    startTransition(async () => {
      const result = await setRolePermission(role, permission, on);
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        setState((prev) => {
          const next = new Set(prev[role]);
          if (on) next.delete(permission);
          else next.add(permission);
          return { ...prev, [role]: next };
        });
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Permission</TableHead>
            <TableHead className="text-center">Admin</TableHead>
            <TableHead className="text-center">Manager</TableHead>
            <TableHead className="text-center">Cashier</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {PERMISSIONS.map((permission) => (
            <TableRow key={permission}>
              <TableCell>
                <div className="font-medium">
                  {PERMISSION_LABELS[permission]}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {permission}
                </div>
              </TableCell>
              <TableCell className="text-center">
                <Checkbox
                  checked
                  disabled
                  aria-label={`Admin: ${PERMISSION_LABELS[permission]} (always on)`}
                />
              </TableCell>
              {(["manager", "cashier"] as const).map((role) => (
                <TableCell key={role} className="text-center">
                  <Checkbox
                    checked={state[role].has(permission)}
                    disabled={busy === `${role}:${permission}`}
                    onCheckedChange={(checked) =>
                      toggle(role, permission, checked === true)
                    }
                    aria-label={`${role === "manager" ? "Manager" : "Cashier"}: ${PERMISSION_LABELS[permission]}`}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
