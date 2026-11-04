// Sprite render worker: ray-marches one player frame (sprites.js renderPlayerPixels), crops it and hands the pixels
// back as an ImageBitmap (transferred, zero-copy) so the main thread never runs the SDF renderer.
import { renderPlayerPixels, cropPixels } from './sprites.js';

self.onmessage = async (e) => {
  const { key, qa, pl, role, s, ctx, meta } = e.data;
  try {
    const t0 = performance.now();
    const c = cropPixels(renderPlayerPixels(qa, pl, role, s, ctx));
    const ms = performance.now() - t0;
    const img = new ImageData(new Uint8ClampedArray(c.px.buffer, c.px.byteOffset, c.w * c.h * 4), c.w, c.h);
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(img);
      self.postMessage({ key, bmp, w: c.w, h: c.h, ax: c.ax, ay: c.ay, ms, meta }, [bmp]);
    } else {
      self.postMessage({ key, px: c.px, w: c.w, h: c.h, ax: c.ax, ay: c.ay, ms, meta }, [c.px.buffer]);
    }
  } catch (err) {
    self.postMessage({ key, err: String(err && err.stack || err), meta });
  }
};
