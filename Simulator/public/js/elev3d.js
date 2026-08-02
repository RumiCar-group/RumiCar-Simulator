// 峠(高低差あり)コースの立体プレビュー。中心線と総高低差(course.elev)から、
// 「左(頂上)→右(麓)へ下っていく3Dリボン」を斜め投影で描く。崖の面と下りで高低差を表現する。
export function drawTougeElevation(canvas, course) {
  if (!canvas || !course || !course.centerline || course.centerline.length < 2) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  // 自前の空→地面の背景 (テーマに依らず文字・地形が見やすいように)
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#26324c'); sky.addColorStop(0.62, '#3a4a5e'); sky.addColorStop(1, '#2c3a2e');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  const cl = course.centerline;
  const last = cl.length - 1;

  // 進行に沿った累積距離 (リボンの横軸)
  const cum = [0];
  for (let i = 1; i <= last; i++) cum[i] = cum[i - 1] + Math.hypot(cl[i][0] - cl[i - 1][0], cl[i][1] - cl[i - 1][1]);
  const total = cum[last] || 1;

  // スタート→ゴール直線に対する左右ずれ(カーブのうねりを表現)
  const s0 = cl[0], s1 = cl[last];
  let gx = s1[0] - s0[0], gy = s1[1] - s0[1]; const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
  const px = -gy, py = gx; // 垂直方向
  let maxDev = 0.001;
  const dev = cl.map(p => { const d = (p[0] - s0[0]) * px + (p[1] - s0[1]) * py; if (Math.abs(d) > maxDev) maxDev = Math.abs(d); return d; });

  const mx = 30, baseY = H - 20, topPad = 26;
  const elev = course.elev || 0;
  const elevPx = Math.min(H - topPad - 18, Math.max(20, elev * 0.92)); // 高低差[m]→px (大きい峠ほど急に見える)
  const wigScale = Math.min(34, (H * 0.18) / maxDev);

  const pt = (i) => {
    const t = cum[i] / total;
    const x = mx + t * (W - 2 * mx) + dev[i] * wigScale * 0.5;
    const y = baseY - elevPx * (1 - t);   // 頂上(t=0)が高く、麓(t=1)が低い
    return [x, y];
  };

  // 崖の面 (リボン下端→地面までを塗る = 立体感)
  ctx.beginPath();
  ctx.moveTo(pt(0)[0], baseY);
  for (let i = 0; i <= last; i++) { const [x, y] = pt(i); ctx.lineTo(x, y); }
  ctx.lineTo(pt(last)[0], baseY);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, baseY - elevPx, 0, baseY);
  grad.addColorStop(0, 'rgba(150,178,108,0.95)');
  grad.addColorStop(1, 'rgba(74,96,58,0.98)');
  ctx.fillStyle = grad; ctx.fill();

  // 路面リボン (上端の線)
  ctx.beginPath();
  for (let i = 0; i <= last; i++) { const [x, y] = pt(i); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.strokeStyle = '#e0a878'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();

  // 地面ライン
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(mx - 6, baseY); ctx.lineTo(W - mx + 6, baseY); ctx.stroke();

  // 旗・ラベル
  const [sx, sy] = pt(0), [ex, ey] = pt(last);
  const flag = (x, y, color, label) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, x, y - 9);
  };
  flag(sx, sy, '#7fe08a', `頂上 +${elev}m`);
  flag(ex, ey, '#ff7a6a', '麓 0m');

  // タイトル
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`立体プレビュー — 高低差 ${elev}m を下る ▼`, 10, 16);
}
