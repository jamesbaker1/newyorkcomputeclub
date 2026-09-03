// the five boroughs as a load histogram: one instanced box per lot.
// manhattan gets 1-unit lots; the outer boroughs sprawl finer and dimmer.
// heat wanders the grid on its own; your cursor overrides it.
// above the rooftops: the cluster. nodes at the real carrier hotels,
// jobs routing between them. arrivals warm the streets below.
// new jersey is not rendered.

import {
  WebGLRenderer, Scene, PerspectiveCamera, FogExp2, AmbientLight, DirectionalLight,
  BoxGeometry, PlaneGeometry, OctahedronGeometry, BufferGeometry, BufferAttribute,
  MeshLambertMaterial, MeshBasicMaterial, LineBasicMaterial, PointsMaterial,
  InstancedMesh, Mesh, Line, LineSegments, Points, DynamicDrawUsage, AdditiveBlending,
  Matrix4, Color, Vector2, Vector3, Plane, Raycaster, QuadraticBezierCurve3, Group,
} from 'three';

console.log('%cNEW YORK COMPUTE CLUB', 'font-weight:bold;background:#FF4E00;color:#0E0C0A;padding:2px 8px;');
console.log('five boroughs, rendered as load. the lights are real buildings:\n60 hudson st. 111 8th ave. the teleport. the packets are jobs.\nnew jersey is not rendered. applications open: /about');

const PAPER = 0x0E0C0A;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

