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
  const bitmap = await readImage(file);
  const { x, y, side } = centerSquare(bitmap.width, bitmap.height);
  return drawAndEncode(bitmap, { x, y, width: side, height: side }, AVATAR_SIZE, AVATAR_SIZE);
}

/** Cover photos keep their shape and are scaled down to at most this many pixels wide. */
export const COVER_MAX_WIDTH = 1600;
/** Taller photos are cropped (around the middle) to this width-to-height ratio at most. */
const COVER_MIN_RATIO = 4 / 3;

/** The cover's crop from a `width` × `height` image and its output size. */
export function coverFit(width: number, height: number) {
  const cropHeight = Math.min(height, Math.round(width / COVER_MIN_RATIO));
  const scale = Math.min(1, COVER_MAX_WIDTH / width);
  return {
    crop: { x: 0, y: Math.floor((height - cropHeight) / 2), width, height: cropHeight },
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(cropHeight * scale)),
  };
}

/** Resize a cover photo into a WebP (or JPEG) small enough to store. */
export async function prepareCover(file: File): Promise<Blob> {
  const bitmap = await readImage(file);
  const { crop, width, height } = coverFit(bitmap.width, bitmap.height);
  return drawAndEncode(bitmap, crop, width, height);
}

async function readImage(file: File): Promise<ImageBitmap> {
  if (!file.type.startsWith("image/")) {
    throw new AvatarImageError("Choose an image file, such as a PNG or JPEG.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new AvatarImageError("Choose an image smaller than 25 MB.");
  }

  try {
    return await createImageBitmap(file);
  } catch {
    throw new AvatarImageError("This image couldn’t be read. Try a PNG or JPEG.");
  }
}

async function drawAndEncode(
  bitmap: ImageBitmap,
  crop: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new AvatarImageError("Your browser couldn’t process this image.");
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
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
