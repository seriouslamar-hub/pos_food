"use client";

import { useState, useTransition } from "react";
import { Field, FormError, Select } from "@/components/admin/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  loadSampleInventory,
  saveIngredient,
  saveRecipe,
  saveSupplier,
  type IngredientInput,
  type SupplierInput,
} from "@/lib/actions/inventory";
import {
  formatQuantity,
  STOCK_UNITS,
  UNIT_LABELS,
  type StockUnit,
} from "@/lib/inventory";
import { formatAmount, toMoneyInput } from "@/lib/money";
import { useFieldIds } from "@/lib/use-field-ids";

export type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
};

export type Ingredient = {
  id: string;
  name: string;
  unit: StockUnit;
  category: string | null;
  cost_per_unit: number;
  reorder_level: number;
  supplier_id: string | null;
  is_active: boolean;
};

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  function run(
    action: () => Promise<{
      ok: boolean;
      error?: string;
      fieldErrors?: Record<string, string>;
    }>,
    onDone?: () => void,
  ) {
    setError(null);
    setFieldErrors({});
    start(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      onDone?.();
    });
  }
  return { pending, error, fieldErrors, run };
}

export function LoadSampleInventory() {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        size="lg"
        disabled={pending}
        onClick={() => run(loadSampleInventory)}
      >
        {pending ? "Adding…" : "Start with sample ingredients and recipes"}
      </Button>
      <FormError message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export function SuppliersManager({ suppliers }: { suppliers: Supplier[] }) {
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button size="lg" onClick={() => setEditing("new")}>
          Add supplier
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">
                  {s.name}
                  {s.is_active ? null : (
                    <Badge variant="outline" className="ml-2">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{s.phone ?? "–"}</TableCell>
                <TableCell>{s.email ?? "–"}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(s)}
                  >
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing ? (
        <SupplierDialog
          supplier={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function SupplierDialog({
  supplier,
  onClose,
}: {
  supplier: Supplier | null;
  onClose: () => void;
}) {
  const fid = useFieldIds();
  const { pending, error, fieldErrors, run } = useAction();
  const [values, setValues] = useState<SupplierInput>({
    name: supplier?.name ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    isActive: supplier?.is_active ?? true,
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {supplier ? "Edit supplier" : "Add supplier"}
          </DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveSupplier(supplier?.id ?? null, values), onClose);
          }}
        >
          <FormError message={error} />
          <Field id={fid("name")} label="Name" error={fieldErrors.name}>
            <Input
              id={fid("name")}
              value={values.name}
              onChange={(e) => setValues({ ...values, name: e.target.value })}
            />
          </Field>
          <Field id={fid("phone")} label="Phone">
            <Input
              id={fid("phone")}
              value={values.phone}
              onChange={(e) => setValues({ ...values, phone: e.target.value })}
            />
          </Field>
          <Field id={fid("email")} label="Email">
            <Input
              id={fid("email")}
              type="email"
              value={values.email}
              onChange={(e) => setValues({ ...values, email: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={values.isActive}
              onCheckedChange={(c) =>
                setValues({ ...values, isActive: c === true })
              }
            />
            Active
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save supplier"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

export function IngredientsManager({
  ingredients,
  suppliers,
  currency,
}: {
  ingredients: Ingredient[];
  suppliers: Supplier[];
  currency: string;
}) {
  const [editing, setEditing] = useState<Ingredient | "new" | null>(null);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button size="lg" onClick={() => setEditing("new")}>
          Add ingredient
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Reorder at</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ingredients.map((i) => (
              <TableRow key={i.id} data-testid="ingredient-row">
                <TableCell className="font-medium">
                  {i.name}
                  {i.is_active ? null : (
                    <Badge variant="outline" className="ml-2">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{i.category ?? "–"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(i.cost_per_unit, currency)} / {i.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatQuantity(i.reorder_level, i.unit)}
                </TableCell>
                <TableCell>
                  {i.supplier_id ? supplierName.get(i.supplier_id) : "–"}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(i)}
                  >
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing ? (
        <IngredientDialog
          ingredient={editing === "new" ? null : editing}
          suppliers={suppliers}
          currency={currency}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function IngredientDialog({
  ingredient,
  suppliers,
  currency,
  onClose,
}: {
  ingredient: Ingredient | null;
  suppliers: Supplier[];
  currency: string;
  onClose: () => void;
}) {
  const fid = useFieldIds();
  const { pending, error, fieldErrors, run } = useAction();
  const [values, setValues] = useState<IngredientInput>({
    name: ingredient?.name ?? "",
    unit: ingredient?.unit ?? "pc",
    category: ingredient?.category ?? "",
    cost: ingredient ? toMoneyInput(ingredient.cost_per_unit, currency) : "",
    reorderLevel: ingredient ? formatQuantity(ingredient.reorder_level) : "",
    supplierId: ingredient?.supplier_id ?? "",
    isActive: ingredient?.is_active ?? true,
  });
  const set = (patch: Partial<IngredientInput>) =>
    setValues({ ...values, ...patch });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {ingredient ? "Edit ingredient" : "Add ingredient"}
          </DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveIngredient(ingredient?.id ?? null, values), onClose);
          }}
        >
          <div className="sm:col-span-2">
            <FormError message={error} />
          </div>
          <Field id={fid("name")} label="Name" error={fieldErrors.name}>
            <Input
              id={fid("name")}
              value={values.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field id={fid("unit")} label="Counted in" error={fieldErrors.unit}>
            <Select
              id={fid("unit")}
              value={values.unit}
              onChange={(e) => set({ unit: e.target.value })}
            >
              {STOCK_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]} ({u})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id={fid("cost")}
            label={`Cost per ${values.unit} (${currency})`}
            error={fieldErrors.cost}
            hint="Updated to the latest price when a delivery is received."
          >
            <Input
              id={fid("cost")}
              inputMode="decimal"
              value={values.cost}
              onChange={(e) => set({ cost: e.target.value })}
            />
          </Field>
          <Field
            id={fid("reorder")}
            label="Reorder below"
            error={fieldErrors.reorderLevel}
            hint="Shows as low stock under this."
          >
            <Input
              id={fid("reorder")}
              inputMode="decimal"
              value={values.reorderLevel}
              onChange={(e) => set({ reorderLevel: e.target.value })}
            />
          </Field>
          <Field
            id={fid("category")}
            label="Category"
            hint="For counting, e.g. Produce."
          >
            <Input
              id={fid("category")}
              value={values.category}
              onChange={(e) => set({ category: e.target.value })}
            />
          </Field>
          <Field id={fid("supplier")} label="Supplier">
            <Select
              id={fid("supplier")}
              value={values.supplierId}
              onChange={(e) => set({ supplierId: e.target.value })}
            >
              <option value="">None</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={values.isActive}
              onCheckedChange={(c) => set({ isActive: c === true })}
            />
            Active
          </label>
          <Button type="submit" disabled={pending} className="sm:col-span-2">
            {pending ? "Saving…" : "Save ingredient"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export type RecipeOwner = {
  kind: "item" | "modifier";
  id: string;
  name: string;
  group: string;
  lines: { ingredient_id: string; quantity: number }[];
};

export function RecipesManager({
  owners,
  ingredients,
}: {
  owners: RecipeOwner[];
  ingredients: Ingredient[];
}) {
  const [editing, setEditing] = useState<RecipeOwner | null>(null);
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const groups = [...new Set(owners.map((o) => o.group))];
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{group}</h2>
          <ul className="divide-y rounded-xl border">
            {owners
              .filter((o) => o.group === group)
              .map((o) => (
                <li
                  key={`${o.kind}-${o.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  data-testid="recipe-row"
                >
                  <span>
                    <span className="font-medium">{o.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {o.lines.length
                        ? o.lines
                            .map((l) => {
                              const ing = byId.get(l.ingredient_id);
                              return `${formatQuantity(l.quantity, ing?.unit)} ${ing?.name ?? "?"}`;
                            })
                            .join(", ")
                        : "No recipe yet"}
                    </span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Edit recipe for ${o.name}`}
                    onClick={() => setEditing(o)}
                  >
                    Edit recipe
                  </Button>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {editing ? (
        <RecipeDialog
          owner={editing}
          ingredients={ingredients}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function RecipeDialog({
  owner,
  ingredients,
  onClose,
}: {
  owner: RecipeOwner;
  ingredients: Ingredient[];
  onClose: () => void;
}) {
  const fid = useFieldIds();
  const { pending, error, run } = useAction();
  const [lines, setLines] = useState(
    owner.lines.length
      ? owner.lines.map((l) => ({
          ingredientId: l.ingredient_id,
          quantity: formatQuantity(l.quantity),
        }))
      : [{ ingredientId: "", quantity: "" }],
  );
  const unitOf = (id: string) => ingredients.find((i) => i.id === id)?.unit;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Recipe: {owner.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {owner.kind === "item"
            ? "What one of these uses. A meal's parts use their own recipes; list only what the meal adds (e.g. its box)."
            : "What choosing this adds, on top of the item's own recipe."}
        </p>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => saveRecipe({ kind: owner.kind, id: owner.id }, lines),
              onClose,
            );
          }}
        >
          <FormError message={error} />
          {lines.map((line, i) => (
            <div key={i} className="flex items-end gap-2">
              <label
                htmlFor={fid(`ing-${i}`)}
                className="flex flex-1 flex-col gap-1 text-sm"
              >
                Ingredient
                <Select
                  id={fid(`ing-${i}`)}
                  value={line.ingredientId}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, j) =>
                        j === i ? { ...l, ingredientId: e.target.value } : l,
                      ),
                    )
                  }
                >
                  <option value="">Choose…</option>
                  {ingredients.map((ing) => (
                    <option key={ing.id} value={ing.id}>
                      {ing.name} ({ing.unit})
                    </option>
                  ))}
                </Select>
              </label>
              <label
                htmlFor={fid(`qty-${i}`)}
                className="flex w-32 flex-col gap-1 text-sm"
              >
                Quantity
                {unitOf(line.ingredientId)
                  ? ` (${unitOf(line.ingredientId)})`
                  : ""}
                <Input
                  id={fid(`qty-${i}`)}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, j) =>
                        j === i ? { ...l, quantity: e.target.value } : l,
                      ),
                    )
                  }
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
                aria-label={`Remove line ${i + 1}`}
              >
                Remove
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setLines([...lines, { ingredientId: "", quantity: "" }])
              }
            >
              Add ingredient
            </Button>
            <Button type="submit" disabled={pending} className="ml-auto">
              {pending ? "Saving…" : "Save recipe"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
