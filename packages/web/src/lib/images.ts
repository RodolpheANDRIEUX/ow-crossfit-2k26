/** Adresse d'une image (immuable, donc mise en cache par le telephone). */
export function imageUrl(id: string): string {
  return `/api/images/${id}`;
}

/**
 * Prepare une image avant envoi : redimensionnee dans le navigateur (512 px
 * maximum) et compressee en WebP, transparence conservee. Une photo de
 * telephone de plusieurs Mo devient quelques dizaines de Ko.
 */
export async function prepareImage(file: File, max = 512): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas indisponible');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const webp = canvas.toDataURL('image/webp', 0.85);
  // Safari ancien : pas d'encodage WebP, on retombe sur du PNG.
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}
