/**
 * Form validation shared by the browser (instant feedback) and Server Actions
 * (the authoritative check). Inputs are the raw form values (strings and
 * booleans); outputs are ready for the database.
 */
import { z } from "zod";
import { parsePercentToBps } from "./percent";

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const requiredText = (what: string, max = 100) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${what}`)
    .max(max, `Keep this under ${max} characters`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .transform((v) => (v === "" ? null : v));

const percentBps = (what: string) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      let bps: number;
      try {
        bps = parsePercentToBps(value === "" ? "0" : value);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: `Enter ${what} as a number, like 10 or 12.5`,
        });
        return z.NEVER;
      }
      if (bps < 0 || bps > 10000) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a percentage from 0 to 100",
        });
        return z.NEVER;
      }
      return bps;
    });

const sortOrder = z
  .string()
  .trim()
  .regex(/^\d{0,4}$/, "Enter a whole number")
  .transform((v) => (v === "" ? 0 : Number(v)));

const optionalUuid = (message: string) =>
  z
    .string()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.uuid(message).nullable());

export function isTimeZone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function isCurrencyCode(value: string): boolean {
  return (
    /^[A-Z]{3}$/.test(value) &&
    Intl.supportedValuesOf("currency").includes(value)
  );
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

export const branchSchema = z.object({
  name: requiredText("a branch name"),
  address: optionalText(300),
  phone: optionalText(40),
  timezone: z.string().trim().refine(isTimeZone, "Choose a timezone"),
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isCurrencyCode, "Choose a currency"),
  receiptHeader: optionalText(500),
  receiptFooter: optionalText(500),
  isActive: z.boolean(),
});
export type BranchFormValues = z.input<typeof branchSchema>;

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const STAFF_ROLES = ["admin", "manager", "cashier"] as const;
export type StaffRoleValue = (typeof STAFF_ROLES)[number];

export const optionalPin = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{4,6}$/.test(v), "PIN must be 4 to 6 digits")
  .transform((v) => (v === "" ? null : v));

export const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits");

const staffFields = z.object({
  fullName: requiredText("their name"),
  role: z.enum(STAFF_ROLES, "Choose a role"),
  branchId: optionalUuid("Choose a branch"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.email("Enter a valid email address").nullable()),
  phone: optionalText(40),
  discountPercent: percentBps("the discount limit"),
  isActive: z.boolean(),
});

function staffRules(
  v: { role: StaffRoleValue; branchId: string | null; email: string | null },
  ctx: z.RefinementCtx,
) {
  if (v.role !== "admin" && !v.branchId) {
    ctx.addIssue({
      code: "custom",
      path: ["branchId"],
      message: "Choose a branch",
    });
  }
  if (v.role !== "cashier" && !v.email) {
    ctx.addIssue({
      code: "custom",
      path: ["email"],
      message: "Admins and managers need an email to sign in",
    });
  }
}

export const staffSchema = staffFields.superRefine(staffRules);
export const staffCreateSchema = staffFields
  .extend({ pin: optionalPin })
  .superRefine(staffRules);
export type StaffFormValues = z.input<typeof staffCreateSchema>;

/** What a manager can set for a cashier in their own branch. */
export const cashierSchema = z.object({
  fullName: requiredText("their name"),
  phone: optionalText(40),
  discountPercent: percentBps("the discount limit"),
  isActive: z.boolean(),
});
export const cashierCreateSchema = cashierSchema.extend({ pin: optionalPin });
export type CashierFormValues = z.input<typeof cashierCreateSchema>;

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export const DEVICE_TYPES = ["till", "kds", "pickup", "kiosk"] as const;
export type DeviceTypeValue = (typeof DEVICE_TYPES)[number];

export const deviceSchema = z
  .object({
    branchId: z.uuid("Choose a branch"),
    name: requiredText("a device name", 60),
    type: z.enum(DEVICE_TYPES, "Choose a device type"),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{1,6}$/, "Use 1 to 6 letters or numbers, like T1"),
    station: optionalText(40),
    isActive: z.boolean(),
  })
  .transform((v) => ({ ...v, station: v.type === "kds" ? v.station : null }));
export type DeviceFormValues = z.input<typeof deviceSchema>;

// ---------------------------------------------------------------------------
// Taxes and payment methods
// ---------------------------------------------------------------------------

export const taxSchema = z.object({
  name: requiredText("a tax name", 60),
  ratePercent: percentBps("the rate"),
  isInclusive: z.boolean(),
  taxCategory: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9_]+$/,
      "Use lowercase letters, numbers and underscores, like standard",
    ),
  sortOrder,
  isActive: z.boolean(),
});
export type TaxFormValues = z.input<typeof taxSchema>;

export const PAYMENT_TYPES = ["cash", "card", "mobile_money", "other"] as const;
export type PaymentTypeValue = (typeof PAYMENT_TYPES)[number];

export const paymentMethodSchema = z
  .object({
    type: z.enum(PAYMENT_TYPES, "Choose a type"),
    name: requiredText("a name", 40),
    isEnabled: z.boolean(),
    requiresReference: z.boolean(),
    sortOrder,
  })
  .transform((v) => ({
    ...v,
    requiresReference: v.type === "cash" ? false : v.requiresReference,
  }));
export type PaymentMethodFormValues = z.input<typeof paymentMethodSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** First message per field, keyed by field name ("_form" for the whole form). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    out[key] ??= issue.message;
  }
  return out;
}
