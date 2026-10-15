"use client";

import { useId } from "react";

/**
 * Element ids for form fields that are unique per form instance. Next.js
 * keeps recently visited pages in the DOM (hidden, to preserve their state),
 * so fixed ids like "name" would clash between pages and labels would point
 * at the wrong input. Use fid("name") wherever a field needs an id.
 */
export function useFieldIds(): (name: string) => string {
  const base = useId();
  return (name: string) => `${base}-${name}`;
}
