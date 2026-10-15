import { supabase } from "./supabase.ts";

/* Recipe photos live in a PRIVATE Supabase Storage bucket, one folder per user.

   Re-encoding every upload through a canvas does three jobs at once:
     - it shrinks a 6 MB phone photo to a few hundred KB, which matters on a free-tier
       storage quota and on a phone connection
     - it strips EXIF metadata. A phone photo carries GPS coordinates; a photo of a catch
       or a kitchen should not publish where it was taken
     - it guarantees what reaches the bucket is a JPEG, so a file that merely claims to
       be an image is decoded and re-drawn rather than stored as sent
   The bucket also enforces 5 MB and image/jpeg itself (supabase/schema.sql), so the limits
   hold for a client that skips this step. */

const BUCKET = "recipe-photos";
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_SECONDS = 60 * 60;

/** What the form is asking for with respect to a recipe's photo. */
export type PhotoChange = { kind: "keep" } | { kind: "remove" } | { kind: "replace"; blob: Blob };

/** "<user uuid>/<uuid>.jpg". Anything else is not ours and is never sent to Storage. */
export const PHOTO_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i;

export async function prepareImage(file: File): Promise<Blob> {
  // The declared type is only a hint (the user, or a page, chose the file), so it is a
  // quick early refusal and not the real check. Decoding below is the real check.
  if (!file.type.startsWith("image/")) throw new Error("That file is not an image.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("That image is over 25 MB. Pick a smaller one.");

  let bitmap: ImageBitmap;
  try {
    // Apply the EXIF orientation while decoding, so the photo is not stored sideways once
    // the EXIF that said "rotate me" has been stripped.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error("Could not read that image. Try a JPEG or PNG.");
    }
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("This browser cannot process images.");
  }
  // JPEG has no alpha: without this a transparent PNG would go black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("Could not process that image.");
  if (blob.size > MAX_OUTPUT_BYTES) throw new Error("That image is still over 5 MB after shrinking. Pick a smaller one.");
  return blob;
}

/** Upload under the caller's own folder and return the object path to store on the recipe. */
export async function uploadPhoto(userId: string, blob: Blob): Promise<string> {
  if (!supabase) throw new Error("Not connected.");
  // A random name, never the original filename: filenames can carry personal information
  // and collide. Unique per upload also means a replaced photo never needs an overwrite.
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Best effort. A photo left behind costs a few hundred KB; a failed delete must not block a save. */
export async function removePhoto(path: string | null): Promise<void> {
  if (!supabase || !path || !PHOTO_PATH.test(path)) return;
  await supabase.storage.from(BUCKET).remove([path]);
}

/** Short-lived URLs for private objects, in one request. Paths that fail to sign are omitted. */
export async function signPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (!supabase || paths.length === 0) return {};
  const valid = [...new Set(paths)].filter((p) => PHOTO_PATH.test(p));
  if (valid.length === 0) return {};

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(valid, SIGNED_URL_SECONDS);
  if (error || !data) return {};

  const out: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl && !item.error) out[item.path] = item.signedUrl;
  }
  return out;
}
