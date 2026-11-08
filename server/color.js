import sharp from 'sharp';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

/**
 * Подбирает цвет свечения по изображению: берёт самый «цветной» оттенок (пиксели с насыщенностью и
 * средней яркостью весят больше, чёрный, белый и серый почти не учитываются), затем приводит насыщенность
 * и яркость к диапазону, который красиво светится на тёмном и светлом фоне.
 */
export async function glowFrom(input) {
  const { data, info } = await sharp(input).resize(48, 48, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let wSum = 0, cx = 0, sy = 0, sSum = 0, lSum = 0, lAll = 0;
  const n = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    lAll += l;
    const w = s * s * (1 - Math.abs(2 * l - 1)) ** 2;       // насыщенные средние тона важнее
    if (w < 0.002) continue;
    const rad = (h * Math.PI) / 180;
    cx += Math.cos(rad) * w; sy += Math.sin(rad) * w;
    wSum += w; sSum += s * w; lSum += l * w;
  }
  if (wSum < n * 0.02) {                                    // изображение почти без цвета
    const gl = clamp(lAll / n, 0.55, 0.7);
    return hslToHex(215, 0.12, gl);
  }
  const hue = ((Math.atan2(sy, cx) * 180) / Math.PI + 360) % 360;
  return hslToHex(hue, clamp(sSum / wSum, 0.6, 0.92), clamp(lSum / wSum, 0.5, 0.62));
}
