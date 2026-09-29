/* Habitació amb vistes — materials amb llum esglaonada, constructor de geometria i pipeline pixel-art */
(function () {
  'use strict';
  const { GLSL, clamp } = LOFI;

  // Uniforms compartits per tots els materials
  const U = (LOFI.U = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(480, 270) },
    uLightSteps: { value: 3.0 },
    uDither: { value: 0.4 },
    uWetness: { value: 0 },
  });

  // ---------------------------------------------------------------------------
  // Material toon: Lambert amb la llum quantitzada en esglaons (amb tramat Bayer)
  // i textures procedurals en espai de món (fusta, parquet, guix, punt de llana)
  // ---------------------------------------------------------------------------
  const PATTERN_GLSL = /* glsl */`
    varying vec3 vLofiWorld;
    varying float vLofiPat;
    uniform float uLightSteps;
    uniform float uDither;
    uniform float uTime;
    ${GLSL.bayer}
    ${GLSL.noise}
    vec3 lofiPattern(vec3 a, float pat, vec3 p, vec3 n) {
      if (pat < 0.5) return a;
      if (pat < 1.5) {            // 1: fusta (veta al llarg de x)
        float g = vnoise(vec2(p.x * 3.0, (p.z + p.y) * 55.0));
        float g2 = vnoise(vec2(p.x * 0.7, (p.z + p.y) * 9.0));
        return a * (0.93 + 0.1 * step(0.62, g) + 0.06 * g2 - 0.05 * step(0.8, g2));
      }
      if (pat < 2.5) {            // 2: parquet (taulons al llarg de x)
        float w = 0.16; float row = floor(p.z / w);
        float off = h12(vec2(row, 3.1)) * 2.0;
        float col = floor((p.x + off) / 1.2);
        float tint = h12(vec2(row, col));
        float fz = fract(p.z / w), fx = fract((p.x + off) / 1.2);
        float seam = step(fz, 0.07) + step(fx, 0.012);
        float grain = vnoise(vec2(p.x * 4.0, p.z * 70.0));
        return a * (0.88 + 0.16 * tint + 0.06 * step(0.6, grain)) * (1.0 - 0.28 * clamp(seam, 0.0, 1.0));
      }
      if (pat < 3.5) {            // 3: guix (taques subtils)
        float s = vnoise(p.xy * 7.0 + p.z * 5.0) * 0.6 + vnoise(p.xy * 23.0 + p.z * 17.0) * 0.4;
        return a * (0.965 + 0.06 * s);
      }
      if (pat < 4.5) {            // 4: punt de llana (costelles verticals)
        vec3 q = p * 90.0;
        float rib = step(0.5, fract(q.x + q.z * 0.5 + step(0.5, fract(q.y * 0.5)) * 0.25));
        return a * (0.94 + 0.08 * rib);
      }
      if (pat < 5.5) {            // 5: fulla (nervi central + clapes)
        float s = vnoise(p.xy * 40.0 + p.z * 30.0);
        return a * (0.9 + 0.18 * step(0.66, s));
      }
      if (pat < 6.5) {            // 6: catifa (ratlles de colors càlids)
        float r = fract(p.z * 1.6 + 0.2 * step(0.5, fract(p.x * 6.0)));
        vec3 c = r < 0.14 ? vec3(0.95, 0.9, 0.82) : (r < 0.2 ? vec3(0.62, 0.36, 0.34) : a);
        float fringe = step(0.5, fract(p.x * 40.0));
        return c * (0.95 + 0.06 * fringe);
      }
      if (pat > 7.5 && pat < 8.5) { // 8: gat atigrat (ratlles)
        float st = fract(p.x * 17.0 + sin(p.z * 26.0 + p.y * 9.0) * 0.35);
        return a * (1.0 - 0.2 * step(0.6, st));
      }
      if (pat < 7.5) {            // 7: terracota (petites taques)
        float s = h12(floor(p.xy * 90.0) + floor(p.z * 90.0));
        return a * (0.95 + 0.08 * step(0.85, s));
      }
      return a;
    }
    vec3 lofiStep(vec3 albedo, vec3 direct, vec3 indirect, vec3 emissive) {
      vec3 a = max(albedo, vec3(0.004));
      vec3 L = (direct + indirect) / a;
      float m = max(max(L.r, L.g), L.b);
      if (m < 1e-4) return emissive;
      float d = (bayer4(gl_FragCoord.xy) - 0.5) * uDither;
      float lq = exp2(floor(log2(m) * uLightSteps + 0.5 + d) / uLightSteps);
      return a * L * (lq / m) + emissive;
    }
  `;

  function patchToon(material, opts = {}) {
    material.onBeforeCompile = (sh) => {
      sh.uniforms.uLightSteps = U.uLightSteps;
      sh.uniforms.uDither = U.uDither;
      sh.uniforms.uTime = U.uTime;
      if (opts.uniforms) Object.assign(sh.uniforms, opts.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLofiWorld;\nvarying float vLofiPat;\nattribute float aPat;\n' + (opts.vertexHead || ''))
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          {
            vec4 lw = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              lw = instanceMatrix * lw;
            #endif
            vLofiWorld = (modelMatrix * lw).xyz;
            vLofiPat = aPat;
          }
          ${opts.vertexTail || ''}`);
      if (opts.vertexTransform) sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + opts.vertexTransform);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + PATTERN_GLSL + (opts.fragmentHead || ''))
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = lofiPattern(diffuseColor.rgb, vLofiPat, vLofiWorld, vNormal);\n' + (opts.fragmentColor || ''))
        .replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
          'vec3 outgoingLight = lofiStep(diffuseColor.rgb, reflectedLight.directDiffuse, reflectedLight.indirectDiffuse, totalEmissiveRadiance);\n' + (opts.fragmentTail || ''));
    };
    const key = 'lofi-toon:' + (opts.key || '');
    material.customProgramCacheKey = () => key;
    return material;
  }

  function toonMat(opts = {}) {
    const m = new THREE.MeshLambertMaterial({
      color: opts.color !== undefined ? opts.color : 0xffffff,
      vertexColors: opts.vertexColors !== undefined ? opts.vertexColors : true,
      emissive: opts.emissive !== undefined ? opts.emissive : 0x000000,
      side: opts.side || THREE.FrontSide,
      transparent: !!opts.transparent,
      opacity: opts.opacity !== undefined ? opts.opacity : 1,
      depthWrite: opts.depthWrite !== undefined ? opts.depthWrite : true,
    });
    return patchToon(m, opts);
  }

  // ---------------------------------------------------------------------------
  // Constructor de geometria: fusiona primitives amb color per vèrtex i patró
  // ---------------------------------------------------------------------------
  const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
  const _c = new THREE.Color();
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

  function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  }

  class Geo {
    constructor() { this.pos = []; this.nor = []; this.col = []; this.pat = []; }
    // color: THREE.Color | hex | string | function(worldPos, worldNormal, out)
    add(geometry, color, matrix, pat = 0) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      if (!g.attributes.normal) g.computeVertexNormals();
      const P = g.attributes.position, N = g.attributes.normal;
      const mat = matrix || new THREE.Matrix4();
      _m3.getNormalMatrix(mat);
      const flip = mat.determinant() < 0;
      const fn = typeof color === 'function' ? color : null;
      if (!fn) _c.set(color);
      const n = P.count;
      for (let i = 0; i < n; i++) {
        const j = flip ? (i - (i % 3)) + (2 - (i % 3)) : i;
        _v.fromBufferAttribute(P, j).applyMatrix4(mat);
        _n.fromBufferAttribute(N, j).applyMatrix3(_m3).normalize();
        this.pos.push(_v.x, _v.y, _v.z);
        this.nor.push(_n.x, _n.y, _n.z);
        if (fn) fn(_v, _n, _c);
        this.col.push(_c.r, _c.g, _c.b);
        this.pat.push(pat);
      }
      if (g !== geometry) g.dispose();
      geometry.dispose();
      return this;
    }
    box(w, h, d, color, mat, pat) { return this.add(new THREE.BoxGeometry(w, h, d), color, mat, pat); }
    // fusiona un altre constructor (amb els seus colors i patrons) aplicant una matriu
    merge(other, mat) {
      _m3.getNormalMatrix(mat);
      for (let i = 0; i < other.pos.length; i += 3) {
        _v.set(other.pos[i], other.pos[i + 1], other.pos[i + 2]).applyMatrix4(mat);
        _n.set(other.nor[i], other.nor[i + 1], other.nor[i + 2]).applyMatrix3(_m3).normalize();
        this.pos.push(_v.x, _v.y, _v.z);
        this.nor.push(_n.x, _n.y, _n.z);
      }
      this.col.push(...other.col);
      this.pat.push(...other.pat);
      return this;
    }
    get count() { return this.pos.length / 3; }
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      g.setAttribute('aPat', new THREE.Float32BufferAttribute(this.pat, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return g;
    }
    mesh(material, opts = {}) {
      const m = new THREE.Mesh(this.build(), material);
      m.castShadow = opts.cast !== undefined ? opts.cast : true;
      m.receiveShadow = opts.receive !== undefined ? opts.receive : true;
      return m;
    }
  }

  // Afegeix l'atribut aPat a una geometria solta (per a malles animades)
  function withPat(geo, pat = 0) {
    const n = geo.attributes.position.count;
    geo.setAttribute('aPat', new THREE.Float32BufferAttribute(new Float32Array(n).fill(pat), 1));
    return geo;
  }

  // ---------------------------------------------------------------------------
  // Pipeline: exterior → interior (+normals) → brillantor → post (contorns, bloom, gra)
  // ---------------------------------------------------------------------------
  const FS_VERT = /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  const POST_FRAG = /* glsl */`
    #include <packing>
    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform sampler2D tNormal;
    uniform sampler2D tBloom;
    uniform vec2 uRes;
    uniform float uNear, uFar;
    uniform float uOutline, uHighlight, uBloom, uVignette, uGrain, uTime, uFade, uSat;
    uniform vec3 uLift, uGain;
    varying vec2 vUv;
    ${GLSL.bayer}
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vz(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
    vec3 nrm(vec2 uv){ return normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0); }
    void main(){
      vec2 px = 1.0 / uRes;
      vec3 c = texture2D(tColor, vUv).rgb;
      float z = vz(vUv);
      vec3 n = nrm(vUv);
      float nv = max(abs(n.z), 0.2);
      float thr = 0.012 + 0.018 * z / nv;
      float dSum = 0.0, nSum = 0.0;
      vec2 off[4];
      off[0] = vec2(px.x, 0.0); off[1] = vec2(-px.x, 0.0); off[2] = vec2(0.0, px.y); off[3] = vec2(0.0, -px.y);
      for (int i = 0; i < 4; i++) {
        vec2 uv2 = vUv + off[i];
        float zi = vz(uv2);
        float dd = zi - z;
        dSum += step(thr, dd);
        vec3 ni = nrm(uv2);
        float convex = smoothstep(-0.01, 0.01, dot(n - ni, vec3(-0.6, 0.8, 0.3)));
        float notCloser = step(-0.02 * z, dd);
        nSum += (1.0 - dot(n, ni)) * convex * notCloser;
      }
      float dEdge = step(0.5, dSum);
      float nEdge = step(0.32, nSum) * (1.0 - dEdge);
      vec3 outl = c * vec3(0.52, 0.47, 0.62);
      c = mix(c, outl, dEdge * uOutline);
      c *= 1.0 + nEdge * uHighlight;

      // resplendor
      vec3 b = texture2D(tBloom, vUv).rgb;
      c += b * uBloom;

      // gradació suau (ombres cap al violeta, llums càlides)
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, uSat);
      c = c * uGain + uLift * (1.0 - clamp(l * 1.6, 0.0, 1.0));

      // vinyeta esglaonada
      vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
      float v = smoothstep(0.35, 1.05, length(q * vec2(0.82, 1.0)));
      float bay = bayer4(gl_FragCoord.xy);
      v = floor(v * 6.0 + bay) / 6.0;
      c *= 1.0 - uVignette * v;

      // gra
      c += (h12(gl_FragCoord.xy + fract(uTime * 7.13) * 91.7) - 0.5) * uGrain;
      c *= uFade;
      // tramat final a 6 bits per canal per a un acabat retro
      c = floor(c * 63.0 + bay) / 63.0;
      gl_FragColor = vec4(c, 1.0);
    }
  `;

  const BRIGHT_FRAG = /* glsl */`
    uniform sampler2D tColor;
    uniform float uThreshold;
    uniform vec2 uTexel;
    varying vec2 vUv;
    void main(){
      vec3 s = vec3(0.0);
      s += texture2D(tColor, vUv + vec2(-0.25, -0.25) * uTexel).rgb;
      s += texture2D(tColor, vUv + vec2( 0.25, -0.25) * uTexel).rgb;
      s += texture2D(tColor, vUv + vec2(-0.25,  0.25) * uTexel).rgb;
      s += texture2D(tColor, vUv + vec2( 0.25,  0.25) * uTexel).rgb;
      s *= 0.25;
      float l = max(max(s.r, s.g), s.b);
      float k = smoothstep(uThreshold, uThreshold + 0.25, l);
      gl_FragColor = vec4(s * k, 1.0);
    }
  `;

  const BLUR_FRAG = /* glsl */`
    uniform sampler2D tColor;
    uniform vec2 uDir;
    varying vec2 vUv;
    void main(){
      vec3 s = texture2D(tColor, vUv).rgb * 0.2270270270;
      s += texture2D(tColor, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
      s += texture2D(tColor, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
      s += texture2D(tColor, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
      s += texture2D(tColor, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
      gl_FragColor = vec4(s, 1.0);
    }
  `;

  class Pipeline {
    constructor(canvas) {
      const r = (this.renderer = new THREE.WebGLRenderer({
        canvas, antialias: false, alpha: false, depth: true, stencil: false,
        powerPreference: 'default', premultipliedAlpha: false, preserveDrawingBuffer: false,
      }));
      r.setPixelRatio(1);
      r.outputColorSpace = THREE.LinearSRGBColorSpace;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.BasicShadowMap;
      r.shadowMap.autoUpdate = false;
      r.autoClear = false;
      r.setClearColor(0x000000, 1);

      this.w = 0; this.h = 0;
      this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.fsGeo = new THREE.PlaneGeometry(2, 2);
      const fs = (frag, uniforms) => {
        const m = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
        const mesh = new THREE.Mesh(this.fsGeo, m);
        mesh.frustumCulled = false;
        const scene = new THREE.Scene(); scene.add(mesh);
        return { m, scene };
      };
      this.post = fs(POST_FRAG, {
        tColor: { value: null }, tDepth: { value: null }, tNormal: { value: null }, tBloom: { value: null },
        uRes: U.uRes, uNear: { value: 0.05 }, uFar: { value: 60 },
        uOutline: { value: 1 }, uHighlight: { value: 0.18 }, uBloom: { value: 0.55 }, uVignette: { value: 0.22 },
        uGrain: { value: 0.018 }, uTime: U.uTime, uFade: { value: 1 }, uSat: { value: 1.04 },
        uLift: { value: new THREE.Vector3(0.018, 0.008, 0.035) }, uGain: { value: new THREE.Vector3(1.0, 0.99, 0.985) },
      });
      this.bright = fs(BRIGHT_FRAG, { tColor: { value: null }, uThreshold: { value: 0.82 }, uTexel: { value: new THREE.Vector2() } });
      this.blur = fs(BLUR_FRAG, { tColor: { value: null }, uDir: { value: new THREE.Vector2() } });
      this.normalMat = new THREE.MeshNormalMaterial();
      this.normalCam = null;
      this.opts = { outlines: true, bloom: true, grain: true };
    }

    makeRT(w, h, linear, depthTex) {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        minFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
        magFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
        depthBuffer: !linear, stencilBuffer: false, generateMipmaps: false,
      });
      if (depthTex) {
        rt.depthTexture = new THREE.DepthTexture(w, h);
        rt.depthTexture.type = THREE.UnsignedIntType;
        rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
      }
      return rt;
    }

    setSize(w, h) {
      if (w === this.w && h === this.h) return;
      this.w = w; this.h = h;
      this.renderer.setSize(w, h, false);
      for (const k of ['rtOut', 'rtMain', 'rtNorm', 'rtB1', 'rtB2']) if (this[k]) this[k].dispose();
      this.rtOut = this.makeRT(w, h, false, false);
      this.rtMain = this.makeRT(w, h, false, true);
      this.rtNorm = this.makeRT(w, h, false, false);
      const bw = Math.max(2, Math.round(w / 3)), bh = Math.max(2, Math.round(h / 3));
      this.rtB1 = this.makeRT(bw, bh, true, false);
      this.rtB2 = this.makeRT(bw, bh, true, false);
      U.uRes.value.set(w, h);
    }

    render(world) {
      const r = this.renderer;
      const { outScene, outCam, roomScene, cam } = world;
      // 1) exterior
      r.setRenderTarget(this.rtOut);
      r.setClearColor(0x000000, 1);
      r.clear(true, true, false);
      r.render(outScene, outCam);
      // 2) interior (actualitza les ombres només aquí)
      r.shadowMap.needsUpdate = true;
      r.setRenderTarget(this.rtMain);
      r.clear(true, true, false);
      r.render(roomScene, cam);
      // 3) normals per als contorns
      if (this.opts.outlines) {
        if (!this.normalCam) { this.normalCam = cam.clone(); }
        this.normalCam.copy(cam);
        this.normalCam.layers.set(0);
        const bg = roomScene.background; roomScene.background = null;
        roomScene.overrideMaterial = this.normalMat;
        r.setRenderTarget(this.rtNorm);
        r.setClearColor(0x8080ff, 1);
        r.clear(true, true, false);
        r.render(roomScene, this.normalCam);
        roomScene.overrideMaterial = null;
        roomScene.background = bg;
        r.setClearColor(0x000000, 1);
      }
      // 4) resplendor
      if (this.opts.bloom) {
        this.bright.m.uniforms.tColor.value = this.rtMain.texture;
        this.bright.m.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
        r.setRenderTarget(this.rtB1); r.render(this.bright.scene, this.fsCam);
        const bu = this.blur.m.uniforms;
        for (let i = 0; i < 2; i++) {
          bu.tColor.value = this.rtB1.texture; bu.uDir.value.set((1 + i) / this.rtB1.width, 0);
          r.setRenderTarget(this.rtB2); r.render(this.blur.scene, this.fsCam);
          bu.tColor.value = this.rtB2.texture; bu.uDir.value.set(0, (1 + i) / this.rtB1.height);
          r.setRenderTarget(this.rtB1); r.render(this.blur.scene, this.fsCam);
        }
      }
      // 5) post a la pantalla
      const pu = this.post.m.uniforms;
      pu.tColor.value = this.rtMain.texture;
      pu.tDepth.value = this.rtMain.depthTexture;
      pu.tNormal.value = this.rtNorm.texture;
      pu.tBloom.value = this.rtB1.texture;
      pu.uNear.value = cam.near; pu.uFar.value = cam.far;
      pu.uOutline.value = this.opts.outlines ? 1 : 0;
      pu.uHighlight.value = this.opts.outlines ? 0.16 : 0;
      pu.uBloom.value = this.opts.bloom ? world.bloom || 0.5 : 0;
      pu.uGrain.value = this.opts.grain ? 0.02 : 0;
      r.setRenderTarget(null);
      r.clear(true, true, false);
      r.render(this.post.scene, this.fsCam);
    }
  }

  Object.assign(LOFI, { patchToon, toonMat, Geo, M, withPat, Pipeline });
})();
