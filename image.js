// Photo preprocessing: orientation fix, resize for Claude's high-res vision tier, JPEG encode.

const MAX_EDGE = 2576; // Claude 4.7+ high-resolution tier long edge

async function decode(file) {
  // createImageBitmap honours EXIF orientation with imageOrientation:'from-image' (iOS 15+).
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function toCanvas(src, maxEdge) {
  const w0 = src.width, h0 = src.height;
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

const blobOf = (canvas, q) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));

function b64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

/** Returns { base64, mediaType, width, height, previewUrl, thumbDataUrl } */
export async function prepare(file) {
  const src = await decode(file);
  const big = toCanvas(src, MAX_EDGE);
  // Light compression keeps small price-tag digits legible; stay well below the 10 MB limit.
  let blob = await blobOf(big, 0.88);
  if (blob.size > 4.5e6) blob = await blobOf(big, 0.75);
  const thumb = toCanvas(big, 320);
  src.close?.();
  return {
    base64: await b64(blob),
    mediaType: 'image/jpeg',
    width: big.width,
    height: big.height,
    previewUrl: URL.createObjectURL(blob),
    thumbDataUrl: thumb.toDataURL('image/jpeg', 0.7),
  };
}
