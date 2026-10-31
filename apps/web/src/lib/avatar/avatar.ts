/** Profile photos are cropped to a centered square and resized in the browser before upload. */
export const AVATAR_SIZE = 256;

// Photos straight from a phone camera are often 5–15 MB; anything larger is unlikely to be one.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** A problem with the chosen file. The message is written for users. */
export class AvatarImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarImageError";
  }
}

type Square = { x: number; y: number; side: number };

/** The largest centered square inside a `width` × `height` image. */
export function centerSquare(width: number, height: number): Square {
  const side = Math.min(width, height);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side };
}

/** Crop and resize an image file into a small WebP (or JPEG where WebP can't be encoded). */
export async function prepareAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new AvatarImageError("Choose an image file, such as a PNG or JPEG.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new AvatarImageError("Choose an image smaller than 25 MB.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AvatarImageError("This image couldn’t be read. Try a PNG or JPEG.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new AvatarImageError("Your browser couldn’t process this image.");
  }
  const { x, y, side } = centerSquare(bitmap.width, bitmap.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, x, y, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();

  // Browsers that can't encode WebP silently fall back to PNG, so check what came back.
  const webp = await encode(canvas, "image/webp");
  if (webp?.type === "image/webp") return webp;
  const jpeg = await encode(canvas, "image/jpeg");
  if (jpeg) return jpeg;
  throw new AvatarImageError("Your browser couldn’t process this image.");
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
}

/**
 * The photo as a `data:` URL. Unlike an object URL, it never needs revoking, so it can't be
 * released while something still shows it.
 */
export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The photo couldn’t be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("The photo couldn’t be read."));
    reader.readAsDataURL(blob);
  });
}
