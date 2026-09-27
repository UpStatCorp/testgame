import * as THREE from 'three';
import { mulberry32 } from '../core/MathUtils.js';

// Procedural canvas textures (planks, shingles, stone, thatch) so the game needs no external assets.
const cache = new Map();

function makeCanvas(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function grain(ctx, x, y, w, h, rand, color, lines = 6) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i < lines; i++) {
    ctx.beginPath();
    const px = x + rand() * w;
    ctx.moveTo(px, y);
    for (let yy = y; yy <= y + h; yy += 8) ctx.lineTo(px + Math.sin(yy * 0.05 + i) * 2, yy);
    ctx.globalAlpha = 0.25 + rand() * 0.2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export const Textures = {
  planks(tint = [120, 84, 52]) {
    const key = 'planks' + tint.join(',');
    if (cache.has(key)) return cache.get(key);
    const tex = makeCanvas(256, (ctx, s) => {
      const rand = mulberry32(7);
      const n = 6;
      const w = s / n;
      for (let i = 0; i < n; i++) {
        const v = 0.8 + rand() * 0.35;
        ctx.fillStyle = `rgb(${tint[0] * v},${tint[1] * v},${tint[2] * v})`;
        ctx.fillRect(i * w, 0, w, s);
        grain(ctx, i * w + 2, 0, w - 4, s, rand, `rgba(40,25,12,1)`, 5);
        // knots
        if (rand() > 0.5) {
          ctx.fillStyle = 'rgba(50,30,15,0.5)';
          ctx.beginPath();
          ctx.ellipse(i * w + w / 2, rand() * s, 3, 5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(25,15,8,0.85)';
        ctx.fillRect(i * w, 0, 2, s);
        // horizontal joint
        const jy = rand() * s;
        ctx.fillRect(i * w, jy, w, 2);
      }
    });
    cache.set(key, tex);
    return tex;
  },

  shingles() {
    if (cache.has('shingles')) return cache.get('shingles');
    const tex = makeCanvas(256, (ctx, s) => {
      const rand = mulberry32(11);
      ctx.fillStyle = '#3d2a1e';
      ctx.fillRect(0, 0, s, s);
      const rows = 8, rh = s / rows;
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) * 16;
        for (let x = -32; x < s + 32; x += 32) {
          const v = 0.75 + rand() * 0.4;
          ctx.fillStyle = `rgb(${110 * v},${62 * v},${42 * v})`;
          ctx.fillRect(x + off + 1, r * rh + 1, 30, rh - 2);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(x + off + 1, r * rh + rh - 6, 30, 5);
        }
      }
    });
    cache.set('shingles', tex);
    return tex;
  },

  thatch() {
    if (cache.has('thatch')) return cache.get('thatch');
    const tex = makeCanvas(256, (ctx, s) => {
      const rand = mulberry32(13);
      ctx.fillStyle = '#8a7340';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 1800; i++) {
        const x = rand() * s, y = rand() * s;
        const v = 0.6 + rand() * 0.6;
        ctx.strokeStyle = `rgba(${180 * v},${150 * v},${80 * v},0.8)`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 4, y + 14 + rand() * 10);
        ctx.stroke();
      }
      for (let r = 0; r < 6; r++) {
        ctx.fillStyle = 'rgba(40,30,10,0.35)';
        ctx.fillRect(0, r * (s / 6) + s / 6 - 4, s, 4);
      }
    });
    cache.set('thatch', tex);
    return tex;
  },

  stone() {
    if (cache.has('stone')) return cache.get('stone');
    const tex = makeCanvas(256, (ctx, s) => {
      const rand = mulberry32(17);
      ctx.fillStyle = '#4a4744';
      ctx.fillRect(0, 0, s, s);
      const rows = 6, rh = s / rows;
      for (let r = 0; r < rows; r++) {
        let x = -(rand() * 30);
        while (x < s) {
          const w = 30 + rand() * 40;
          const v = 0.7 + rand() * 0.45;
          ctx.fillStyle = `rgb(${128 * v},${124 * v},${116 * v})`;
          ctx.beginPath();
          ctx.roundRect(x + 2, r * rh + 2, w - 4, rh - 4, 8);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.07)';
          ctx.fillRect(x + 5, r * rh + 4, w - 12, 4);
          x += w;
        }
      }
    });
    cache.set('stone', tex);
    return tex;
  },
};

/** BoxGeometry whose UVs are scaled by face size so textures keep a constant world density. */
export function texturedBox(w, h, d, metersPerTile = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / metersPerTile, (uv.getY(i) * dims[f][1]) / metersPerTile);
    }
  }
  return g;
}
