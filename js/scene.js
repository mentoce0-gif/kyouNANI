/* たした — 「私のあゆみ」ヒーロービジュアル(素のWebGL、外部ライブラリ不使用) */
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

  /* ---- 三葉結び目(トーラスノット)のチューブ形状を生成 ---- */
  function buildKnotGeometry(opts) {
    opts = opts || {};
    const segments = opts.segments || 220;
    const radialSegments = opts.radialSegments || 20;
    const tubeRadius = opts.tubeRadius || 0.32;
    const scale = opts.scale || 0.42;

    function centerline(t, out) {
      out[0] = Math.sin(t) + 2 * Math.sin(2 * t);
      out[1] = Math.cos(t) - 2 * Math.cos(2 * t);
      out[2] = -Math.sin(3 * t);
      out[0] *= scale;
      out[1] *= scale;
      out[2] *= scale;
    }

    const centers = [];
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const p = [0, 0, 0];
      centerline(t, p);
      centers.push(p);
    }

    const normalsN = [];
    const binormals = [];
    const EPS = 1e-4;
    let prevN = [0, 1, 0];
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const p1 = centers[i];
      const p2 = [0, 0, 0];
      centerline(t + EPS, p2);
      const tangent = normalize(sub(p2, p1));
      let n;
      if (i === 0) {
        let up = [0, 1, 0];
        if (Math.abs(dot(up, tangent)) > 0.99) up = [1, 0, 0];
        n = normalize(cross(up, tangent));
      } else {
        const b_prev = normalize(cross(tangent, prevN));
        n = normalize(cross(b_prev, tangent));
      }
      const b = normalize(cross(tangent, n));
      normalsN.push(n);
      binormals.push(b);
      prevN = n;
    }

    const positions = [];
    const normals = [];
    for (let i = 0; i < segments; i++) {
      const c = centers[i];
      const n = normalsN[i];
      const b = binormals[i];
      for (let j = 0; j < radialSegments; j++) {
        const angle = (j / radialSegments) * Math.PI * 2;
        const ca = Math.cos(angle), sa = Math.sin(angle);
        const rx = ca * n[0] + sa * b[0];
        const ry = ca * n[1] + sa * b[1];
        const rz = ca * n[2] + sa * b[2];
        positions.push(c[0] + tubeRadius * rx, c[1] + tubeRadius * ry, c[2] + tubeRadius * rz);
        normals.push(rx, ry, rz);
      }
    }

    const indices = [];
    for (let i = 0; i < segments; i++) {
      const iNext = (i + 1) % segments;
      for (let j = 0; j < radialSegments; j++) {
        const jNext = (j + 1) % radialSegments;
        const a = i * radialSegments + j;
        const b2 = i * radialSegments + jNext;
        const c2 = iNext * radialSegments + j;
        const d = iNext * radialSegments + jNext;
        indices.push(a, c2, b2, b2, c2, d);
      }
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint16Array(indices),
    };
  }

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function normalize(v) {
    const len = Math.sqrt(dot(v, v)) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
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
      float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.4);

      vec3 baseColor = mix(uColorLow, uColorHigh, uProgress);
      float shimmer = 0.5 + 0.5 * sin(uTime * 0.6 + vWorldPos.x * 2.2 + vWorldPos.y * 1.8);
      vec3 glowColor = mix(vec3(0.45, 0.62, 1.0), vec3(0.82, 0.5, 1.0), shimmer);

      vec3 ambient = baseColor * 0.38;
      vec3 diffuse = baseColor * diff * 0.6;
      vec3 specular = vec3(1.0) * spec * (0.25 + 0.55 * uProgress);
      vec3 rim = glowColor * fresnel * (0.2 + 0.95 * uProgress);

      vec3 color = ambient + diffuse + specular + rim;
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

    const geo = buildKnotGeometry({});
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geo.positions, gl.STATIC_DRAW);

    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geo.normals, gl.STATIC_DRAW);

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
    let progress = options.initialProgress || 0;
    let paused = !!options.initialPaused;
    let rotY = 0;
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

    function render(timeSec) {
      resize();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const aspect = canvas.width / canvas.height || 1;
      const proj = m4perspective((40 * Math.PI) / 180, aspect, 0.1, 100);
      const view = m4translate(0, 0, -camDist);
      const rotX = 0.18 * Math.sin(timeSec * 0.18);
      const model = m4multiply(m4rotateY(rotY), m4rotateX(rotX));
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
      gl.uniform3f(uColorLow, 0.5, 0.52, 0.56);
      gl.uniform3f(uColorHigh, 0.72, 0.68, 0.95);
      gl.uniform1f(uProgress, progress);
      gl.uniform1f(uTime, timeSec);

      gl.drawElements(gl.TRIANGLES, geo.indices.length, gl.UNSIGNED_SHORT, 0);
    }

    function frame(ts) {
      if (destroyed) return;
      const timeSec = ts / 1000;
      if (lastTs === null) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      if (!paused && !document.hidden) rotY += dt * 0.28;
      render(timeSec);
      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);

    return {
      setProgress(p) {
        progress = Math.max(0, Math.min(1, p));
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