function buildCity() {
  const canvas = document.getElementById('city');
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(PAPER, 1);

  const scene = new Scene();
  scene.fog = new FogExp2(PAPER, 0.006);

  const camera = new PerspectiveCamera(36, 1, 0.1, 600);

  scene.add(new AmbientLight(0x8a8078, 0.6));
  const sun = new DirectionalLight(0xfff2e2, 1.3);
  sun.position.set(30, 42, -18); // late light off the hudson (world x is west)
  scene.add(sun);

  // the lot math below uses map coordinates, +x east, +z north. seen from
  // above with +y up that is a left-handed layout, so drawn raw the city
  // comes out mirrored: brooklyn on the wrong side of the river. one flip
  // fixes every lot, bridge, node, and wire at once.
  const city = new Group();
  city.scale.x = -1;
  scene.add(city);

  // deterministic per-lot randomness
  const hash = (ix, iz) => {
    let h = (ix * 374761393 + iz * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const vnoise = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z);
    const u = (x - xi) ** 2 * (3 - 2 * (x - xi));
    const v = (z - zi) ** 2 * (3 - 2 * (z - zi));
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, z) =>
    0.55 * vnoise(x, z) + 0.30 * vnoise(x * 2.1 + 7.3, z * 2.1 + 3.1) + 0.15 * vnoise(x * 4.3 + 13.7, z * 4.3 + 9.2);
  const gauss = (d, s) => Math.exp(-(d * d) / (2 * s * s));
  const gauss2 = (dx, dz, s) => Math.exp(-(dx * dx + dz * dz) / (2 * s * s));

  // -------- landmasses. +x east, +z north, water is wherever nothing stands.
  const mEast = z => 9.8 * (1 - Math.abs(z / 33.5) ** 2.2) ** (1 / 2.2);
  const inManhattan = (x, z) => {
    if ((Math.abs(x) / 9.8) ** 2.2 + (Math.abs(z) / 33.5) ** 2.2 > 1) return false; // water
    if (x > -2.6 && x < 2.6 && z > 6 && z < 19) return false;                       // central park
    if (Math.abs(x - (1.5 - 0.1226 * (z + 33))) < 0.55) return false;               // broadway
    return true;
  };
  // brooklyn + queens: one landmass, west coast tracking the east river
  const inBQ = (x, z) => {
    const coast = z >= -32 ? mEast(z) + 4.5 : 8 + (z + 32) * 0.9;
    if (x < coast) return false;
    const main = Math.abs((x - 26) / 24) ** 2.5 + Math.abs((z + 13) / 40) ** 2.5 <= 1;
    const swLobe = ((x - 2) / 12) ** 2 + ((z + 46) / 7) ** 2 <= 1; // bay ridge & coney
    return main || swLobe;
  };
  const inBronx = (x, z) => Math.abs((x - 4) / 13) ** 2.2 + Math.abs((z - 49) / 11) ** 2.2 <= 1;
  const inSI = (x, z) => ((x + 24) / 11) ** 2 + ((z + 52) / 10) ** 2 <= 1;

  const lots = [];
  // manhattan, fine grain: the hero
  for (let ix = -11; ix <= 11; ix++) {
    for (let iz = -35; iz <= 35; iz++) {
      if (!inManhattan(ix, iz)) continue;
      const r = hash(ix, iz);
      const shore = (Math.abs(ix) / 9.8) ** 2.2 + (Math.abs(iz) / 33.5) ** 2.2;
      let base =
        0.5 +
        5.2 * gauss(iz - 2, 6.5) * gauss(ix - 0.5, 5.0) +  // midtown
        4.4 * gauss(iz + 25, 4.5) * gauss(ix, 3.2);        // downtown
      base *= 1 - shore * 0.55;
      if (r > 0.986) base *= 1.9;                          // supertalls
      lots.push({ x: ix, z: iz, r, base, fp: 0.60 + 0.22 * r, fp2: 0.60 + 0.22 * hash(iz, ix), outer: false });
    }
  }
  // outer boroughs: fine, low, dim sprawl. a few real skylines poke out.
  for (let x = -39; x <= 51; x += 1.5) {
    for (let z = -63; z <= 59; z += 1.5) {
      if (!(inBQ(x, z) || inBronx(x, z) || inSI(x, z))) continue;
      const r = hash(x * 2, z * 2);
      let base =
        0.34 +
        1.1 * gauss2(x - 22, z + 2, 15) +     // broad brooklyn + queens swell
        2.8 * gauss2(x - 14, z + 27, 3.0) +   // downtown brooklyn
        1.5 * gauss2(x - 15, z + 18.5, 2.2) + // williamsburg waterfront
        2.9 * gauss2(x - 16, z - 1, 2.6) +    // long island city
        0.7 * gauss2(x - 2, z - 44, 3.0) +    // south bronx
        0.5 * gauss2(x + 20, z + 46, 2.0);    // st. george
      base *= 0.78 + 0.5 * r;
      if (r > 0.993) base *= 1.7;             // the odd outer-borough tower
      lots.push({ x, z, r, base, fp: 0.72 + 0.26 * r, fp2: 0.72 + 0.26 * hash(z * 2, x * 2), outer: true });
    }
  }

  const geo = new BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0); // grow from the ground
  const mesh = new InstancedMesh(geo, new MeshLambertMaterial({ color: 0xffffff }), lots.length);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  { // allocate instanceColor up front; the intro wave skips unbuilt lots
    const c0 = new Color(0x201C18);
    for (let i = 0; i < lots.length; i++) mesh.setColorAt(i, c0);
  }
  city.add(mesh);

  // water: barely lighter than the void, so the islands read as islands
  const water = new Mesh(
    new PlaneGeometry(700, 700).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0x14110E })
  );
  water.position.y = -0.07;
  city.add(water);

  // -------- bridges: thin arcs where the real ones are
  const bridgeMat = new LineBasicMaterial({ color: 0x8f867a, transparent: true, opacity: 0 });
  const BRIDGES = [
    [[6.4, -27], [13, -30]],     // brooklyn
    [[7.0, -24.5], [13.5, -27]], // manhattan
    [[8.4, -18], [13.5, -19]],   // williamsburg
    [[9.6, -1], [14.8, 0]],      // queensboro
    [[1.5, 33], [3, 38.5]],      // harlem river
    [[-13, -49.5], [-7, -48.5]], // verrazzano
  ];
  for (const [[ax, az], [bx, bz]] of BRIDGES) {
    const curve = new QuadraticBezierCurve3(
      new Vector3(ax, 0.25, az),
      new Vector3((ax + bx) / 2, 1.0, (az + bz) / 2),
      new Vector3(bx, 0.25, bz)
    );
    city.add(new Line(new BufferGeometry().setFromPoints(curve.getPoints(14)), bridgeMat));
  }

  // -------- the cluster. nodes at the real buildings, jobs on the wires.
  const NODES = [
    { x: -2, z: -26, y: 9 },      // 60 hudson st
    { x: -3.5, z: -13, y: 7.5 },  // 111 8th ave
    { x: 15, z: -27, y: 6 },      // downtown brooklyn
    { x: 16, z: 1, y: 6.5 },      // long island city
    { x: 6, z: 44, y: 4 },        // the bronx
    { x: -24, z: -52, y: 3 },     // the teleport, staten island
    { x: 40, z: -32, y: 3 },      // the airport cage
  ];
  const LINKS = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [0, 5], [2, 6]];

  const heatCol = new Color(0xFF4E00);
  const flareCol = new Color(0xFFE2C4);
  const nodeGeo = new OctahedronGeometry(0.55);
  for (const n of NODES) {
    n.flare = 0;
    n.kick = 0;
    n.mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    n.mesh = new Mesh(nodeGeo, n.mat);
    n.mesh.position.set(n.x, n.y, n.z);
    city.add(n.mesh);
  }
  // hairline pins down to the street
  const pinMat = new LineBasicMaterial({ color: 0xEDE6DA, transparent: true, opacity: 0 });
  {
    const pts = [];
    for (const n of NODES) pts.push(new Vector3(n.x, n.y - 0.38, n.z), new Vector3(n.x, 0, n.z));
    city.add(new LineSegments(new BufferGeometry().setFromPoints(pts), pinMat));
  }
  // the wires: low arcs between nodes
  const linkMat = new LineBasicMaterial({ color: 0xEDE6DA, transparent: true, opacity: 0 });
  const wires = LINKS.map(([ai, bi]) => {
    const a = NODES[ai], b = NODES[bi];
    const len = Math.hypot(a.x - b.x, a.z - b.z);
    const curve = new QuadraticBezierCurve3(
      new Vector3(a.x, a.y, a.z),
      new Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + len * 0.14, (a.z + b.z) / 2),
      new Vector3(b.x, b.y, b.z)
    );
    city.add(new Line(new BufferGeometry().setFromPoints(curve.getPoints(30)), linkMat));
    return { curve, len, a: ai, b: bi };
  });
  const touching = NODES.map((_, ni) => LINKS.flatMap(([a, b], li) => (a === ni || b === ni ? [li] : [])));

  // packets: jobs in flight. head + trail as screen-space points.
  const MAXP = 16;
  const packets = [];
  let spawnCount = 0, spawnT = 0.4;
  const mkPoints = (size, opacity) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(MAXP * 3).fill(-999), 3));
    const p = new Points(g, new PointsMaterial({
      color: 0xFF6A26, size, sizeAttenuation: false, transparent: true, opacity,
      blending: AdditiveBlending, depthWrite: false,
    }));
    p.frustumCulled = false;
    city.add(p);
    return g.attributes.position;
  };
  const heads = mkPoints(6, 0.95);
  const trails = mkPoints(3.5, 0.4);

  const spawnPacket = (li, dir) => {
    if (packets.length >= MAXP) return;
    packets.push({ li, dir, s: 0, v: 9 / wires[li].len });
  };
  const v3 = new Vector3();

  // -------- heat: one roaming source, five boroughs to visit
  const heat = { x: 0, z: -20, tx: 0, tz: -20 };
  let pointerAt = -1e9;
  const nd = new Vector2();
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const ray = new Raycaster();
  const hit = new Vector3();
  addEventListener('pointermove', e => {
    if (!frameIdx) return; // camera has no world matrix until the first render
    nd.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(nd, camera);
    if (ray.ray.intersectPlane(ground, hit)) {
      heat.tx = Math.max(-38, Math.min(50, -hit.x)); // world x back to map x
      heat.tz = Math.max(-62, Math.min(58, hit.z));
      pointerAt = performance.now();
    }
  }, { passive: true });

  let pulse = 0;
  window.__surge = () => {
    pulse = 1;
    wires.forEach((_, li) => spawnPacket(li, li % 2)); // every wire lights up
  };

  let portrait = false;
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    portrait = camera.aspect < 0.85;
    camera.fov = portrait ? 52 : 36;
    // landscape: pan the frame so the city sits right of the wordmark
    if (portrait) camera.clearViewOffset();
    else camera.setViewOffset(w, h, -0.16 * w, 0, w, h);
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', () => { resize(); if (REDUCED) frame(17, 0); });

  // adaptive quality: if frames run well behind the display's own cadence,
  // drop pixel ratio once. baseline is measured, so a 30hz display or a
  // low-power-mode rAF throttle does not read as a struggling gpu.
  let dprCap = 2, slow = 0, frames = 0, baseDt = 0;
  const dts = [];

  const m4 = new Matrix4();
  const col = new Color();
  let frameIdx = 0, introT = REDUCED ? 99 : 0;

  function frame(t, dt) {
    frameIdx++;
    introT += dt;
    // the city assembles itself: a wave of construction out of downtown
    const rise = introT < 6;
    const net = clamp01((introT - 2.1) / 0.9); // the cluster comes online after
    if (net < 1) {
      linkMat.opacity = 0.2 * net;
      pinMat.opacity = 0.14 * net;
      bridgeMat.opacity = 0.3 * net;
      for (const n of NODES) n.mat.opacity = net;
    }

    if (portrait) {
      camera.position.set(22 + 3 * Math.sin(t * 0.04), 64, -88);
      camera.lookAt(-2, 0, -10);
    } else {
      camera.position.set(30 + 3 * Math.sin(t * 0.04), 46, -74);
      camera.lookAt(-4, 0, -4);
    }

    if (performance.now() - pointerAt > 4000) {
      heat.tx = 26 * Math.sin(t * 0.09) + 9 * Math.sin(t * 0.23);
      heat.tz = 34 * Math.sin(t * 0.05 + 1.2) + 8 * Math.sin(t * 0.17);
    }
    heat.x = lerp(heat.x, heat.tx, 0.05);
    heat.z = lerp(heat.z, heat.tz, 0.05);
    pulse *= 0.965;
    // real wattage on the grid leans on the roaming heat, gently
    const gw = (window.__grid && window.__grid.watts) || 0;
    const gridBoost = 1 + Math.min(1, gw / 400) * 0.3;

    // packets fly, nodes flare, arrivals warm the streets
    if (introT > 2.6) {
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnT = 0.8 + 1.6 * hash(++spawnCount, 991);
        spawnPacket(Math.floor(hash(spawnCount, 313) * wires.length), hash(spawnCount, 77) > 0.5 ? 1 : 0);
      }
    }
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      p.s += p.v * dt;
      if (p.s >= 1) {
        const w = wires[p.li];
        const ni = p.dir ? w.a : w.b;
        NODES[ni].flare = 1;
        NODES[ni].kick = 1;
        if (hash(++spawnCount, 553) < 0.45) { // the job gets routed onward
          const opts = touching[ni];
          const nl = opts[Math.floor(hash(spawnCount, 271) * opts.length)];
          spawnPacket(nl, LINKS[nl][0] === ni ? 0 : 1);
        }
        packets.splice(i, 1);
      }
    }
    for (let i = 0; i < MAXP; i++) {
      const p = packets[i];
      if (p) {
        const w = wires[p.li];
        w.curve.getPoint(p.dir ? 1 - p.s : p.s, v3);
        heads.setXYZ(i, v3.x, v3.y, v3.z);
        w.curve.getPoint(p.dir ? Math.min(1, 1 - p.s + 0.045) : Math.max(0, p.s - 0.045), v3);
        trails.setXYZ(i, v3.x, v3.y, v3.z);
      } else {
        heads.setXYZ(i, 0, -999, 0);
        trails.setXYZ(i, 0, -999, 0);
      }
    }
    heads.needsUpdate = true;
    trails.needsUpdate = true;

    const hotNodes = [];
    for (const n of NODES) {
      n.flare *= Math.exp(-dt * 3.2);
      n.kick *= Math.exp(-dt * 2.6);
      if (n.kick > 0.02) hotNodes.push(n);
      n.mesh.rotation.y += dt * 0.4;
      n.mesh.scale.setScalar(1 + 0.7 * n.flare);
      n.mat.color.copy(heatCol).multiplyScalar(0.4 + 0.6 * n.flare).lerp(flareCol, n.flare * 0.7);
    }

    for (let i = 0; i < lots.length; i++) {
      const L = lots[i];
      // outer boroughs update at half rate; they move slowly anyway
      if (!REDUCED && L.outer && !rise && (i + frameIdx) % 2) continue;
      const load = L.outer
        ? vnoise(L.x * 0.055 + t * 0.04, L.z * 0.055 - t * 0.016)
        : fbm(L.x * 0.09 + t * 0.05, L.z * 0.09 - t * 0.02);
      const hot = gauss(Math.hypot(L.x - heat.x, L.z - heat.z), 3.4);
      let kickHeat = 0;
      for (const n of hotNodes) kickHeat += n.kick * gauss2(L.x - n.x, L.z - n.z, 2.6);
      let h = Math.max(0.1, L.base * (0.30 + 0.85 * load) + hot * 2.4 * gridBoost + kickHeat * 1.6 + pulse * L.base * 0.55);
      if (rise) {
        const e = clamp01(introT * 1.15 - Math.hypot(L.x, L.z + 25) * 0.052);
        h *= e * e * (3 - 2 * e);
        if (h < 0.001) { m4.makeScale(1, 0.001, 1); m4.setPosition(L.x, -1, L.z); mesh.setMatrixAt(i, m4); continue; }
      }

      m4.makeScale(L.fp, h, L.fp2);
      m4.setPosition(L.x, 0, L.z);
      mesh.setMatrixAt(i, m4);

      const g = (L.outer ? 0.27 : 0.30) + 0.16 * L.r;
      col.setRGB(g * 1.06, g * 0.97, g * 0.85);
      const warm = Math.min(1, hot * 0.9 + kickHeat * 0.8 + pulse * 0.35 + Math.max(0, load - 0.72) * 0.9);
      col.lerp(heatCol, warm);
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    renderer.render(scene, camera);
  }

  resize();
  canvas.classList.add('on');

  if (REDUCED) {
    // a still: three jobs mid-flight over a lit city
    linkMat.opacity = 0.2; pinMat.opacity = 0.14; bridgeMat.opacity = 0.3;
    for (const n of NODES) n.mat.opacity = 1;
    spawnPacket(0, 0); packets[0].s = 0.35;
    spawnPacket(3, 1); packets[1].s = 0.6;
    spawnPacket(5, 0); packets[2].s = 0.8;
    frame(17, 0);
  } else {
    let last = 0;
    renderer.setAnimationLoop(ms => {
      const dt = Math.min(0.05, (ms - last) / 1000 || 0.016);
      last = ms;
      if (dts.length < 50) {
        dts.push(dt);
        if (dts.length === 50) baseDt = [...dts].sort((a, b) => a - b)[25];
      } else if (baseDt && dt > baseDt * 1.7) slow++;
      if (++frames === 240) {
        if (slow > 150 && dprCap > 1.3) { dprCap = 1.3; resize(); }
        frames = 0; slow = 0;
      }
      frame(ms / 1000, dt);
    });
  }
}

try { buildCity(); } catch (e) { console.log('no webgl. the list still works.', e?.message ?? e); }
