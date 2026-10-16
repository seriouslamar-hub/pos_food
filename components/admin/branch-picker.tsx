import { Select } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

/**
 * The admin's active branches and the one chosen with ?branch= (the first
 * by name when none is chosen). Null when there are no branches yet.
 */
export async function adminBranch(
  branch: string | string[] | undefined,
): Promise<{
  branches: { id: string; name: string }[];
  branchId: string;
} | null> {
  const supabase = await createClient();
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (!branches?.length) return null;
  const branchId =
    typeof branch === "string" && branches.some((b) => b.id === branch)
      ? branch
      : branches[0].id;
  return { branches, branchId };
}

/** A small GET form to switch branch on admin report pages. */
export function BranchPicker({
  branches,
  branchId,
}: {
  branches: { id: string; name: string }[];
  branchId: string;
}) {
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-label="Choose a branch"
    >
      <label className="flex flex-col gap-1 text-sm">
        Branch
        <Select name="branch" defaultValue={branchId} className="w-56">
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" variant="outline" size="lg">
        Show
      </Button>
    </form>
  );
}
