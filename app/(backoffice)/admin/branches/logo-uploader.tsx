"use client";

import { useState, useTransition } from "react";
import { FormError } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { setBranchLogo } from "@/lib/actions/branches";
import { createClient } from "@/lib/supabase/client";

const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_BYTES = 1024 * 1024;

/**
 * Uploads a branch logo straight to the public "branding" bucket (storage
 * policies only let admins write there), then saves its URL on the branch.
 */
export function LogoUploader({
  branchId,
  logoUrl,
}: {
  branchId: string;
  logoUrl: string | null;
}) {
  const [supabase] = useState(createClient);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function upload(file: File) {
    setError(null);
    const ext = TYPES[file.type];
    if (!ext) return setError("Use a PNG, JPEG or WebP image.");
    if (file.size > MAX_BYTES)
      return setError("The logo must be 1 MB or smaller.");

    startTransition(async () => {
      const path = `branches/${branchId}/logo-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("branding")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        setError("Couldn't upload the logo. Try again.");
        return;
      }
      const { data } = supabase.storage.from("branding").getPublicUrl(path);
      const result = await setBranchLogo(branchId, data.publicUrl);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-24 items-center justify-center overflow-hidden rounded-xl border bg-muted/40">
          {logoUrl ? (
            // A user-uploaded image from Supabase Storage; its host differs per environment.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Branch logo"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-xs text-muted-foreground">No logo</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label className="inline-flex">
            <span className="sr-only">Upload a logo</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload(file);
                e.target.value = "";
              }}
              className="text-sm file:mr-3 file:h-9 file:rounded-lg file:border file:bg-background file:px-3 file:text-sm"
            />
          </label>
          {logoUrl ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              className="self-start"
              onClick={() =>
                startTransition(async () => {
                  const result = await setBranchLogo(branchId, null);
                  if (!result.ok) setError(result.error);
                })
              }
            >
              Remove logo
            </Button>
          ) : null}
          <p className="text-sm text-muted-foreground">
            PNG, JPEG or WebP, up to 1 MB. Printed on receipts.
          </p>
        </div>
      </div>
      <FormError message={error} />
    </div>
  );
}
