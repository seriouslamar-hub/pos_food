import "server-only";
import { getActionStaff } from "@/lib/auth";
import { addDays, isIsoDate } from "@/lib/datetime";
import { currencyFractionDigits } from "@/lib/money";
import {
  branchArg,
  dateWindows,
  EXPORT_KINDS,
  exportRow,
  isExportKind,
  toCsv,
  type CsvCell,
} from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";

function fail(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * GET ?kind=sales|payments|tax&from=&to=[&branch=id|all]: a CSV for the
 * accountant, streamed month by month. The database checks who may see
 * which branch (report_export); managers always get their own branch.
 */
export async function exportReport(request: Request): Promise<Response> {
  const staff = await getActionStaff(["admin", "manager"]);
  if (!staff) return fail(401, "Sign in to export reports.");
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const from = params.get("from");
  const to = params.get("to");
  if (!isExportKind(kind)) return fail(400, "Unknown export.");
  if (
    !isIsoDate(from) ||
    !isIsoDate(to) ||
    to < from ||
    from < addDays(to, -366)
  )
    return fail(400, "Choose dates up to a year apart.");
  const branchParam = params.get("branch");
  const branchId =
    staff.role === "admin"
      ? branchParam && branchParam !== "all"
        ? branchParam
        : null
      : staff.branchId;

  const supabase = await createClient();
  const { data: branches } = await supabase
    .from("branches")
    .select("currency_code");
  const digits = new Map(
    (branches ?? []).map((b) => [
      b.currency_code,
      currencyFractionDigits(b.currency_code),
    ]),
  );
  const digitsFor = (currency: string) => digits.get(currency) ?? 2;

  // Check access (and the first window) before sending any bytes.
  const windows = dateWindows(from, to);
  const first = await supabase.rpc("report_export", {
    p_kind: kind,
    p_branch_id: branchArg(branchId),
    p_from: windows[0].from,
    p_to: windows[0].to,
  });
  if (first.error)
    return fail(first.error.code === "42501" ? 403 : 400, first.error.message);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(toCsv([[...EXPORT_KINDS[kind].header]])),
      );
      const write = (rows: unknown) => {
        const list = (rows as CsvCell[][] | null) ?? [];
        if (list.length)
          controller.enqueue(
            encoder.encode(
              toCsv(
                list.map((r) => exportRow(kind, r, digitsFor)),
                false,
              ),
            ),
          );
      };
      write(first.data);
      for (const window of windows.slice(1)) {
        const { data, error } = await supabase.rpc("report_export", {
          p_kind: kind,
          p_branch_id: branchArg(branchId),
          p_from: window.from,
          p_to: window.to,
        });
        if (error) {
          controller.error(new Error(error.message));
          return;
        }
        write(data);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind}-${from}-to-${to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
