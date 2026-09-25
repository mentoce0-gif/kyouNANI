/* たした — 「私のあゆみ」ヒーロービジュアル(素のWebGL、外部ライブラリ不使用)
   球面上を編むように巡る光の糸。周期のずれた揺らぎを重ねて同じ姿に戻らないようにし、
   蓄積時間(progress)に応じて糸が一本ずつ太り、発光が強まる。 */
window.TashitaScene = (() => {
  "use strict";

  /* ---- 行列ユーティリティ(列優先, WebGL標準) ---- */
  function m4identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  function m4multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
        out[col * 4 + row] = sum;
      }
    }
    return out;
  }
  function m4perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  }
  function m4translate(x, y, z) {
    const m = m4identity();
    m[12] = x;
    m[13] = y;
    m[14] = z;
    return m;
  }
  function m4rotateY(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }
  function m4rotateX(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  }

  /* ---- 光の糸の形状 ---- */
  const STRANDS = [
    { n: 2, k: 3 },
    { n: 3, k: 5 },
    { n: 2, k: 5 },
    { n: 3, k: 4 },
    { n: 1, k: 3 },
  ];
  const SEGMENTS = 280;
  const RADIAL = 10;
  const TUBE = 0.055;

  // 閉曲線: 経度は n 周、緯度は k 回うねる。位相・振幅・半径が時間 tau でゆっくり漂う
  function strandPoint(s, t, tau, out) {
    const { n, k } = STRANDS[s];
    const amp = 0.78 + 0.26 * Math.sin(0.17 * tau + 1.3 * s);
    const phase = tau * (0.21 + 0.047 * s) + s * 1.7;
    const lon = n * t + (s * Math.PI * 2) / STRANDS.length + 0.05 * tau;
    const lat = amp * Math.sin(k * t + phase);
    const r = 1 + 0.06 * Math.sin(2 * t + 0.41 * tau + s);
    const cl = Math.cos(lat);
    out[0] = r * cl * Math.cos(lon);
    out[1] = r * Math.sin(lat);
    out[2] = r * cl * Math.sin(lon);
  }

  function createGeometry() {
    const vertsPerStrand = SEGMENTS * RADIAL;
    const total = vertsPerStrand * STRANDS.length;
    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    const indices = new Uint16Array(STRANDS.length * SEGMENTS * RADIAL * 6);
    let w = 0;
    for (let s = 0; s < STRANDS.length; s++) {
      const base = s * vertsPerStrand;
      for (let i = 0; i < SEGMENTS; i++) {
        const i2 = (i + 1) % SEGMENTS;
        for (let j = 0; j < RADIAL; j++) {
          const j2 = (j + 1) % RADIAL;
          const a = base + i * RADIAL + j, b = base + i * RADIAL + j2;
          const c = base + i2 * RADIAL + j, d = base + i2 * RADIAL + j2;
          indices[w++] = a; indices[w++] = c; indices[w++] = b;
          indices[w++] = b; indices[w++] = c; indices[w++] = d;
        }
      }
    }
    const ringCos = new Float32Array(RADIAL), ringSin = new Float32Array(RADIAL);
    for (let j = 0; j < RADIAL; j++) {
      ringCos[j] = Math.cos((j / RADIAL) * Math.PI * 2);
      ringSin[j] = Math.sin((j / RADIAL) * Math.PI * 2);
    }

    const p = [0, 0, 0], pa = [0, 0, 0], pb = [0, 0, 0];
    const EPS = 1e-3;

    // progress が増えると糸が一本ずつ太る(最初の一本は常に見える)
    function update(tau, progress) {
      let v = 0;
      for (let s = 0; s < STRANDS.length; s++) {
        const grow = Math.max(0, Math.min(1, progress * STRANDS.length - s + 1));
        const tube = TUBE * (s === 0 ? 1 : 0.12 + 0.88 * grow);
        for (let i = 0; i < SEGMENTS; i++) {
          const t = (i / SEGMENTS) * Math.PI * 2;
          strandPoint(s, t, tau, p);
          strandPoint(s, t + EPS, tau, pa);
          strandPoint(s, t - EPS, tau, pb);
          let tx = pa[0] - pb[0], ty = pa[1] - pb[1], tz = pa[2] - pb[2];
          let tl = Math.hypot(tx, ty, tz) || 1;
          tx /= tl; ty /= tl; tz /= tl;
          // 球の法線方向を接線に直交化すると、継ぎ目のない周期的な断面フレームになる
          let rl = Math.hypot(p[0], p[1], p[2]) || 1;
          let nx = p[0] / rl, ny = p[1] / rl, nz = p[2] / rl;
          const d = nx * tx + ny * ty + nz * tz;
          nx -= d * tx; ny -= d * ty; nz -= d * tz;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
          for (let j = 0; j < RADIAL; j++) {
            const rx = ringCos[j] * nx + ringSin[j] * bx;
            const ry = ringCos[j] * ny + ringSin[j] * by;
            const rz = ringCos[j] * nz + ringSin[j] * bz;
            positions[v] = p[0] + tube * rx;
            positions[v + 1] = p[1] + tube * ry;
            positions[v + 2] = p[2] + tube * rz;
            normals[v] = rx;
            normals[v + 1] = ry;
            normals[v + 2] = rz;
            v += 3;
          }
        }
      }
    }

    return { positions, normals, indices, update };
  }

  const VERT_SRC = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat4 uMVP;
    uniform mat4 uModel;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vNormal = mat3(uModel) * aNormal;
      vec4 world = uModel * vec4(aPosition, 1.0);
      vWorldPos = world.xyz;
      gl_Position = uMVP * vec4(aPosition, 1.0);
    }
  `;

  const FRAG_SRC = `
    precision mediump float;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    uniform vec3 uLightDir;
    uniform vec3 uCamPos;
    uniform vec3 uColorLow;
    uniform vec3 uColorHigh;
    uniform float uProgress;
    uniform float uTime;
    void main() {
      vec3 N = normalize(vNormal);
      vec3 L = normalize(uLightDir);
      vec3 V = normalize(uCamPos - vWorldPos);
      vec3 H = normalize(L + V);
      float diff = max(dot(N, L), 0.0);
      float spec = pow(max(dot(N, H), 0.0), 44.0);
      float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.0);

      vec3 baseColor = mix(uColorLow, uColorHigh, uProgress);
      float shimmer = 0.5 + 0.5 * sin(uTime * 0.5 + vWorldPos.x * 2.4 + vWorldPos.y * 1.9 + vWorldPos.z);
      vec3 glowColor = mix(vec3(0.45, 0.66, 1.0), vec3(0.9, 0.52, 1.0), shimmer);

      // 奥の糸ほど沈ませて奥行きを出す
      float depth = clamp(0.62 + 0.38 * vWorldPos.z, 0.25, 1.0);

      vec3 ambient = baseColor * 0.36;
      vec3 diffuse = baseColor * diff * 0.55;
      vec3 specular = vec3(1.0) * spec * (0.3 + 0.6 * uProgress);
      vec3 rim = glowColor * fresnel * (0.3 + 1.1 * uProgress);

      vec3 color = (ambient + diffuse + rim) * depth + specular;
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function compileShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error("shader compile error", gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function init(canvas, options) {
    options = options || {};
    const gl =
      canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: false }) ||
      canvas.getContext("experimental-webgl", { alpha: true, antialias: true });
    if (!gl) return null;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("program link error", gl.getProgramInfoLog(program));
      return null;
    }

    let progress = options.initialProgress || 0;
    let paused = !!options.initialPaused;
    // 起動ごとに違う姿から始める
    let tau = options.initialTau !== undefined ? options.initialTau : Math.random() * 1000;
    let rotY = 0;
    let dirty = true;

    const geo = createGeometry();
    geo.update(tau, progress);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geo.positions, gl.DYNAMIC_DRAW);

    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geo.normals, gl.DYNAMIC_DRAW);

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(program, "aPosition");
    const aNormal = gl.getAttribLocation(program, "aNormal");
    const uMVP = gl.getUniformLocation(program, "uMVP");
    const uModel = gl.getUniformLocation(program, "uModel");
    const uLightDir = gl.getUniformLocation(program, "uLightDir");
    const uCamPos = gl.getUniformLocation(program, "uCamPos");
    const uColorLow = gl.getUniformLocation(program, "uColorLow");
    const uColorHigh = gl.getUniformLocation(program, "uColorHigh");
    const uProgress = gl.getUniformLocation(program, "uProgress");
    const uTime = gl.getUniformLocation(program, "uTime");

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    const camDist = 4.4;
    let lastTs = null;
    let rafId = null;
    let destroyed = false;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const targetW = Math.max(1, Math.round(w * dpr));
      const targetH = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function render() {
      resize();
      if (dirty) {
        geo.update(tau, progress);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, geo.positions);
        gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, geo.normals);
        dirty = false;
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const aspect = canvas.width / canvas.height || 1;
      const proj = m4perspective((40 * Math.PI) / 180, aspect, 0.1, 100);
      const view = m4translate(0, 0, -camDist);
      const rotX = 0.35 + 0.15 * Math.sin(tau * 0.11);
      const model = m4multiply(m4rotateX(rotX), m4rotateY(rotY));
      const mvp = m4multiply(m4multiply(proj, view), model);

      gl.useProgram(program);

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.enableVertexAttribArray(aPosition);
      gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
      gl.enableVertexAttribArray(aNormal);
      gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);

      gl.uniformMatrix4fv(uMVP, false, mvp);
      gl.uniformMatrix4fv(uModel, false, model);
      gl.uniform3f(uLightDir, 0.4, 0.85, 0.6);
      gl.uniform3f(uCamPos, 0, 0, camDist);
      gl.uniform3f(uColorLow, 0.5, 0.52, 0.58);
      gl.uniform3f(uColorHigh, 0.74, 0.7, 0.98);
      gl.uniform1f(uProgress, progress);
      gl.uniform1f(uTime, tau);

      gl.drawElements(gl.TRIANGLES, geo.indices.length, gl.UNSIGNED_SHORT, 0);
    }

    function frame(ts) {
      if (destroyed) return;
      if (lastTs === null) lastTs = ts;
      const dt = Math.min((ts - lastTs) / 1000, 0.1);
      lastTs = ts;
      if (!paused && !document.hidden) {
        tau += dt;
        rotY += dt * 0.12;
        dirty = true;
      }
      render();
      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);

    return {
      setProgress(p) {
        progress = Math.max(0, Math.min(1, p));
        dirty = true;
      },
      setPaused(v) {
        paused = !!v;
      },
      isPaused() {
        return paused;
      },
      destroy() {
        destroyed = true;
        if (rafId) cancelAnimationFrame(rafId);
        window.removeEventListener("resize", resize);
      },
    };
  }

  return { init };
})();
