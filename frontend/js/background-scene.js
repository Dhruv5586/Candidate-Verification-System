/**
 * CVS — Industrial Editorial Background Canvas Engine
 * Generates subtle noise grain & 3D wireframe rotating shield
 */
(function initBackgroundCanvas() {
  // 1. Noise Grain
  const grainCanvas = document.getElementById('bg-grain');
  if (grainCanvas) {
    const gCtx = grainCanvas.getContext('2d');
    function resizeGrain() {
      grainCanvas.width = window.innerWidth;
      grainCanvas.height = window.innerHeight;
      if (!gCtx) return;
      const w = grainCanvas.width;
      const h = grainCanvas.height;
      const imgData = gCtx.createImageData(w, h);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const val = (Math.random() * 255) | 0;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
        data[i + 3] = 16; // subtle ~6% opacity
      }
      gCtx.putImageData(imgData, 0, 0);
    }
    window.addEventListener('resize', resizeGrain);
    resizeGrain();
  }

  // 2. 3D Wireframe Scene
  const sceneCanvas = document.getElementById('bg-scene');
  if (!sceneCanvas) return;
  const ctx = sceneCanvas.getContext('2d');
  if (!ctx) return;

  let w = 0, h = 0;
  function resizeScene() {
    w = sceneCanvas.width = window.innerWidth;
    h = sceneCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeScene);
  resizeScene();

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Verification Shield 3D Geometry
  const verts = [
    [0, -1.2, 0],         // 0: top apex
    [0.85, -0.65, 0.25],  // 1: top right front
    [0.75, 0.25, 0.2],    // 2: mid right front
    [0, 1.25, 0.35],      // 3: bottom tip front
    [-0.75, 0.25, 0.2],   // 4: mid left front
    [-0.85, -0.65, 0.25], // 5: top left front
    [0, -0.1, 0.55],      // 6: center crest
    [0, -1.2, -0.2],      // 7: top apex back
    [0.75, -0.6, -0.2],   // 8: top right back
    [0.65, 0.2, -0.2],    // 9: mid right back
    [0, 1.15, -0.15],     // 10: bottom tip back
    [-0.65, 0.2, -0.2],   // 11: mid left back
    [-0.75, -0.6, -0.2]   // 12: top left back
  ];

  const faces = [
    [0, 1, 6], [1, 2, 6], [2, 3, 6], [3, 4, 6], [4, 5, 6], [5, 0, 6],
    [7, 8, 10], [8, 9, 10], [10, 11, 7], [11, 12, 7],
    [0, 7, 8], [0, 8, 1], [1, 8, 9], [1, 9, 2], [2, 9, 10], [2, 10, 3],
    [3, 10, 11], [3, 11, 4], [4, 11, 12], [4, 12, 5], [5, 12, 7], [5, 7, 0]
  ];

  // Orbit ring
  const ringPts = [];
  const ringSteps = 48;
  for (let i = 0; i < ringSteps; i++) {
    const th = (i / ringSteps) * Math.PI * 2;
    ringPts.push([Math.cos(th) * 1.55, Math.sin(th) * 0.38, Math.sin(th) * 1.55]);
  }

  let mx = 0, my = 0;
  window.addEventListener('mousemove', (e) => {
    mx = (e.clientX / (w || 1) - 0.5) * 0.4;
    my = (e.clientY / (h || 1) - 0.5) * 0.4;
  });

  function rot(p, rx, ry, rz) {
    const x = p[0], y = p[1], z = p[2];
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
    const cz = Math.cos(rz), sz = Math.sin(rz);
    return [x1 * cz - y2 * sz, x1 * sz + y2 * cz, z2];
  }

  function norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  const keyDir = norm([0.55, -0.65, 0.72]);
  const rimDir = norm([-0.75, 0.35, 0.45]);
  const start = performance.now();

  function draw(now) {
    const t = (now - start) * 0.0008;
    ctx.clearRect(0, 0, w, h);

    const tx = w > 1024 ? w * 0.76 : w * 0.5;
    const ty = h * 0.45;
    const scale = Math.min(w, h) * (w > 768 ? 0.22 : 0.16);

    const rx = 0.25 + Math.sin(t * 0.3) * 0.08 + my;
    const ry = t * 0.25 + mx;

    // Ambient glow
    const glow = ctx.createRadialGradient(tx, ty, scale * 0.2, tx, ty, scale * 2.2);
    glow.addColorStop(0, 'rgba(255, 77, 28, 0.22)');
    glow.addColorStop(0.5, 'rgba(60, 8, 0, 0.16)');
    glow.addColorStop(1, 'rgba(14, 14, 12, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(tx, ty, scale * 2.2, 0, Math.PI * 2);
    ctx.fill();

    const rotated = verts.map((v) => rot(v, rx, ry, 0.12));
    const proj = rotated.map((r) => {
      const persp = 4 / (4 - r[2]);
      return [tx + r[0] * scale * persp, ty + r[1] * scale * persp, r[2]];
    });

    const sorted = faces.map((f) => {
      const a = rotated[f[0]], b = rotated[f[1]], c = rotated[f[2]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = norm([
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ]);
      const zAvg = (a[2] + b[2] + c[2]) / 3;
      return { f, n, z: zAvg };
    }).sort((p, q) => p.z - q.z);

    for (let fi = 0; fi < sorted.length; fi++) {
      const item = sorted[fi];
      if (item.n[2] < -0.2) continue;
      const p0 = proj[item.f[0]], p1 = proj[item.f[1]], p2 = proj[item.f[2]];
      const keyDot = Math.max(0, item.n[0] * keyDir[0] + item.n[1] * keyDir[1] + item.n[2] * keyDir[2]);
      const rimDot = Math.max(0, item.n[0] * rimDir[0] + item.n[1] * rimDir[1] + item.n[2] * rimDir[2]);

      const rCol = Math.min(255, (38 + keyDot * 155 + rimDot * 120) | 0);
      const gCol = Math.min(255, (36 + keyDot * 146 + rimDot * 32) | 0);
      const bCol = Math.min(255, (32 + keyDot * 130 + rimDot * 12) | 0);

      ctx.fillStyle = `rgba(${rCol}, ${gCol}, ${bCol}, 0.32)`;
      ctx.strokeStyle = 'rgba(232, 227, 214, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Orbit Ring
    ctx.strokeStyle = 'rgba(255, 77, 28, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = 0; k <= ringSteps; k++) {
      const rp = ringPts[k % ringSteps];
      const rr = rot(rp, rx + 0.3, ry * 0.8 + t * 0.1, -0.25);
      const rPersp = 4 / (4 - rr[2]);
      const px = tx + rr[0] * scale * rPersp;
      const py = ty + rr[1] * scale * rPersp;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    if (!reducedMotion) {
      requestAnimationFrame(draw);
    }
  }

  requestAnimationFrame(draw);
})();
