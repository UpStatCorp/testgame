// Procedurally painted 64x64 item icons (canvas -> dataURL), cached per item id.
const cache = new Map();

function withCanvas(draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  draw(ctx);
  return cv.toDataURL();
}

function blade(ctx, len, width, guardW, color1, color2) {
  ctx.save();
  ctx.translate(32, 32);
  ctx.rotate(-Math.PI / 4);
  // blade
  const g = ctx.createLinearGradient(-width, 0, width, 0);
  g.addColorStop(0, color1);
  g.addColorStop(0.5, '#ffffff');
  g.addColorStop(1, color2);
  ctx.fillStyle = g;
  ctx.strokeStyle = '#20252b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-width, 6);
  ctx.lineTo(-width, -len + 8);
  ctx.lineTo(0, -len);
  ctx.lineTo(width, -len + 8);
  ctx.lineTo(width, 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(80,90,100,0.6)';
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.lineTo(0, -len + 6);
  ctx.stroke();
  // guard
  ctx.fillStyle = '#b08a3a';
  ctx.strokeStyle = '#3a2a10';
  ctx.beginPath();
  ctx.roundRect(-guardW, 6, guardW * 2, 5, 2);
  ctx.fill();
  ctx.stroke();
  // grip
  ctx.fillStyle = '#5a3a22';
  ctx.beginPath();
  ctx.roundRect(-2.5, 11, 5, len * 0.32, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c8a040';
  ctx.beginPath();
  ctx.arc(0, 13 + len * 0.32, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

const painters = {
  sword: (ctx) => blade(ctx, 30, 3.5, 9, '#9aa4ae', '#6a747e'),
  greatsword: (ctx) => blade(ctx, 36, 5.5, 13, '#8c96a2', '#5a6470'),
  staff: (ctx) => {
    ctx.save();
    ctx.translate(32, 32);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#6b4a2a';
    ctx.strokeStyle = '#2a1a0a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-2.5, -18, 5, 44, 2);
    ctx.fill();
    ctx.stroke();
    const glow = ctx.createRadialGradient(0, -22, 1, 0, -22, 14);
    glow.addColorStop(0, 'rgba(160,230,255,1)');
    glow.addColorStop(1, 'rgba(60,120,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -22, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7fd8ff';
    ctx.strokeStyle = '#1a3a6a';
    ctx.beginPath();
    ctx.moveTo(0, -31);
    ctx.lineTo(6, -22);
    ctx.lineTo(0, -14);
    ctx.lineTo(-6, -22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#c8a040';
    ctx.beginPath();
    ctx.arc(0, -16, 5, 0.2, Math.PI - 0.2);
    ctx.stroke();
    ctx.restore();
  },
  stone: (ctx) => {
    const g = ctx.createLinearGradient(16, 16, 48, 50);
    g.addColorStop(0, '#b5b0a8');
    g.addColorStop(1, '#5e5a55');
    ctx.fillStyle = g;
    ctx.strokeStyle = '#2a2826';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(14, 36); ctx.lineTo(20, 20); ctx.lineTo(36, 14); ctx.lineTo(50, 24);
    ctx.lineTo(52, 40); ctx.lineTo(40, 50); ctx.lineTo(22, 48);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(22, 22); ctx.lineTo(34, 18); ctx.lineTo(28, 28); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(90,120,50,0.6)';
    ctx.beginPath();
    ctx.ellipse(40, 22, 7, 3, 0.3, 0, Math.PI * 2);
    ctx.fill();
  },
  wood: (ctx) => {
    ctx.lineWidth = 2;
    for (const [x, y] of [[20, 40], [42, 40], [31, 24]]) {
      ctx.fillStyle = '#6a4526';
      ctx.strokeStyle = '#2a1a0a';
      ctx.beginPath();
      ctx.ellipse(x, y, 11, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d8b07a';
      ctx.beginPath();
      ctx.ellipse(x, y, 8, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a07a48';
      ctx.lineWidth = 1;
      for (const r of [5, 2.5]) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.lineWidth = 2;
    }
  },
  potion: (ctx) => {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1a1010';
    const g = ctx.createRadialGradient(28, 40, 2, 32, 42, 18);
    g.addColorStop(0, '#ff8a8a');
    g.addColorStop(1, '#a01020');
    ctx.fillStyle = 'rgba(220,235,245,0.5)';
    ctx.beginPath();
    ctx.arc(32, 41, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(32, 41, 13, -0.2, Math.PI + 0.2, false);
    ctx.fill();
    ctx.fillStyle = 'rgba(220,235,245,0.7)';
    ctx.fillRect(27, 14, 10, 13);
    ctx.strokeRect(27, 14, 10, 13);
    ctx.fillStyle = '#8a5a2a';
    ctx.fillRect(26, 9, 12, 7);
    ctx.strokeRect(26, 9, 12, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.ellipse(25, 36, 3, 6, 0.4, 0, Math.PI * 2);
    ctx.fill();
  },
  food: (ctx) => {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2a1408';
    // bone
    ctx.fillStyle = '#efe6d2';
    ctx.beginPath();
    ctx.roundRect(38, 38, 16, 6, 3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(54, 38, 4, 0, Math.PI * 2);
    ctx.arc(54, 45, 4, 0, Math.PI * 2);
    ctx.fill();
    // meat
    const g = ctx.createRadialGradient(26, 28, 3, 28, 32, 20);
    g.addColorStop(0, '#d0703a');
    g.addColorStop(1, '#6a2a12');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(27, 31, 18, 14, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,160,0.5)';
    ctx.beginPath();
    ctx.arc(22, 26, 6, 3.6, 5.2);
    ctx.stroke();
  },
  coin: (ctx) => {
    ctx.lineWidth = 2;
    for (const [x, y, r] of [[24, 40, 12], [40, 36, 13], [32, 24, 14]]) {
      const g = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, r);
      g.addColorStop(0, '#fff2a0');
      g.addColorStop(1, '#b8861a');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#5a3a08';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120,80,10,0.7)';
      ctx.beginPath();
      ctx.arc(x, y, r - 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#7a5210';
    ctx.font = 'bold 14px serif';
    ctx.textAlign = 'center';
    ctx.fillText('ᚠ', 32, 29);
  },
  apple: (ctx) => {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3a0808';
    const g = ctx.createRadialGradient(26, 30, 3, 32, 36, 20);
    g.addColorStop(0, '#ff7060');
    g.addColorStop(1, '#8a1010');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(32, 37, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#4a2a10';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(32, 22); ctx.lineTo(34, 12);
    ctx.stroke();
    ctx.fillStyle = '#5aa02a';
    ctx.beginPath();
    ctx.ellipse(40, 15, 7, 3.5, -0.4, 0, Math.PI * 2);
    ctx.fill();
  },
};

export function getItemIcon(id) {
  if (!cache.has(id)) {
    const painter = painters[id] || painters.stone;
    cache.set(id, withCanvas(painter));
  }
  return cache.get(id);
}
