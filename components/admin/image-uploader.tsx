"use client";

import { useState, useTransition } from "react";
import { FormError } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/client";

const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Uploads an image straight to a public Storage bucket (storage policies
 * decide who may write), then hands its URL to a Server Action to save.
 */
export function ImageUploader({
  bucket,
  folder,
  imageUrl,
  alt,
  hint,
  maxBytes,
  onSave,
}: {
  bucket: "branding" | "menu-images";
  /** Path inside the bucket, e.g. "items/<id>". */
  folder: string;
  imageUrl: string | null;
  alt: string;
  hint: string;
  maxBytes: number;
  onSave: (url: string | null) => Promise<ActionResult>;
}) {
  const [supabase] = useState(createClient);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function upload(file: File) {
    setError(null);
    const ext = TYPES[file.type];
    if (!ext) return setError("Use a PNG, JPEG or WebP image.");
    if (file.size > maxBytes) {
      return setError(
        `The image must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller.`,
      );
    }
    startTransition(async () => {
      const path = `${folder}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        setError("Couldn't upload the image. Try again.");
        return;
      }
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      const result = await onSave(data.publicUrl);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-24 items-center justify-center overflow-hidden rounded-xl border bg-muted/40">
          {imageUrl ? (
            // A user-uploaded image from Supabase Storage; its host differs per environment.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={alt}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-xs text-muted-foreground">No image</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label className="inline-flex">
            <span className="sr-only">Upload an image</span>
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
          {imageUrl ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              className="self-start"
              onClick={() =>
                startTransition(async () => {
                  const result = await onSave(null);
                  if (!result.ok) setError(result.error);
                })
              }
            >
              Remove image
            </Button>
          ) : null}
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
      </div>
      <FormError message={error} />
    </div>
  );
}
