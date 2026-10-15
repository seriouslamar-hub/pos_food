"use client";

import { ImageUploader } from "@/components/admin/image-uploader";
import { setBranchLogo } from "@/lib/actions/branches";

/** The branch logo, kept in the admin-only "branding" bucket. */
export function LogoUploader({
  branchId,
  logoUrl,
}: {
  branchId: string;
  logoUrl: string | null;
}) {
  return (
    <ImageUploader
      bucket="branding"
      folder={`branches/${branchId}`}
      imageUrl={logoUrl}
      alt="Branch logo"
      hint="PNG, JPEG or WebP, up to 1 MB. Printed on receipts."
      maxBytes={1024 * 1024}
      onSave={(url) => setBranchLogo(branchId, url)}
    />
  );
}
