/* 极速赛道 · 3D 赛车
 * 单圈判定：把赛道中心线等距采样成 N 个点，每帧找到车辆最近的采样点，
 * 累计前进的索引差，累计满一整圈（N 个点）即记 1 圈。
 * 倒车、抄近道都会被索引差抵消或忽略，不能刷圈。
 */
(() => {
  'use strict';

  // ---------- DOM ----------
  const canvas = document.getElementById('game');
  const lapsEl = document.getElementById('laps');
  const speedEl = document.getElementById('speed');
  const lapTimeEl = document.getElementById('lap-time');
  const bestLapsEl = document.getElementById('best-laps');
  const lbListEl = document.getElementById('lb-list');
  const myRankEl = document.getElementById('my-rank');
  const myLapsLabelEl = document.getElementById('my-laps-label');
  const tipEl = document.getElementById('tip');
  const toastEl = document.getElementById('toast');
  const restartBtn = document.getElementById('restart-btn');
  const submitBtn = document.getElementById('submit-btn');

  // ---------- 渲染基础 ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xbfe0f7, 230, 460);

  const camera = new THREE.PerspectiveCamera(
    62,
    window.innerWidth / window.innerHeight,
    0.1,
    900
  );
  camera.position.set(0, 12, -30);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a7c3f, 0.95));

  const sun = new THREE.DirectionalLight(0xfff2d6, 1.35);
  sun.position.set(90, 150, 70);
  scene.add(sun);

  // ---------- 天空 / 地面 ----------
  function makeSky() {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#2f7fd0');
    g.addColorStop(0.55, '#8fcdf5');
    g.addColorStop(1, '#e2f2ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(600, 24, 16),
      new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      })
    );
    scene.add(sky);
  }

  function makeGrass() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#4f8a43';
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 1200; i++) {
      const v = 40 + Math.random() * 40;
      ctx.fillStyle = `rgba(${v * 0.7 | 0}, ${110 + v * 0.35 | 0}, ${v * 0.7 | 0}, 0.5)`;
      ctx.fillRect(Math.random() * 64, Math.random() * 64, 1.5, 1.5);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(120, 120);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1800, 1800),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
  }

  makeSky();
  makeGrass();

  // ---------- 赛道中心线 ----------
  const TRACK_A = 80;
  const TRACK_B = 52;
  const HALF_W = 9;
  const SEGMENTS = 800;

  function rawPoint(t) {
    const ang = t * Math.PI * 2;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    // 超椭圆，整体形似圆角矩形赛道
    return new THREE.Vector2(
      TRACK_A * Math.sign(c) * Math.pow(Math.abs(c), 0.5),
      TRACK_B * Math.sign(s) * Math.pow(Math.abs(s), 0.5)
    );
  }

  function buildCenterline() {
    const denseCount = 4000;
    const dense = [];
    const acc = [0];
    let total = 0;
    for (let i = 0; i <= denseCount; i++) {
      const p = rawPoint(i / denseCount);
      dense.push(p);
      if (i > 0) {
        total += p.distanceTo(dense[i - 1]);
        acc.push(total);
      }
    }
    const points = [];
    let j = 0;
    for (let i = 0; i < SEGMENTS; i++) {
      const target = (i / SEGMENTS) * total;
      while (j < denseCount && acc[j + 1] < target) j++;
      const segLen = acc[j + 1] - acc[j] || 1;
      const r = (target - acc[j]) / segLen;
      const a = dense[j];
      const b = dense[j + 1];
      points.push(
        new THREE.Vector3(a.x + (b.x - a.x) * r, 0, a.y + (b.y - a.y) * r)
      );
    }
    return { points, length: total };
  }

  const track = buildCenterline();
  const pts = track.points;
  const N = pts.length;

  function tangentAt(i) {
    const a = pts[(i - 1 + N) % N];
    const b = pts[(i + 1) % N];
    return new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  }

  function normalAt(i) {
    const t = tangentAt(i);
    return new THREE.Vector3(-t.z, 0, t.x);
  }

  function makeTrackTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3a3d44';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2000; i++) {
      const g = 42 + Math.random() * 42;
      ctx.fillStyle = `rgba(${g},${g},${g + 5},${0.2 + Math.random() * 0.3})`;
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 1.6, 1.6);
    }
    // 两侧红白路肩
    for (let y = 0; y < 128; y += 16) {
      ctx.fillStyle = (y / 16) % 2 === 0 ? '#eef2f7' : '#d92f27';
      ctx.fillRect(0, y, 9, 16);
      ctx.fillRect(119, y, 9, 16);
    }
    // 中间虚线
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(62, 0, 4, 62);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  function buildTrackMesh() {
    const positions = [];
    const uvs = [];
    const indices = [];
    const vTiles = Math.max(1, Math.round(track.length / 10));

    for (let i = 0; i <= N; i++) {
      const p = pts[i % N];
      const nrm = normalAt(i % N);
      positions.push(
        p.x - nrm.x * HALF_W, 0.02, p.z - nrm.z * HALF_W,
        p.x + nrm.x * HALF_W, 0.02, p.z + nrm.z * HALF_W
      );
      const v = (i / N) * vTiles;
      uvs.push(0, v, 1, v);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      map: makeTrackTexture(),
      roughness: 0.92,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
  }

  function makeCheckerTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 32;
    const ctx = c.getContext('2d');
    const cell = 16;
    for (let x = 0; x < 128; x += cell) {
      for (let y = 0; y < 32; y += cell) {
        ctx.fillStyle = (x / cell + y / cell) % 2 === 0 ? '#f4f6f8' : '#15181d';
        ctx.fillRect(x, y, cell, cell);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function buildStartArea() {
    const p = pts[0];
    const t = tangentAt(0);
    const angle = Math.atan2(t.x, t.z);

    const group = new THREE.Group();
    group.position.set(p.x, 0, p.z);
    group.rotation.y = angle;

    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_W * 2, 4.5),
      new THREE.MeshBasicMaterial({ map: makeCheckerTexture() })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.04;
    group.add(line);

    const postGeo = new THREE.CylinderGeometry(0.55, 0.55, 8, 10);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1d222b, roughness: 0.6 });
    const postL = new THREE.Mesh(postGeo, postMat);
    postL.position.set(-(HALF_W + 1.6), 4, 0);
    const postR = postL.clone();
    postR.position.x = HALF_W + 1.6;
    group.add(postL, postR);

    const beam = new THREE.Mesh(
      new THREE.BoxGeometry((HALF_W + 2.2) * 2, 1.6, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xd92f27, roughness: 0.5 })
    );
    beam.position.y = 8;
    group.add(beam);

    for (const bz of [-0.27, 0.27]) {
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry((HALF_W + 2.2) * 2, 1.6),
        new THREE.MeshBasicMaterial({ map: makeCheckerTexture(), side: THREE.DoubleSide })
      );
      banner.position.set(0, 8, bz);
      group.add(banner);
    }

    scene.add(group);
  }

  buildTrackMesh();
  buildStartArea();

  // ---------- 场景装饰：树木 ----------
  function buildTrees() {
    const count = 90;
    const trunkGeo = new THREE.CylinderGeometry(0.45, 0.7, 4.4, 6);
    const leafGeo = new THREE.ConeGeometry(3.1, 7.6, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 0.95 });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const pos = new THREE.Vector3();

    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 12) {
      guard++;
      const i = Math.floor(Math.random() * N);
      const side = Math.random() < 0.5 ? -1 : 1;
      const dist = HALF_W + 9 + Math.random() * 46;
      const p = pts[i];
      const nrm = normalAt(i);
      pos.set(p.x + nrm.x * dist * side, 0, p.z + nrm.z * dist * side);
      if (pos.length() > 420) continue;
      const scale = 0.75 + Math.random() * 0.9;

      s.set(scale, scale, scale);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);

      m.compose(new THREE.Vector3(pos.x, 2.2 * scale, pos.z), q, s);
      trunks.setMatrixAt(placed, m);
      m.compose(new THREE.Vector3(pos.x, (4.4 + 3.8) * scale, pos.z), q, s);
      leaves.setMatrixAt(placed, m);
      placed++;
    }
    trunks.count = placed;
    leaves.count = placed;
    scene.add(trunks, leaves);
  }

  buildTrees();

  // ---------- 赛车 ----------
  function makeShadowTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.5)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.24)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  function makeCar() {
    const car = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xe10600, metalness: 0.5, roughness: 0.28,
    });
    const bodyDarkMat = new THREE.MeshStandardMaterial({
      color: 0x9c0500, metalness: 0.45, roughness: 0.38,
    });
    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x15181e, metalness: 0.6, roughness: 0.42,
    });
    const whiteMat = new THREE.MeshStandardMaterial({
      color: 0xf2f4f8, metalness: 0.3, roughness: 0.3,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0xc3cad4, metalness: 0.95, roughness: 0.22,
    });
    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0xffd60a, metalness: 0.45, roughness: 0.28,
    });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x0c1218, metalness: 0.9, roughness: 0.08,
    });
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x101216, roughness: 0.95,
    });
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xff3b30, emissive: 0xff1a10, emissiveIntensity: 1.6,
    });
    const exhaustMat = new THREE.MeshStandardMaterial({
      color: 0x4a505a, metalness: 0.95, roughness: 0.3,
    });
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xff9a4d, emissive: 0xff5a10, emissiveIntensity: 2.2,
    });

    const add = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      car.add(mesh);
      return mesh;
    };
    const box = (w, h, d, mat, x, y, z) =>
      add(new THREE.BoxGeometry(w, h, d), mat, x, y, z);

    // 在两点之间生成一根圆柱（悬挂拉杆、传动轴）
    const rod = (a, b, r, mat) => {
      const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const len = dir.length();
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
      mesh.position.set(
        (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2
      );
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      car.add(mesh);
      return mesh;
    };

    // ---- 底板 / 尾部扩散器 ----
    box(1.52, 0.07, 4.5, carbonMat, 0, 0.12, -0.3);
    const diffuser = box(1.3, 0.09, 0.9, carbonMat, 0, 0.2, -2.7);
    diffuser.rotation.x = 0.34;
    for (const sx of [-0.44, 0, 0.44]) {
      const strake = box(0.04, 0.2, 0.86, carbonMat, sx, 0.29, -2.7);
      strake.rotation.x = 0.34;
    }

    // ---- 单体壳 / 鼻锥 ----
    box(0.97, 0.5, 2.6, bodyMat, 0, 0.6, 0.5);
    box(0.9, 0.18, 0.6, bodyDarkMat, 0, 0.4, 1.75);
    const nose = add(
      new THREE.CylinderGeometry(0.14, 0.48, 2.25, 18), bodyMat, 0, 0.62, 2.4
    );
    nose.rotation.x = Math.PI / 2;

    // ---- 前翼 ----
    box(3.55, 0.07, 0.62, bodyMat, 0, 0.28, 3.5);
    const fwFlap1 = box(3.35, 0.06, 0.4, carbonMat, 0, 0.4, 3.4);
    fwFlap1.rotation.x = -0.22;
    const fwFlap2 = box(3.15, 0.055, 0.3, carbonMat, 0, 0.5, 3.29);
    fwFlap2.rotation.x = -0.38;
    for (const sx of [-1.77, 1.77]) {
      box(0.06, 0.5, 1.02, bodyMat, sx, 0.45, 3.42);
      box(0.065, 0.07, 1.02, whiteMat, sx, 0.68, 3.42);
      const flick = box(0.05, 0.1, 0.34, whiteMat, sx, 0.76, 3.72);
      flick.rotation.x = -0.4;
    }
    box(0.09, 0.36, 0.2, carbonMat, -0.3, 0.5, 3.34);
    box(0.09, 0.36, 0.2, carbonMat, 0.3, 0.5, 3.34);

    // ---- 侧箱 / 导流板 ----
    for (const side of [-1, 1]) {
      const sx = 0.85 * side;
      box(0.6, 0.44, 2.3, bodyMat, sx, 0.55, -0.5);
      const podTop = box(0.48, 0.16, 1.6, bodyMat, sx, 0.78, -0.95);
      podTop.rotation.z = -0.14 * side;
      box(0.45, 0.3, 0.1, carbonMat, sx, 0.63, 0.63);
      const barge = box(0.04, 0.34, 0.75, carbonMat, sx * 1.06, 0.45, 0.75);
      barge.rotation.y = 0.16 * side;
      barge.rotation.z = -0.1 * side;
    }

    // ---- 引擎盖 / 进气口 / 鲨鱼鳍 ----
    box(0.72, 0.5, 2.05, bodyMat, 0, 0.86, -1.65);
    const coverSlope = box(0.54, 0.26, 1.4, bodyMat, 0, 1.12, -2.05);
    coverSlope.rotation.x = 0.16;
    box(0.14, 0.06, 1.7, whiteMat, 0, 1.13, -1.35);
    box(0.4, 0.4, 0.62, bodyMat, 0, 1.26, -1.06);
    box(0.3, 0.22, 0.06, carbonMat, 0, 1.3, -0.78);
    box(0.15, 0.07, 0.12, carbonMat, 0, 1.5, -1.02);
    box(0.04, 0.38, 1.45, bodyMat, 0, 1.34, -2.35);

    // ---- 座舱 / 车手 ----
    box(0.64, 0.08, 1.3, carbonMat, 0, 0.87, 0.12);
    const rim = add(
      new THREE.TorusGeometry(0.34, 0.045, 8, 22), carbonMat, 0, 0.94, 0.16
    );
    rim.rotation.x = -Math.PI / 2;
    box(0.56, 0.2, 0.34, carbonMat, 0, 0.93, -0.42);
    const helmet = add(
      new THREE.SphereGeometry(0.27, 18, 14), helmetMat, 0, 1.05, 0.02
    );
    helmet.scale.set(1, 0.96, 1.08);
    box(0.32, 0.1, 0.12, visorMat, 0, 1.07, 0.26);
    box(0.06, 0.03, 0.46, whiteMat, 0, 1.29, 0.02);

    // ---- Halo ----
    const halo = add(
      new THREE.TorusGeometry(0.44, 0.045, 8, 26), carbonMat, 0, 1.34, 0.12
    );
    halo.rotation.x = -Math.PI / 2;
    box(0.07, 0.05, 0.48, carbonMat, 0, 1.33, 0.56);
    box(0.05, 0.16, 0.08, carbonMat, -0.36, 1.25, -0.2);
    box(0.05, 0.16, 0.08, carbonMat, 0.36, 1.25, -0.2);

    // ---- 后视镜 ----
    for (const side of [-1, 1]) {
      box(0.03, 0.03, 0.28, carbonMat, 0.58 * side, 1.02, 0.5);
      box(0.18, 0.09, 0.07, bodyMat, 0.68 * side, 1.05, 0.58);
    }

    // ---- 尾翼 / 排气 / 雨灯 ----
    box(2.45, 0.07, 0.72, bodyMat, 0, 1.8, -3.05);
    const rwFlap = box(2.2, 0.06, 0.44, carbonMat, 0, 2.05, -3.27);
    rwFlap.rotation.x = 0.32;
    for (const sx of [-1.24, 1.24]) {
      box(0.06, 0.82, 0.98, bodyMat, sx, 1.79, -3.12);
      box(0.065, 0.07, 0.98, whiteMat, sx, 2.16, -3.12);
    }
    box(0.1, 0.72, 0.16, carbonMat, 0, 1.42, -2.94);
    box(1.35, 0.055, 0.3, carbonMat, 0, 0.92, -3.18);
    box(0.5, 0.1, 0.22, carbonMat, 0, 1.86, -3.05);

    const exhaust = add(
      new THREE.CylinderGeometry(0.12, 0.13, 0.4, 12), exhaustMat, 0, 0.8, -3.34
    );
    exhaust.rotation.x = Math.PI / 2;
    const glow = add(
      new THREE.CylinderGeometry(0.09, 0.09, 0.03, 12), glowMat, 0, 0.8, -3.54
    );
    glow.rotation.x = Math.PI / 2;
    box(0.13, 0.16, 0.05, lightMat, 0, 0.55, -3.32);

    // ---- 轮胎 / 轮辋 / 悬挂 ----
    const tireGeo = new THREE.CylinderGeometry(0.93, 0.93, 0.64, 26);
    tireGeo.rotateZ(Math.PI / 2);
    const ringGeo = new THREE.TorusGeometry(0.46, 0.05, 8, 26);
    const hubGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.68, 14);
    hubGeo.rotateZ(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(0.05, 0.72, 0.09);

    const wheels = [];
    const frontWheels = [];

    for (const z of [1.86, -1.92]) {
      for (const sx of [-1.5, 1.5]) {
        const w = new THREE.Group();
        w.add(new THREE.Mesh(tireGeo, tireMat));

        const ring = new THREE.Mesh(ringGeo, metalMat);
        ring.rotation.y = Math.PI / 2;
        w.add(ring);

        for (let k = 0; k < 6; k++) {
          const spoke = new THREE.Mesh(spokeGeo, metalMat);
          spoke.rotation.x = (k * Math.PI) / 6;
          w.add(spoke);
        }

        w.add(new THREE.Mesh(hubGeo, metalMat));

        const nut = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8), helmetMat
        );
        nut.rotation.z = Math.PI / 2;
        nut.position.x = sx > 0 ? 0.36 : -0.36;
        w.add(nut);

        w.position.set(sx, 0.93, z);
        car.add(w);
        wheels.push(w);
        if (z > 0) frontWheels.push(w);

        // 刹车卡钳
        box(0.16, 0.3, 0.22, carbonMat, sx, 1.16, z + 0.22);

        // 悬挂拉杆与传动轴
        const bodyX = (z > 0 ? 0.3 : 0.36) * (sx > 0 ? 1 : -1);
        const wheelX = sx > 0 ? 1.16 : -1.16;
        const armZ = z > 0 ? 0.42 : 0.5;
        rod([bodyX, 0.52, z + armZ], [wheelX, 0.66, z + 0.16], 0.038, carbonMat);
        rod([bodyX, 0.52, z - armZ], [wheelX, 0.66, z - 0.16], 0.038, carbonMat);
        rod([bodyX, 1.06, z + armZ * 0.7], [wheelX, 1.02, z + 0.1], 0.034, carbonMat);
        rod([bodyX, 1.06, z - armZ * 0.7], [wheelX, 1.02, z - 0.1], 0.034, carbonMat);
        rod([bodyX, 0.78, z], [wheelX, 0.78, z], 0.055, metalMat);
      }
    }

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 8.2),
      new THREE.MeshBasicMaterial({
        map: makeShadowTexture(), transparent: true, depthWrite: false,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    car.add(shadow);

    scene.add(car);
    return { car, wheels, frontWheels };
  }

  // ---------- 兰博基尼 ----------
  function makeLamborghini() {
    const car = new THREE.Group();

    const paint = new THREE.MeshStandardMaterial({
      color: 0xf5c400, metalness: 0.62, roughness: 0.26,
    });
    const paintDark = new THREE.MeshStandardMaterial({
      color: 0xd9a900, metalness: 0.55, roughness: 0.35,
    });
    const carbon = new THREE.MeshStandardMaterial({
      color: 0x121418, metalness: 0.55, roughness: 0.42,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x0d151d, metalness: 0.9, roughness: 0.08,
    });
    const silver = new THREE.MeshStandardMaterial({
      color: 0xcfd5dd, metalness: 0.95, roughness: 0.2,
    });
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x0f1115, roughness: 0.95,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xdfefff, emissiveIntensity: 1.4,
    });
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0xff2a20, emissive: 0xff1208, emissiveIntensity: 1.6,
    });

    const add = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      car.add(mesh);
      return mesh;
    };
    const box = (w, h, d, mat, x, y, z) =>
      add(new THREE.BoxGeometry(w, h, d), mat, x, y, z);

    // 底盘 / 车体
    box(1.9, 0.18, 4.5, carbon, 0, 0.3, 0);
    box(1.78, 0.42, 3.5, paint, 0, 0.6, 0.05);

    // 前部楔形车头
    const nose = box(1.68, 0.28, 1.6, paint, 0, 0.58, 1.95);
    nose.rotation.x = -0.05;
    box(1.86, 0.1, 0.62, carbon, 0, 0.3, 2.5);
    box(1.74, 0.26, 0.34, paint, 0, 0.48, 2.46);
    box(0.92, 0.16, 0.1, carbon, 0, 0.36, 2.6);
    const hood = box(1.56, 0.1, 1.42, paintDark, 0, 0.8, 1.4);
    hood.rotation.x = 0.05;
    box(0.035, 0.03, 1.2, carbon, -0.5, 0.86, 1.42);
    box(0.035, 0.03, 1.2, carbon, 0.5, 0.86, 1.42);

    // 前大灯
    for (const sx of [-1, 1]) {
      const lamp = box(0.56, 0.09, 0.1, headMat, 0.56 * sx, 0.74, 2.4);
      lamp.rotation.y = 0.3 * sx;
      lamp.rotation.x = -0.1;
    }

    // 侧裙 / 进气口 / 后视镜 / 轮眉
    for (const sx of [-1, 1]) {
      box(0.1, 0.2, 2.3, carbon, 0.9 * sx, 0.4, 0.1);
      const intake = box(0.1, 0.26, 0.95, carbon, 0.92 * sx, 0.82, -1.05);
      intake.rotation.z = 0.07 * sx;
      box(0.03, 0.03, 0.22, carbon, 0.86 * sx, 1.0, 0.6);
      const mirror = box(0.24, 0.08, 0.1, paint, 0.97 * sx, 1.03, 0.66);
      mirror.rotation.y = -0.15 * sx;

      for (const fz of [1.48, -1.45]) {
        box(0.32, 0.16, 1.0, paint, 0.94 * sx, 0.9, fz);
      }
    }

    // 座舱
    const windshield = box(1.38, 0.06, 1.2, glass, 0, 1.0, 0.62);
    windshield.rotation.x = -0.5;
    for (const sx of [-1, 1]) {
      box(0.05, 0.28, 1.2, glass, 0.68 * sx, 1.0, -0.18);
    }
    box(1.32, 0.1, 0.98, paint, 0, 1.18, -0.3);
    const rearGlass = box(1.26, 0.06, 0.9, glass, 0, 1.0, -0.98);
    rearGlass.rotation.x = 0.5;

    // 后翼子板 / 引擎盖 / 尾翼
    box(1.94, 0.4, 1.55, paint, 0, 0.76, -1.3);
    box(1.7, 0.07, 0.95, carbon, 0, 1.0, -1.85);
    for (const dz of [-1.72, -1.86, -2.0]) {
      box(1.5, 0.03, 0.05, silver, 0, 1.05, dz);
    }
    box(1.86, 0.06, 0.34, carbon, 0, 1.14, -2.12);
    for (const sx of [-1, 1]) {
      box(0.06, 0.14, 0.32, carbon, 0.85 * sx, 1.08, -2.12);
    }

    // 尾部：尾灯 / 扩散器 / 四出排气
    box(1.86, 0.32, 0.32, paint, 0, 0.62, -2.28);
    box(1.8, 0.2, 0.45, carbon, 0, 0.36, -2.18);
    for (const sx of [-0.55, 0.55]) {
      box(0.58, 0.09, 0.06, tailMat, sx, 0.84, -2.44);
    }
    for (const sx of [-0.52, -0.34, 0.34, 0.52]) {
      const pipe = add(
        new THREE.CylinderGeometry(0.065, 0.065, 0.14, 10), silver,
        sx, 0.47, -2.42
      );
      pipe.rotation.x = Math.PI / 2;
    }

    // 车轮
    const tireGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.3, 22);
    tireGeo.rotateZ(Math.PI / 2);
    const ringGeo = new THREE.TorusGeometry(0.23, 0.03, 8, 22);
    const spokeGeo = new THREE.BoxGeometry(0.04, 0.3, 0.06);
    const hubGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10);
    hubGeo.rotateZ(Math.PI / 2);

    const wheels = [];
    const frontWheels = [];
    for (const z of [1.48, -1.45]) {
      for (const sx of [-0.94, 0.94]) {
        const w = new THREE.Group();
        w.add(new THREE.Mesh(tireGeo, tireMat));

        const ring = new THREE.Mesh(ringGeo, silver);
        ring.rotation.y = Math.PI / 2;
        w.add(ring);

        for (let k = 0; k < 5; k++) {
          const spoke = new THREE.Mesh(spokeGeo, silver);
          spoke.rotation.x = (k * Math.PI) / 5;
          w.add(spoke);
        }
        w.add(new THREE.Mesh(hubGeo, silver));

        w.position.set(sx, 0.43, z);
        car.add(w);
        wheels.push(w);
        if (z > 0) frontWheels.push(w);
      }
    }

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 6.4),
      new THREE.MeshBasicMaterial({
        map: makeShadowTexture(), transparent: true, depthWrite: false,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    car.add(shadow);

    scene.add(car);
    return { car, wheels, frontWheels };
  }

  const CAR_KEY = 'speed-track-car';
  let carModel = localStorage.getItem(CAR_KEY) === 'lambo' ? 'lambo' : 'f1';
  let carRig = carModel === 'lambo' ? makeLamborghini() : makeCar();
  let car = carRig.car;

  // ---------- 车辆状态与物理 ----------
  const MAX_SPEED = 62;
  const REVERSE_SPEED = 16;
  const ACCEL = 27;
  const BRAKE = 46;
  const REVERSE_ACCEL = 18;
  const TURN_RATE = 1.75;

  let heading = 0;
  let speed = 0;
  let steer = 0;
  let nearestIdx = 0;
  let accumulated = 0;
  let laps = 0;
  let lapStart = 0;
  let raceStart = 0;
  let bestLap = null;
  let offTrack = false;
  let submittedLaps = 0;

  const forward = new THREE.Vector3();

  function resetRace() {
    const p = pts[0];
    car.position.set(p.x, 0, p.z);
    heading = Math.atan2(tangentAt(0).x, tangentAt(0).z);
    car.rotation.y = heading;
    speed = 0;
    steer = 0;
    nearestIdx = 0;
    accumulated = 0;
    laps = 0;
    lapStart = performance.now();
    raceStart = lapStart;
    bestLap = null;
    submittedLaps = 0;
    updateHud(true);
    resetCamera();
  }

  // ---------- 输入 ----------
  const keys = { up: false, down: false, left: false, right: false };

  function setKey(e, pressed) {
    const k = e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) {
      e.preventDefault();
    }
    if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = pressed;
    if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = pressed;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = pressed;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = pressed;
  }

  window.addEventListener('keydown', (e) => setKey(e, true));
  window.addEventListener('keyup', (e) => setKey(e, false));
  window.addEventListener('blur', () => {
    keys.up = keys.down = keys.left = keys.right = false;
  });

  // ---------- 相机 ----------
  const camGoal = new THREE.Vector3();
  const lookGoal = new THREE.Vector3();
  const lookAt = new THREE.Vector3();

  function resetCamera() {
    const f = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    camera.position.copy(car.position).addScaledVector(f, -11.8).add(new THREE.Vector3(0, 6.0, 0));
    lookAt.copy(car.position).addScaledVector(f, 8);
    lookAt.y = 1.2;
    camera.lookAt(lookAt);
  }

  // ---------- 圈数判定 ----------
  function updateProgress() {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      const dx = car.position.x - p.x;
      const dz = car.position.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    const dist = Math.sqrt(bestDist);
    offTrack = dist > HALF_W + 0.6;

    let delta = best - nearestIdx;
    if (delta > N / 2) delta -= N;
    if (delta < -N / 2) delta += N;
    nearestIdx = best;

    // 只在赛道上累计，且忽略瞬移级别的大跳变（防止抄近道刷圈）
    if (!offTrack && Math.abs(delta) < 30) {
      accumulated += delta;
      if (accumulated >= N - 3) {
        accumulated -= N;
        onLapComplete();
      } else if (accumulated < -N) {
        accumulated += N;
      }
    }
    return dist;
  }

  function onLapComplete() {
    laps += 1;
    const now = performance.now();
    const lapMs = now - lapStart;
    lapStart = now;
    if (bestLap === null || lapMs < bestLap) bestLap = lapMs;
    showToast(`第 ${laps} 圈完成 · 单圈 ${(lapMs / 1000).toFixed(1)}s`);
    updateHud(true);
    submitScore(true);
  }

  // ---------- HUD ----------
  let lastHud = 0;

  function updateHud(force) {
    const now = performance.now();
    if (!force && now - lastHud < 100) return;
    lastHud = now;
    lapsEl.textContent = laps;
    speedEl.textContent = Math.round(Math.abs(speed) * 3.6);
    lapTimeEl.textContent = ((now - lapStart) / 1000).toFixed(1);
    if (bestLap !== null) {
      lapTimeEl.title = `最快单圈 ${(bestLap / 1000).toFixed(1)}s`;
    }
  }

  // ---------- 网络 ----------
  function renderLeaderboard(data) {
    if (!data.rows.length) {
      lbListEl.innerHTML = '<li class="loading">还没有成绩，快去跑第一圈</li>';
      return;
    }
    lbListEl.innerHTML = data.rows.map((r) => `
      <li class="${r.is_me ? 'me' : ''}">
        <span class="no">${r.rank}</span>
        <span class="who">${escapeHtml(r.username)}</span>
        <span class="score">${r.laps}</span>
      </li>
    `).join('');
    myRankEl.textContent = data.my_rank ? `我的排名 #${data.my_rank}` : '';
    myLapsLabelEl.textContent = `我的最好成绩：${data.my_laps} 圈`;
    bestLapsEl.textContent = data.my_laps;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  async function loadLeaderboard() {
    try {
      const res = await fetch('/api/leaderboard', { cache: 'no-store' });
      if (!res.ok) return;
      renderLeaderboard(await res.json());
    } catch (err) {
      // 离线时静默失败，不影响游戏
    }
  }

  let submitting = false;

  async function submitScore(auto) {
    if (submitting) return;
    if (laps <= submittedLaps) {
      if (!auto) showToast('还没有新的圈数，先跑一圈吧');
      return;
    }
    submitting = true;
    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ laps }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) throw new Error('submit failed');
      const data = await res.json();
      submittedLaps = laps;
      bestLapsEl.textContent = data.laps;
      if (!auto) {
        showToast(`成绩已提交：${data.laps} 圈${data.rank ? ' · 当前第 ' + data.rank + ' 名' : ''}`);
      }
      loadLeaderboard();
    } catch (err) {
      if (!auto) showToast('提交失败，请稍后再试');
    } finally {
      submitting = false;
    }
  }

  let toastTimer = 0;

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function switchCar(model) {
    if (model === carModel) return;
    carModel = model;

    const pos = car.position.clone();
    scene.remove(carRig.car);
    carRig = model === 'lambo' ? makeLamborghini() : makeCar();
    car = carRig.car;
    car.position.copy(pos);
    car.rotation.y = heading;
    car.rotation.z = 0;

    document.querySelectorAll('.car-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.model === model);
    });
    try {
      localStorage.setItem(CAR_KEY, model);
    } catch (err) {
      // 隐私模式下写入失败不影响游戏
    }
    showToast(model === 'lambo' ? '已换车：兰博基尼' : '已换车：F1 赛车');
  }

  document.querySelectorAll('.car-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.model === carModel);
    btn.addEventListener('click', () => switchCar(btn.dataset.model));
  });

  restartBtn.addEventListener('click', () => {
    resetRace();
    showToast('已重新开始，圈数从 0 计算');
  });

  submitBtn.addEventListener('click', () => submitScore(false));

  // ---------- 主循环 ----------
  let lastTime = performance.now();
  let lastProgressAt = 0;

  function tick(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // 转向
    const steerInput = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    steer += (steerInput - steer) * Math.min(1, dt * 10);
    const speedFactor = Math.min(1, Math.abs(speed) / 16);
    const dirSign = speed >= 0 ? 1 : -1;
    heading += steer * TURN_RATE * speedFactor * dirSign * dt;

    // 油门 / 刹车
    if (keys.up) speed += ACCEL * dt;
    if (keys.down) {
      if (speed > 0.6) speed -= BRAKE * dt;
      else speed -= REVERSE_ACCEL * dt;
    }
    if (!keys.up && !keys.down) {
      speed *= Math.pow(0.55, dt);
    }
    if (offTrack) {
      speed *= Math.pow(0.28, dt);
    }
    speed = Math.max(-REVERSE_SPEED, Math.min(MAX_SPEED, speed));

    // 位移
    forward.set(Math.sin(heading), 0, Math.cos(heading));
    car.position.addScaledVector(forward, speed * dt);
    car.position.y = 0;
    car.rotation.y = heading;

    // 车身姿态：转向倾斜
    car.rotation.z = -steer * 0.05 * speedFactor;
    car.rotation.x = Math.max(-0.06, Math.min(0.06, -speed * 0.0009));

    // 车轮转动
    for (const w of carRig.wheels) w.rotation.x += speed * dt * 1.9;
    for (const w of carRig.frontWheels) w.rotation.y = steer * 0.42;

    // 圈数 / 出界判定（每 2 帧一次即可）
    if (now - lastProgressAt > 30) {
      lastProgressAt = now;
      updateProgress();
    }

    // 相机跟随
    const camDist = 11.8 + Math.abs(speed) * 0.03;
    const camHeight = 6.0 + Math.abs(speed) * 0.012;
    camGoal.copy(car.position).addScaledVector(forward, -camDist);
    camGoal.y = camHeight;
    camera.position.lerp(camGoal, 1 - Math.pow(0.0015, dt));

    lookGoal.copy(car.position).addScaledVector(forward, 8);
    lookGoal.y = 1.2;
    lookAt.lerp(lookGoal, 1 - Math.pow(0.0008, dt));
    camera.lookAt(lookAt);

    const targetFov = 60 + (Math.abs(speed) / MAX_SPEED) * 7;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }

    updateHud(false);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  // ---------- 初始化 ----------
  resetRace();
  updateHud(true);
  loadLeaderboard();
  setInterval(loadLeaderboard, 15000);

  setTimeout(() => tipEl.classList.add('hide'), 9000);
  setTimeout(() => { tipEl.style.display = 'none'; }, 10000);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  requestAnimationFrame(tick);
})();
