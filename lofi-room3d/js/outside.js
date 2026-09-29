/* Habitació amb vistes — l'exterior: cel, núvols, sol, lluna, mar, ciutat, far, vaixells, pluja i llamps */
(function () {
  'use strict';
  const { GLSL, clamp, lerp, smooth, RNG, U, DEG, M, Geo, toonMat } = LOFI;

  const SEA_Y = -46;          // nivell del mar (coordenades de l'habitació)
  const GROUND_Y = -44;       // nivell del carrer
  LOFI.SEA_Y = SEA_Y;
  // parc central (franja verda entre les illes de cases, fins a la platja)
  const PARK = { hw: 46, z0: -48, z1: -468, fountain: -262, play: { x: -12, z: -332 }, kite: { x: 15, z: -372 } };

  // ---------------------------------------------------------------------------
  // Cúpula del cel + mar (tot en un shader, a resolució de píxel)
  // ---------------------------------------------------------------------------
  const SKY_VERT = /* glsl */`
    varying vec3 vDir;
    void main(){
      vDir = position;
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;
    }
  `;
  const SKY_FRAG = /* glsl */`
    uniform vec3 uTop, uMid, uHor, uGlow, uSun, uCloudLit, uCloudShade, uCloudRim, uSeaHi, uSeaLo, uFog;
    uniform float uGlowI, uSunI, uCover, uOver, uTime, uStars, uMoonI, uMoonPhase, uRain, uFlash, uCity, uCamH, uPixAng;
    uniform vec3 uSunDir, uMoonDir;
    uniform vec2 uWind;
    uniform vec4 uMeteor;
    uniform float uMeteorT;
    varying vec3 vDir;
    ${GLSL.bayer}
    ${GLSL.noise}
    const float PI = 3.14159265;
    float angDiff(float a, float b){ return mod(a - b + PI, 2.0 * PI) - PI; }

    vec3 skyGrad(float el, float bay){
      float h = pow(clamp(el / 0.38, 0.0, 1.0), 0.72);
      float hb = floor(h * 15.0 + bay) / 15.0;
      return hb < 0.5 ? mix(uHor, uMid, hb * 2.0) : mix(uMid, uTop, hb * 2.0 - 1.0);
    }

    void main(){
      vec3 d = normalize(vDir);
      float bay = bayer4(gl_FragCoord.xy);
      float az = atan(d.x, -d.z);
      float el = asin(clamp(d.y, -1.0, 1.0));
      float sAz = atan(uSunDir.x, -uSunDir.z);
      float mAz = atan(uMoonDir.x, -uMoonDir.z);
      float sunLow = 1.0 - smoothstep(0.0, 0.5, abs(uSunDir.y + 0.04));
      vec3 c;
      if (el >= 0.0) {
        c = skyGrad(el, bay);
        // resplendor de l'horitzó cap al sol
        float dA = angDiff(az, sAz);
        float g = exp(-dA * dA * 1.8) * exp(-el * 6.0) * sunLow;
        float sd = max(dot(d, uSunDir), 0.0);
        float halo = pow(sd, 400.0) * 0.9 + pow(sd, 40.0) * 0.4 + pow(sd, 8.0) * 0.12;
        float gl = clamp((g * 0.8 + halo * (0.3 + 0.55 * sunLow)) * uGlowI * (1.0 - 0.6 * uOver), 0.0, 1.0);
        gl = floor(gl * 8.0 + bay) / 8.0;
        c = mix(c, uGlow, gl);
        // resplendor suau de la lluna
        float md = max(dot(d, uMoonDir), 0.0);
        float mg = (pow(md, 900.0) * 0.5 + pow(md, 60.0) * 0.18) * uMoonI * (1.0 - 0.7 * uOver);
        mg = floor(mg * 6.0 + bay) / 6.0;
        c = mix(c, vec3(0.62, 0.66, 0.9), mg);

        // estrelles
        if (uStars > 0.01) {
          float cs = 7.0;
          vec2 sp = vec2(az, el) / (uPixAng * cs);
          vec2 cell = floor(sp);
          float r = h12(cell + 17.0);
          if (r > 0.62) {
            vec2 off = vec2(h12(cell + 3.1), h12(cell + 7.7)) * 0.56 + 0.22;
            vec2 dp = (sp - cell - off) * cs;
            float br = h12(cell + 11.3);
            float tw = 0.6 + 0.4 * sin(uTime * (1.3 + br * 3.1) + r * 40.0);
            float a = 0.0;
            if (abs(dp.x) < 0.5 && abs(dp.y) < 0.5) a = 0.35 + 0.65 * br;
            else if (br > 0.9 && ((abs(dp.x) < 1.5 && abs(dp.y) < 0.5) || (abs(dp.y) < 1.5 && abs(dp.x) < 0.5))) a = 0.4;
            a *= tw * uStars * smoothstep(0.004, 0.06, el);
            vec3 sc = mix(vec3(1.0, 0.93, 0.8), vec3(0.8, 0.88, 1.0), h12(cell + 5.5));
            c = mix(c, sc, clamp(a, 0.0, 1.0));
          }
          // estel fugaç
          if (uMeteorT >= 0.0) {
            vec2 a0 = uMeteor.xy, a1 = uMeteor.zw;
            vec2 head = mix(a0, a1, uMeteorT);
            vec2 tail = mix(a0, a1, max(uMeteorT - 0.35, 0.0));
            vec2 pp = vec2(az, el);
            vec2 ab = head - tail; float L = length(ab);
            if (L > 1e-5) {
              float t = clamp(dot(pp - tail, ab) / (L * L), 0.0, 1.0);
              float dist = length(pp - (tail + ab * t)) / uPixAng;
              float a = step(dist, 0.6) * t * (1.0 - smoothstep(0.85, 1.0, uMeteorT));
              c = mix(c, vec3(1.0, 0.97, 0.9), a * uStars);
            }
          }
        }

        // disc del sol (més gran a prop de l'horitzó)
        float sr = 0.021 * (1.0 + 0.22 * sunLow);
        float sang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
        if (sang < sr && uSunI > 0.0) {
          float rr = sang / sr;
          vec3 sc = mix(uSun, mix(uGlow, uSun, 0.55), step(0.72, rr));
          // franges horitzontals quan és baix
          float band = step(0.5, fract((el - uSunDir.y) / (uPixAng * 3.0))) * step(uSunDir.y, 0.05) * step(0.0, uSunDir.y - el + 0.01);
          sc = mix(sc, uGlow, band * 0.5 * sunLow);
          c = mix(c, sc, uSunI);
        }

        // franges d'estrats a prop de l'horitzó (postes precioses)
        {
          float tS = 900.0 / max(d.y, 0.01);
          vec2 ps = d.xz * tS / 2600.0 + uWind * 0.6;
          float ns = fbm3(vec2(ps.x * 0.35, ps.y * 3.5));
          float band = smoothstep(0.52 - 0.12 * uCover, 0.6, ns) * (1.0 - smoothstep(0.03, 0.16, el));
          float bq = step(bay * 0.8 + 0.1, band);
          vec3 sc = mix(uCloudShade, mix(uCloudLit, uGlow, 0.35 * sunLow), 0.35 + 0.4 * smoothstep(0.0, 0.1, el));
          float nearSun = exp(-dA * dA * 3.0) * sunLow;
          sc = mix(sc, uCloudRim, nearSun * 0.6);
          c = mix(c, sc, bq * 0.85);
        }

        // lluna
        float mr = 0.0165;
        if (dot(d, uMoonDir) > cos(mr * 1.2)) {
          vec3 mR = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
          vec3 mU = cross(mR, uMoonDir);
          vec2 q = vec2(dot(d, mR), dot(d, mU)) / mr;
          q = floor(q * 7.0 + 0.5) / 7.0;
          float qq = dot(q, q);
          if (qq < 1.0) {
            float s = sqrt(max(1.0 - q.y * q.y, 0.0));
            float k = cos(6.2831853 * uMoonPhase);
            bool lit = uMoonPhase < 0.5 ? (q.x > s * k) : (q.x < -s * k);
            vec3 mc = lit ? vec3(0.97, 0.95, 0.86) : vec3(0.2, 0.22, 0.36);
            float m = vnoise(q * 2.2 + 3.7);
            if (lit) mc *= 0.84 + 0.16 * step(m, 0.52);
            if (lit && qq > 0.7) mc *= 0.93;
            c = mix(c, mc, clamp(uMoonI * 1.4, 0.0, 1.0) * (lit ? 1.0 : 0.35));
          }
        }

        // núvols (capa de cúmuls en un pla, amb llum cap al sol)
        {
          float tC = 1900.0 / max(d.y, 0.006);
          vec2 p = d.xz * tC / 3400.0 + uWind;
          p.y *= 1.7;
          float n = fbm(p);
          float cov = mix(0.73, 0.26, max(uOver, (uCover - 0.4) * 0.45));
          float dens = (n - cov) / (1.0 - cov);
          if (dens > 0.0) {
            vec3 ld = uSunI > 0.02 || uSunDir.y > -0.2 ? uSunDir : uMoonDir;
            vec2 sd2 = normalize(ld.xz + vec2(1e-4)) * 0.07;
            sd2.y *= 1.7;
            float n2 = fbm(p + sd2);
            float lit = clamp(0.5 + (n - n2) * 7.0, 0.0, 1.0);
            float thick = smoothstep(0.05, 0.7, dens);
            float shade = lit * (1.0 - 0.45 * thick) + 0.2 * (1.0 - thick);
            shade = clamp(shade + (ld.y < 0.08 ? 0.12 * sunLow : 0.0), 0.0, 1.0);
            float sq = floor(shade * 3.0 + bay * 0.999) / 3.0;
            vec3 cc = mix(uCloudShade, uCloudLit, sq);
            float nearL = pow(max(dot(d, ld), 0.0), 24.0);
            float rim = (1.0 - smoothstep(0.0, 0.12, dens)) * nearL;
            cc = mix(cc, uCloudRim, clamp(rim * 2.5, 0.0, 1.0) * max(uSunI, uMoonI * 0.5));
            cc = mix(cc, uCloudRim * 1.05, clamp(nearL * 0.35 * uSunI * sunLow, 0.0, 1.0));
            // llum de ciutat a sota dels núvols de nit
            cc += vec3(0.1, 0.06, 0.04) * uCity * uOver * (1.0 - smoothstep(0.0, 0.2, el));
            float fade = smoothstep(0.0, 0.045, el);
            float a = step(bay * 0.6 + 0.06, dens * 3.0) * fade;
            cc = mix(uHor, cc, 0.35 + 0.65 * fade);
            c = mix(c, cc, a);
          }
        }
        c = mix(c, uFog, uRain * 0.35 * (1.0 - smoothstep(0.0, 0.3, el)));
      } else {
        // --- el mar ---
        float ny = -d.y;
        float t = uCamH / max(ny, 1e-4);
        float f = pow(clamp(1.0 - ny / 0.16, 0.0, 1.0), 3.0);
        float fb = floor(f * 10.0 + bay) / 10.0;
        c = mix(uSeaLo, uSeaHi, fb);
        float row = floor(el / uPixAng);
        float colx = az / uPixAng;
        float prox = clamp(ny / 0.12, 0.0, 1.0);
        float dashLen = 2.0 + 9.0 * prox;
        float rs = h11(row * 1.37);
        float drift = uTime * (0.6 + 1.4 * rs) * (rs > 0.5 ? 1.0 : -1.0);
        float tick = floor(uTime * (0.35 + 0.5 * rs) + rs * 10.0);
        float wn = h12(vec2(floor((colx + drift) / dashLen), row + tick * 57.0));
        if (wn > 0.88) c = mix(c, uSeaHi * 1.12 + 0.04, 0.5);
        else if (wn < 0.1) c *= 0.9;
        // camí de llum del sol
        float dS = angDiff(az, sAz);
        float w = 0.01 + 0.55 * ny;
        float path = exp(-(dS * dS) / (w * w));
        float sunSee = smoothstep(-0.03, 0.02, uSunDir.y) * (1.0 - smoothstep(0.2, 0.75, uSunDir.y)) * (1.0 - 0.9 * uOver);
        float gtick = floor(uTime * 5.0 + h11(row) * 5.0);
        float gl = h12(vec2(floor((colx + drift * 0.5) / (1.0 + 3.0 * prox)), row * 3.1 + gtick));
        float glitter = step(1.0 - path * 0.7, gl) * sunSee;
        c = mix(c, uGlow, path * 0.4 * sunSee);
        c = mix(c, mix(uSun, vec3(1.0), 0.3), glitter);
        // camí de la lluna
        float dM = angDiff(az, mAz);
        float wm = 0.006 + 0.3 * ny;
        float mpath = exp(-(dM * dM) / (wm * wm));
        float moonSee = clamp(uMoonI * 1.3, 0.0, 1.0) * smoothstep(-0.02, 0.01, uMoonDir.y) * (1.0 - 0.9 * uOver);
        float mgl = step(1.0 - mpath * 0.75, h12(vec2(floor((colx - drift * 0.4) / (1.0 + 2.0 * prox)), row * 1.7 + gtick * 1.3)));
        c = mix(c, vec3(0.5, 0.55, 0.8), mpath * 0.3 * moonSee);
        c = mix(c, vec3(0.93, 0.95, 1.0), mgl * moonSee);
        // la ciutat il·lumina l'aigua a prop de la costa
        c += vec3(0.07, 0.045, 0.02) * uCity * smoothstep(0.05, 0.11, ny);
        c = mix(c, uFog, uRain * 0.5 * (0.4 + 0.6 * f));
        // línia de l'horitzó
        if (row > -1.5) c = mix(c, uHor, 0.45);
      }
      gl_FragColor = vec4(c, 1.0);
    }
  `;

  // ---------------------------------------------------------------------------
  // Edificis: shader amb finestres procedurals (enceses de nit)
  // ---------------------------------------------------------------------------
  const CITY_VERT = /* glsl */`
    attribute vec4 aB;
    varying vec3 vW;
    varying vec3 vN;
    varying vec4 vB;
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz; vN = normal; vB = aB;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;
  const CITY_FRAG = /* glsl */`
    uniform vec3 uSunDir, uSunCol, uAmb, uFog, uHor, uCamPos, uMoonCol;
    uniform float uSunI, uMoonI, uCity, uFogDist, uTime, uGround, uFlash, uFlickSeed, uFlick;
    uniform vec3 uMoonDir;
    varying vec3 vW;
    varying vec3 vN;
    varying vec4 vB;
    ${GLSL.bayer}
    ${GLSL.noise}
    vec3 facade(float k){
      k = floor(k * 8.0);
      if (k < 1.0) return vec3(0.91, 0.85, 0.75);
      if (k < 2.0) return vec3(0.86, 0.73, 0.55);
      if (k < 3.0) return vec3(0.8, 0.56, 0.44);
      if (k < 4.0) return vec3(0.88, 0.73, 0.7);
      if (k < 5.0) return vec3(0.79, 0.78, 0.77);
      if (k < 6.0) return vec3(0.94, 0.92, 0.89);
      if (k < 7.0) return vec3(0.85, 0.79, 0.66);
      return vec3(0.72, 0.76, 0.8);
    }
    void main(){
      vec3 n = normalize(vN);
      float bay = bayer4(gl_FragCoord.xy);
      float seed = vB.x;
      float style = vB.z;
      vec3 alb = facade(vB.y);
      bool roof = style < 2.5 && n.y > 0.5;
      if (roof) alb = mix(vec3(0.6, 0.58, 0.56), vec3(0.7, 0.47, 0.38), step(0.6, h11(seed * 7.0))) * 0.95;
      if (style > 2.5 && style < 3.5) alb = vec3(0.55, 0.57, 0.6);              // detalls de terrat
      else if (style > 3.5 && style < 4.5) alb = vec3(0.86, 0.86, 0.88);        // far / blanc
      else if (style > 4.5 && style < 5.5) alb = vec3(0.86, 0.78, 0.62);        // sorra
      else if (style > 5.5 && style < 6.5) alb = vec3(0.38, 0.38, 0.4);         // roques / espigó
      else if (style > 6.5 && style < 7.5) alb = mix(vec3(0.4, 0.48, 0.6), vec3(0.64, 0.72, 0.82), smoothstep(-40.0, 70.0, vW.y)); // torre de vidre
      else if (style > 7.5 && style < 8.5) alb = vec3(0.7, 0.68, 0.64) * (0.93 + 0.1 * h12(floor(vW.xz * 0.35)));        // carrers
      else if (style > 8.5 && style < 9.5) alb = mix(vec3(0.33, 0.54, 0.29), vec3(0.39, 0.6, 0.32), step(0.5, fract(vW.x * 0.09))); // gespa
      else if (style > 9.5 && style < 10.5) alb = vec3(0.88, 0.82, 0.7);        // camins
      else if (style > 10.5 && style < 11.5) alb = mix(vec3(0.27, 0.5, 0.3), vec3(0.42, 0.63, 0.32), h11(seed * 3.7)); // copes
      else if (style > 11.5 && style < 12.5) alb = vec3(0.44, 0.33, 0.26);      // troncs
      else if (style > 12.5 && style < 13.5) {                                  // parc infantil
        float k = floor(vB.y * 4.0);
        alb = k < 1.0 ? vec3(0.94, 0.36, 0.34) : k < 2.0 ? vec3(0.99, 0.8, 0.3) : k < 3.0 ? vec3(0.36, 0.6, 0.92) : vec3(0.46, 0.8, 0.5);
      }
      else if (style > 13.5 && style < 14.5) alb = vec3(0.45, 0.72, 0.88);  // aigua (els reflexos, més avall)
      else if (style > 14.5 && style < 15.5) alb = vec3(0.3, 0.46, 0.28);       // ombra dels arbres a la gespa
      // llum: sol esglaonat + cel
      float ndl = max(dot(n, uSunDir), 0.0);
      float sl = floor(ndl * 3.0 + bay * 0.9) / 3.0;
      float ml = max(dot(n, normalize(vec3(-0.3, 0.6, 0.4))), 0.0) * uMoonI;
      vec3 light = uAmb * (0.62 + 0.38 * n.y) + uSunCol * sl * uSunI * 1.05 + uMoonCol * ml * 0.25;
      vec3 c = alb * light;
      // aigua de la font: reflecteix el cel, i el sol o la lluna fan destells que tremolen amb les ones
      if (style > 13.5 && style < 14.5) {
        vec3 V = normalize(vW - uCamPos);
        vec2 rp = vW.xz * 1.6;
        vec3 nw = normalize(vec3((vnoise(rp + vec2(uTime * 0.5, uTime * 0.3)) - 0.5) * 0.55, 1.0, (vnoise(rp * 1.3 + vec2(-uTime * 0.4, uTime * 0.6) + 5.1) - 0.5) * 0.55));
        vec3 R = reflect(V, nw);
        vec3 sky = mix(uHor, uFog, 0.25);
        c = mix(vec3(0.1, 0.17, 0.26) * (0.4 + uSunI), sky, 0.7) * (0.85 + 0.15 * R.y);
        float sg = pow(max(dot(R, uSunDir), 0.0), 90.0) * uSunI;
        float mg = pow(max(dot(R, uMoonDir), 0.0), 110.0) * uMoonI * 1.6;
        c += uSunCol * sg * 0.35 + vec3(0.75, 0.8, 1.0) * mg * 0.3;
        c = mix(c, uSunCol * 1.3, step(0.3, sg));
        c = mix(c, vec3(0.95, 0.96, 1.0), step(0.26, mg));
        c += vec3(1.0, 0.82, 0.55) * uCity * 0.4 * step(0.93, h12(floor(vW.xz * 1.8) + floor(uTime * 1.5)));
      }
      // finestres
      if (!roof && style < 2.5) {
        float u = abs(n.x) > 0.5 ? vW.z : vW.x;
        float v = vW.y - uGround;
        float fh = 3.1, fw = 3.4;
        float fl = floor(v / fh), fv = fract(v / fh);
        float cl = floor((u + seed * 13.0) / fw), fu = fract((u + seed * 13.0) / fw);
        bool isWin = fv > 0.32 && fv < 0.8 && fu > 0.22 && fu < 0.74 && fl >= 1.0 && v < vB.w - 1.6;
        if (style > 1.5) isWin = fv > 0.3 && fv < 0.86 && fu > 0.1 && fu < 0.9 && fl >= 1.0 && v < vB.w - 1.0; // torres de vidre
        if (isWin) {
          float hw = h12(vec2(seed * 31.0 + fl, cl));
          vec3 day = mix(vec3(0.3, 0.36, 0.48), uHor * 0.8, 0.35 + 0.3 * step(0.5, hw));
          if (hw > 0.72 && style < 1.5) day = vec3(0.35, 0.52, 0.42) * light * 1.2;   // persianes verdes
          else if (hw > 0.6 && style < 1.5) day = alb * light * 0.62;               // persianes tancades
          float slot = floor(uTime / 90.0 + hw * 7.0);
          float on = step(h12(vec2(hw * 91.0, slot)), uCity * (0.35 + 0.5 * h11(seed * 3.3)));
          if (abs(seed - uFlickSeed) < 0.5) on *= 1.0 - uFlick;
          vec3 warm = mix(vec3(1.0, 0.8, 0.5), vec3(1.0, 0.92, 0.72), h12(vec2(cl, fl + seed)));
          if (h12(vec2(fl * 3.1, cl + seed)) > 0.9) warm = vec3(0.62, 0.78, 1.0);
          vec3 night = mix(vec3(0.07, 0.07, 0.13), warm, on);
          c = mix(day * light, night, smoothstep(0.1, 0.6, uCity));
          if (on > 0.5) c = max(c, warm * uCity * 0.92);
        }
      }
      // boira atmosfèrica
      float dist = length(vW - uCamPos);
      float fog = 1.0 - exp(-dist / uFogDist);
      fog = floor(fog * 10.0 + bay) / 10.0;
      c = mix(c, uFog, fog);
      c = mix(c, vec3(0.86, 0.84, 1.0), uFlash * 0.25);
      gl_FragColor = vec4(c, 1.0);
    }
  `;

  // Punts de llum (fanals, antenes, cotxes, vaixells, avió): mida en píxels i parpelleig
  const LIGHTS_VERT = /* glsl */`
    attribute vec3 aColor;
    attribute vec4 aP;   // x: mida (px), y: fase, z: mode (0 fix, 1 parpelleig, 2 flaix, 3 cotxe), w: velocitat
    uniform float uTime, uNight;
    varying vec3 vC;
    varying float vA;
    void main(){
      vec3 p = position;
      float a = uNight;
      if (aP.z > 2.5) {             // cotxes: es mouen per la carretera
        float span = 1400.0;
        p.x = mod(p.x + uTime * aP.w + span * 0.5, span) - span * 0.5;
      }
      if (aP.z > 0.5 && aP.z < 1.5) a *= step(0.5, fract(uTime * aP.w + aP.y));
      if (aP.z > 1.5 && aP.z < 2.5) a *= step(0.86, fract(uTime * aP.w + aP.y));
      vC = aColor; vA = a;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = aP.x;
    }
  `;
  const LIGHTS_FRAG = /* glsl */`
    varying vec3 vC;
    varying float vA;
    void main(){
      if (vA < 0.02) discard;
      vec2 q = gl_PointCoord - 0.5;
      // forma de creu per als punts de 3 px
      if (abs(q.x) > 0.2 && abs(q.y) > 0.2) discard;
      gl_FragColor = vec4(vC * vA, 1.0);
    }
  `;

  // Pluja exterior: segments d'1 px que cauen
  const RAIN_VERT = /* glsl */`
    attribute float aEnd;
    attribute float aSeed;
    uniform float uTime, uRain, uWindX;
    varying float vA;
    void main(){
      vec3 p = position;
      float speed = 7.5 + aSeed * 2.5;
      float H = 16.0;
      p.y = mod(p.y - uTime * speed, H) - 8.5;
      float len = 0.28 + 0.2 * aSeed;
      p.y += aEnd * len;
      p.x += (p.y * 0.0) - aEnd * len * uWindX + uTime * 0.0;
      float on = step(aSeed, uRain * 1.05);
      vA = on * (0.35 + 0.3 * aSeed) * (1.0 - aEnd * 0.45);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `;
  const RAIN_FRAG = /* glsl */`
    uniform vec3 uColor;
    varying float vA;
    void main(){
      if (vA < 0.01) discard;
      gl_FragColor = vec4(uColor, vA);
    }
  `;

  // ---------------------------------------------------------------------------
  // Cúmuls de pixel art: forma generada (protuberàncies + base plana) amb la
  // normal 2D guardada a la textura perquè el sol els il·lumini segons l'hora
  // ---------------------------------------------------------------------------
  function cloudTexture(rng, w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    const img = g.createImageData(w, h);
    const base = h * 0.8;
    const circles = [];
    const n = rng.int(5, 8);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const mid = 1 - Math.abs(t - 0.5) * 1.6;
      const r = h * (0.16 + 0.3 * Math.max(0, mid) * rng.range(0.75, 1.15));
      const x = lerp(w * 0.14, w * 0.86, t) + rng.range(-0.04, 0.04) * w;
      const y = base - r * rng.range(0.35, 0.8);
      circles.push([x, y, r]);
    }
    // segona fila de bonys per sobre (dóna volum)
    for (let i = 0; i < 3; i++) {
      const x = w * rng.range(0.3, 0.7), r = h * rng.range(0.14, 0.24);
      circles.push([x, base - h * rng.range(0.45, 0.62), r]);
    }
    const inside = (x, y) => {
      if (y > base + 0.5) return null;
      let best = null, bd = 1e9;
      for (const c of circles) {
        const dx = x - c[0], dy = y - c[1];
        const d = Math.sqrt(dx * dx + dy * dy) - c[2];
        if (d < 0 && d < bd) { bd = d; best = c; }
      }
      return best ? { c: best, d: -bd } : null;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5, py = y + 0.5;
        const hit = inside(px, py);
        const i = (y * w + x) * 4;
        if (!hit) { img.data[i + 3] = 0; continue; }
        // normal aproximada: del centre del bony cap enfora; a la base, cap avall
        let nx = (px - hit.c[0]) / hit.c[2], ny = -(py - hit.c[1]) / hit.c[2];
        const nearBase = smooth((py - (base - h * 0.18)) / (h * 0.18));
        nx = lerp(nx, nx * 0.4, nearBase); ny = lerp(ny, -0.8, nearBase);
        const len = Math.hypot(nx, ny) || 1;
        nx /= len; ny /= len;
        // vora (a menys d'1,5 px del contorn)
        const edge = !inside(px + 1.5, py) || !inside(px - 1.5, py) || !inside(px, py - 1.5) ? 1 : 0;
        img.data[i] = 255;
        img.data[i + 1] = Math.round((nx * 0.5 + 0.5) * 255);
        img.data[i + 2] = Math.round((ny * 0.5 + 0.5) * 255);
        img.data[i + 3] = edge ? 128 : 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.premultiplyAlpha = false;
    return t;
  }

  const CLOUD_VERT = /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `;
  const CLOUD_FRAG = /* glsl */`
    uniform sampler2D tCloud;
    uniform vec3 uLit, uShade, uRim, uHor;
    uniform vec2 uSun2;
    uniform float uSunI, uOpacity, uHaze, uFlash, uRimAmt;
    varying vec2 vUv;
    ${GLSL.bayer}
    void main(){
      vec4 t = texture2D(tCloud, vUv);
      if (t.r < 0.5) discard;
      float bay = bayer4(gl_FragCoord.xy);
      if (bay > uOpacity) discard;
      vec2 n = t.gb * 2.0 - 1.0;
      float l = dot(n, uSun2) * 0.5 + 0.5;
      l = l * 0.8 + 0.2 * (n.y * 0.5 + 0.5);
      float q = floor(l * 3.0 + bay * 0.85) / 3.0;
      vec3 c = mix(uShade, uLit, q);
      float edge = step(t.a, 0.75);
      float rim = edge * step(0.15, dot(n, uSun2)) * uSunI;
      c = mix(c, uRim, rim * 0.8 * uRimAmt);
      c = mix(c, uHor, uHaze);
      c = mix(c, vec3(0.9, 0.88, 1.0), uFlash * 0.5);
      gl_FragColor = vec4(c, 1.0);
    }
  `;

  const _cv = new THREE.Vector3();
  const _moonRim = new THREE.Color('#aab4ec');
  const TimeOfDayDir = (az, el, out) => LOFI.TimeOfDay.dirFrom(az, el, out);

  class Outside {
    constructor(seed = 7) {
      this.rng = new RNG(seed);
      this.scene = new THREE.Scene();
      this.cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 30000);
      this.t = 0;
      this.buildSky();
      this.buildCumulus();
      this.buildCity();
      this.buildCoast();
      this.buildLights();
      this.buildPark();
      this.buildRain();
      this.buildBolt();
      this.buildSparks();
      this.buildLedge();
      this.buildGulls();
      this.buildFireflies();
      this.wind = new THREE.Vector2(this.rng.range(0, 50), this.rng.range(0, 50));
      this.meteor = { t: -1, next: 20 };
    }

    // ---------------- cel ----------------
    buildSky() {
      const u = (this.skyU = {
        uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uCloudLit: { value: new THREE.Color() },
        uCloudShade: { value: new THREE.Color() }, uCloudRim: { value: new THREE.Color() }, uSeaHi: { value: new THREE.Color() },
        uSeaLo: { value: new THREE.Color() }, uFog: { value: new THREE.Color() },
        uGlowI: { value: 0 }, uSunI: { value: 0 }, uCover: { value: 0.3 }, uOver: { value: 0 }, uTime: U.uTime, uStars: { value: 0 },
        uMoonI: { value: 0 }, uMoonPhase: { value: 0.45 }, uRain: { value: 0 }, uFlash: { value: 0 }, uCity: { value: 0 },
        uCamH: { value: 1.65 - SEA_Y }, uPixAng: { value: 0.0026 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uWind: { value: new THREE.Vector2() }, uMeteor: { value: new THREE.Vector4() }, uMeteorT: { value: -1 },
      });
      const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false });
      const g = new THREE.SphereGeometry(1000, 48, 24);
      this.sky = new THREE.Mesh(g, m);
      this.sky.frustumCulled = false;
      this.sky.renderOrder = -1000;
      this.scene.add(this.sky);
    }

    // ---------------- cúmuls ----------------
    buildCumulus() {
      const rng = this.rng;
      this.clouds = [];
      const geo = new THREE.PlaneGeometry(1, 1);
      for (let i = 0; i < 8; i++) {
        const tw = rng.pick([96, 112, 128, 144]), th = Math.round(tw * rng.range(0.36, 0.46));
        const tex = cloudTexture(rng, tw, th);
        const u = {
          tCloud: { value: tex }, uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uRim: { value: new THREE.Color() },
          uHor: { value: new THREE.Color() }, uSun2: { value: new THREE.Vector2(0, 1) }, uSunI: { value: 1 }, uOpacity: { value: 1 },
          uHaze: { value: 0 }, uFlash: { value: 0 }, uRimAmt: { value: 1 },
        };
        const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, depthWrite: false });
        const mesh = new THREE.Mesh(geo, m);
        mesh.frustumCulled = false;
        mesh.renderOrder = -900 + i;
        const D = rng.range(3200, 9000);
        const el = rng.range(0.035, 0.2);
        const W = D * rng.range(0.14, 0.3) * (0.7 + el * 2.5);
        mesh.userData = { az: rng.range(-0.75, 0.75), el, D, W, H: W * th / tw, spd: rng.range(0.6, 1.2), rank: rng.next() };
        this.scene.add(mesh);
        this.clouds.push(mesh);
      }
      // ordena de lluny a prop perquè els propers tapin els llunyans
      this.clouds.sort((a, b) => b.userData.D - a.userData.D);
      this.clouds.forEach((c, i) => { c.renderOrder = -900 + i; });
    }

    updateCumulus(dt, tod, wx, cam, settings) {
      const c = tod.c, v = tod.v;
      const sunAz = Math.atan2(tod.sunDir.x, -tod.sunDir.z), sunEl = Math.asin(tod.sunDir.y);
      const moonAz = Math.atan2(tod.moonDir.x, -tod.moonDir.z), moonEl = Math.asin(tod.moonDir.y);
      const useSun = tod.sunDir.y > -0.12;
      const lAz = useSun ? sunAz : moonAz, lEl = useSun ? sunEl : moonEl;
      const lI = useSun ? clamp(1 - Math.max(0, -tod.sunDir.y) / 0.12) : clamp(tod.moonLightI * 2.5);
      // quants núvols es veuen segons el temps
      const want = clamp((wx.cover - 0.05) / 0.5) * (1 - smooth((wx.overcast - 0.55) / 0.3));
      const drift = (0.0035 + 0.006 * wx.storm) * (settings.cloudSpeed || 1);
      for (const m of this.clouds) {
        const d = m.userData;
        d.az += dt * drift * d.spd * (4000 / d.D);
        if (d.az > 0.85) { d.az = -0.85; }
        const dir = TimeOfDayDir(d.az, d.el, _cv);
        m.position.copy(cam.position).addScaledVector(dir, d.D);
        m.quaternion.copy(cam.quaternion);
        m.scale.set(d.W, d.H, 1);
        const u = m.material.uniforms;
        u.uLit.value.copy(c.cloudLit);
        u.uShade.value.copy(c.cloudShade);
        u.uRim.value.copy(useSun ? c.cloudRim : _moonRim);
        u.uHor.value.copy(c.hor);
        u.uSun2.value.set(lAz - d.az, (lEl - d.el) * 1.4).normalize();
        u.uSunI.value = lI;
        const da = lAz - d.az, de = lEl - d.el;
        u.uRimAmt.value = useSun ? 0.55 + 0.45 * Math.exp(-(da * da + de * de) / 0.12) : 0.12 + 0.6 * Math.exp(-(da * da + de * de) / 0.03);
        const vis = clamp((want * 1.25 - d.rank) * 4);
        const edge = 1 - smooth((Math.abs(d.az) - 0.72) / 0.12);
        u.uOpacity.value = vis * edge;
        u.uHaze.value = clamp(0.4 - d.el * 1.8) + v.rain * 0.3;
        u.uFlash.value = v.flash;
        m.visible = u.uOpacity.value > 0.01;
      }
    }

    // ---------------- ciutat ----------------
    buildCity() {
      const rng = this.rng;
      const pos = [], nor = [], ab = [];
      const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
      const bp = box.attributes.position, bn = box.attributes.normal;
      const addBox = (cx, cz, w, d, h, y0, seed, colorK, style, rotY = 0, topH = null) => {
        const c = Math.cos(rotY), s = Math.sin(rotY);
        for (let i = 0; i < bp.count; i++) {
          const lx = bp.getX(i) * w, ly = (bp.getY(i) + 0.5) * h, lz = bp.getZ(i) * d;
          pos.push(cx + lx * c + lz * s, y0 + ly, cz - lx * s + lz * c);
          const nx = bn.getX(i), ny = bn.getY(i), nz = bn.getZ(i);
          nor.push(nx * c + nz * s, ny, -nx * s + nz * c);
          ab.push(seed, colorK, style, topH !== null ? topH : (y0 - GROUND_Y) + h);
        }
      };
      const addCyl = (cx, cz, r, h, y0, seed, style) => {
        const cg = new THREE.CylinderGeometry(r, r, h, 8, 1).toNonIndexed();
        const cp = cg.attributes.position, cn = cg.attributes.normal;
        for (let i = 0; i < cp.count; i++) {
          pos.push(cx + cp.getX(i), y0 + cp.getY(i) + h / 2, cz + cp.getZ(i));
          nor.push(cn.getX(i), cn.getY(i), cn.getZ(i));
          ab.push(seed, 0.5, style, 999);
        }
        cg.dispose();
      };
      this.antennas = [];
      this.antennaSeeds = [];
      const rooftop = (cx, cz, w, d, top, seed) => {
        // dipòsits d'aigua, casetes, antenes
        const n = rng.int(0, 3);
        for (let k = 0; k < n; k++) {
          const px = cx + rng.range(-0.35, 0.35) * w, pz = cz + rng.range(-0.35, 0.35) * d;
          const kind = rng.next();
          if (kind < 0.35) { addCyl(px, pz, rng.range(0.9, 1.5), rng.range(1.6, 2.6), top + 1.2, seed, 3); addBox(px, pz, 2.2, 2.2, 1.2, top, seed, 0.5, 3); }
          else if (kind < 0.75) addBox(px, pz, rng.range(2, 5), rng.range(2, 4), rng.range(1.5, 2.8), top, seed + 1, rng.next(), 3);
          else { const h = rng.range(4, 9); addBox(px, pz, 0.35, 0.35, h, top, seed, 0.5, 3); if (rng.chance(0.6)) { this.antennas.push(new THREE.Vector3(px, top + h + 0.3, pz)); this.antennaSeeds.push(seed); } }
        }
      };

      // Files d'illes de cases, més baixes com més a prop de la costa, amb torres als costats
      const rows = [
        { z: -70, hMin: 26, hMax: 40 }, { z: -105, hMin: 24, hMax: 38 }, { z: -145, hMin: 20, hMax: 34 },
        { z: -195, hMin: 18, hMax: 30 }, { z: -255, hMin: 16, hMax: 26 }, { z: -320, hMin: 13, hMax: 22 },
        { z: -390, hMin: 11, hMax: 18 }, { z: -445, hMin: 9, hMax: 15 },
      ];
      let seed = 1;
      for (const row of rows) {
        const D = -row.z;
        const span = D * 1.25 + 60;
        let x = -span;
        while (x < span) {
          const w = rng.range(12, 30);
          const gap = rng.chance(0.18) ? rng.range(8, 16) : rng.range(0.5, 3);
          const cx = x + w / 2;
          const dd = rng.range(14, 24);
          const center = Math.abs(cx) / D;          // 0 al centre de la vista
          let h = rng.range(row.hMin, row.hMax) * (0.82 + 0.3 * smooth(center * 1.4));
          // avinguda cap al mar al centre
          if (Math.abs(cx) < PARK.hw + w / 2 + 2) { x += w + gap; continue; }
          const style = rng.chance(0.06) ? 2 : rng.chance(0.2) ? 1 : 0;
          addBox(cx, row.z - dd / 2 + rng.range(-3, 3), w, dd, h, GROUND_Y, seed, rng.next(), style);
          rooftop(cx, row.z - dd / 2, w, dd, GROUND_Y + h, seed);
          if (rng.chance(0.25)) { // àtic retirat
            const h2 = rng.range(3, 6);
            addBox(cx + rng.range(-2, 2), row.z - dd / 2, w * 0.6, dd * 0.6, h2, GROUND_Y + h, seed, rng.next(), style, 0, h + h2);
          }
          seed++;
          x += w + gap;
        }
      }
      // Terra: carrers entre les illes (abans s'hi veia el mar!)
      addBox(0, -246, 3400, 452, 1, GROUND_Y - 1, 0, 0.5, 8);
      // Parc central que baixa fins a la platja
      const addGeo = (geo, x, y, z, style, colorK = 0.5, seed = 0, sx = 1, sy = 1, sz = 1, rotY = 0) => {
        const g2 = geo.index ? geo.toNonIndexed() : geo;
        g2.computeVertexNormals();
        const P = g2.attributes.position, Nn = g2.attributes.normal;
        const c = Math.cos(rotY), sn = Math.sin(rotY);
        for (let i = 0; i < P.count; i++) {
          const lx = P.getX(i) * sx, ly = P.getY(i) * sy, lz = P.getZ(i) * sz;
          pos.push(x + lx * c + lz * sn, y + ly, z - lx * sn + lz * c);
          let nx = Nn.getX(i) / sx, ny = Nn.getY(i) / sy, nz = Nn.getZ(i) / sz;
          const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
          nor.push(nx * c + nz * sn, ny, -nx * sn + nz * c);
          ab.push(seed, colorK, style, 999);
        }
        if (g2 !== geo) g2.dispose();
        geo.dispose();
      };
      const K = PARK, gy = GROUND_Y;
      addBox(0, (K.z0 + K.z1) / 2, K.hw * 2, K.z0 - K.z1, 0.3, gy, 0, 0.5, 9);
      addBox(0, (K.z0 + K.z1) / 2, 6, K.z0 - K.z1, 0.36, gy, 0, 0.5, 10);
      for (const cz of [-150, -262, -372]) addBox(0, cz, K.hw * 2, 5, 0.35, gy, 0, 0.5, 10);
      // plaça amb font
      addGeo(new THREE.CylinderGeometry(16, 16, 0.36, 24), 0, gy + 0.18, K.fountain, 10);
      addGeo(new THREE.CylinderGeometry(7.2, 7.4, 0.9, 24), 0, gy + 0.45, K.fountain, 4);
      addGeo(new THREE.CylinderGeometry(6.7, 6.7, 0.1, 24), 0, gy + 0.9, K.fountain, 14);
      addGeo(new THREE.CylinderGeometry(0.6, 0.9, 2.2, 8), 0, gy + 1.1, K.fountain, 4);
      // parc infantil (sorra, tobogan, gronxadors, cúpula d'escalar, balancí)
      const pg = K.play;
      addBox(pg.x, pg.z, 24, 18, 0.34, gy, 0, 0.5, 5);
      addBox(pg.x - 6, pg.z - 3, 1.2, 2.6, 4.4, gy + 0.3, 0, 0.1, 13, 0.1);            // escala del tobogan
      addGeo(new THREE.BoxGeometry(1.4, 0.25, 6), pg.x - 6, gy + 1.7, pg.z + 0.5, 13, 0.3, 0, 1, 1, 1, 0.1);
      addBox(pg.x + 4, pg.z - 4, 0.3, 0.3, 2.8, gy + 0.3, 0, 0.35, 13);                 // gronxadors
      addBox(pg.x + 9, pg.z - 4, 0.3, 0.3, 2.8, gy + 0.3, 0, 0.35, 13);
      addBox(pg.x + 6.5, pg.z - 4, 5.4, 0.3, 0.3, gy + 3.0, 0, 0.35, 13);
      addGeo(new THREE.SphereGeometry(2.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), pg.x + 3, gy + 0.3, pg.z + 5, 13, 0.6);
      addBox(pg.x - 1, pg.z + 6, 5, 0.3, 0.4, gy + 0.6, 0, 0.85, 13);                   // balancí
      // arbres: files a les vores, grups a dins
      const tree = (x, z, r, h, seed) => {
        addBox(x, z, 0.6, 0.6, h * 0.55, gy + 0.3, seed, 0.5, 12);
        addGeo(new THREE.IcosahedronGeometry(1, 1), x, gy + 0.3 + h * 0.62, z, 11, 0.5, seed, r, r * 0.86, r);
        addGeo(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.08, 10), x + r * 0.5, gy + 0.32, z + r * 0.2, 15);
      };
      let ts = 400;
      for (let z = K.z0 - 8; z > K.z1 + 30; z -= rng.range(10, 14)) {
        tree(-K.hw + 3.5, z, rng.range(3.2, 4.4), rng.range(7, 10), ts++);
        tree(K.hw - 3.5, z + 5, rng.range(3.2, 4.4), rng.range(7, 10), ts++);
      }
      for (let i = 0; i < 26; i++) {
        const x = rng.range(-K.hw + 9, K.hw - 9), z = rng.range(K.z1 + 45, K.z0 - 20);
        if (Math.abs(x) < 6 || Math.hypot(x, z - K.fountain) < 20 || (Math.abs(x - pg.x) < 16 && Math.abs(z - pg.z) < 14) || (Math.abs(x - K.kite.x) < 10 && Math.abs(z - K.kite.z) < 14)) continue;
        tree(x, z, rng.range(2.6, 4.2), rng.range(6, 9), ts++);
      }
      // palmeres cap a la platja
      for (let i = 0; i < 10; i++) {
        const x = (i % 2 ? 1 : -1) * 5.5, z = K.z1 + 8 + Math.floor(i / 2) * 9;
        addBox(x, z, 0.5, 0.5, 9, gy + 0.3, 700 + i, 0.5, 12, 0, null);
        for (let k = 0; k < 6; k++) addGeo(new THREE.BoxGeometry(4.2, 0.25, 0.9), x + Math.cos(k * 1.05) * 1.8, gy + 9.1 - 0.4, z + Math.sin(k * 1.05) * 1.8, 11, 0.5, 700 + i, 1, 1, 1, -k * 1.05);
      }

      // Torres que fan de marc (esquerra i dreta)
      const towers = [
        { x: -150, z: -210, w: 26, d: 26, h: 92 }, { x: -215, z: -300, w: 22, d: 22, h: 70 },
        { x: 175, z: -240, w: 24, d: 30, h: 84 }, { x: 250, z: -330, w: 30, d: 24, h: 64 },
        { x: -142, z: -345, w: 18, d: 18, h: 52 }, { x: 120, z: -390, w: 18, d: 20, h: 48 },
      ];
      for (const t of towers) {
        addBox(t.x, t.z, t.w, t.d, t.h, GROUND_Y, seed, rng.next(), 2);
        addBox(t.x, t.z, t.w * 0.7, t.d * 0.7, 4, GROUND_Y + t.h, seed, 0.5, 3);
        this.antennas.push(new THREE.Vector3(t.x, GROUND_Y + t.h + 10, t.z));
        this.antennaSeeds.push(seed);
        addBox(t.x, t.z, 0.6, 0.6, 10, GROUND_Y + t.h + 4, seed, 0.5, 3);
        seed++;
      }
      // Torre en forma de bala (record llunyà de la Glòries)
      this.bullet = new THREE.Vector3(-205, GROUND_Y, -455);
      {
        const pts = [];
        const H = 120, R = 16;
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          const y = t * H;
          const r = t < 0.62 ? R : R * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.62) / 0.38, 2)));
          pts.push(new THREE.Vector2(Math.max(r, 0.01), y));
        }
        const lg = new THREE.LatheGeometry(pts, 14).toNonIndexed();
        lg.computeVertexNormals();
        const lp = lg.attributes.position, ln = lg.attributes.normal;
        for (let i = 0; i < lp.count; i++) {
          pos.push(this.bullet.x + lp.getX(i), GROUND_Y + lp.getY(i), this.bullet.z + lp.getZ(i));
          nor.push(ln.getX(i), ln.getY(i), ln.getZ(i));
          ab.push(900, 0.95, 7, H);
        }
        lg.dispose();
      }

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('aB', new THREE.Float32BufferAttribute(ab, 4));
      const u = (this.cityU = {
        uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uCamPos: { value: new THREE.Vector3() },
        uMoonCol: { value: new THREE.Color('#8fa0e8') }, uSunI: { value: 1 }, uMoonI: { value: 0 }, uCity: { value: 0 },
        uFogDist: { value: 900 }, uTime: U.uTime, uGround: { value: GROUND_Y }, uFlash: { value: 0 },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uFlickSeed: { value: -99 }, uFlick: { value: 0 },
      });
      const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: CITY_VERT, fragmentShader: CITY_FRAG });
      this.city = new THREE.Mesh(g, m);
      this.city.frustumCulled = false;
      this.scene.add(this.city);
      box.dispose();

      // Llums de la torre bala (de nit fa un degradat de colors)
      this.bulletLights = null;
    }

    // ---------------- costa, espigó, far, muntanyes ----------------
    buildCoast() {
      const rng = this.rng;
      const pos = [], nor = [], ab = [];
      const push = (geo, x, y, z, style, colorK = 0.5, sy = 1, rotY = 0) => {
        const g = geo.index ? geo.toNonIndexed() : geo;
        const p = g.attributes.position, n = g.attributes.normal;
        const c = Math.cos(rotY), s = Math.sin(rotY);
        for (let i = 0; i < p.count; i++) {
          const lx = p.getX(i), lz = p.getZ(i);
          pos.push(x + lx * c + lz * s, y + p.getY(i) * sy, z - lx * s + lz * c);
          nor.push(n.getX(i) * c + n.getZ(i) * s, n.getY(i), -n.getX(i) * s + n.getZ(i) * c);
          ab.push(77, colorK, style, 999);
        }
        if (g !== geo) g.dispose();
        geo.dispose();
      };
      // platja i passeig
      push(new THREE.BoxGeometry(2600, 1, 26), 0, SEA_Y - 0.3, -505, 5);
      push(new THREE.BoxGeometry(2600, 1.6, 22), 0, GROUND_Y - 1.2, -482, 0, 0.62);
      // espigó i far a l'esquerra
      push(new THREE.BoxGeometry(9, 3.5, 170), -250, SEA_Y + 0.4, -600, 6);
      push(new THREE.BoxGeometry(14, 3.5, 14), -250, SEA_Y + 0.4, -690, 6);
      this.lighthouse = new THREE.Vector3(-250, SEA_Y + 2 + 17, -690);
      push(new THREE.CylinderGeometry(1.6, 2.2, 15, 8), -250, SEA_Y + 2.2 + 7.5, -690, 4);
      push(new THREE.CylinderGeometry(1.7, 1.7, 2.4, 8), -250, SEA_Y + 2.2 + 16.2, -690, 2.9, 0.5);
      // muntanyes llunyanes a la dreta (una punta de costa entre la boira)
      {
        const segs = 60;
        for (let i = 0; i < segs; i++) {
          const a0 = i / segs, a1 = (i + 1) / segs;
          const x0 = lerp(1200, 9000, a0), x1 = lerp(1200, 9000, a1);
          const z0 = lerp(-2200, -9000, a0), z1 = lerp(-2200, -9000, a1);
          const hf = (a) => (a < 0.08 ? a / 0.08 : 1) * (220 + 380 * LOFI.fbm1(a * 7 + 3, 3) + 260 * Math.sin(a * 3.1));
          const h0 = Math.max(0, hf(a0)), h1 = Math.max(0, hf(a1));
          const quad = [x0, SEA_Y, z0, x1, SEA_Y, z1, x1, SEA_Y + h1, z1, x0, SEA_Y, z0, x1, SEA_Y + h1, z1, x0, SEA_Y + h0, z0];
          for (let k = 0; k < 6; k++) { pos.push(quad[k * 3], quad[k * 3 + 1], quad[k * 3 + 2]); nor.push(-0.6, 0.3, 0.74); ab.push(78, 0.7, 6, 999); }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('aB', new THREE.Float32BufferAttribute(ab, 4));
      this.coast = new THREE.Mesh(g, this.city.material);
      this.coast.frustumCulled = false;
      this.scene.add(this.coast);

      // feix del far (un triangle additiu que gira)
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 420, -8, -26, 420, 10, 26], 3));
      bg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0.5, 1, 0, 1, 1], 2));
      this.beamMat = new THREE.ShaderMaterial({
        uniforms: { uA: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ float a = uA * (1.0 - vUv.x) * (1.0 - abs(vUv.y - 0.5) * 1.6); gl_FragColor = vec4(vec3(1.0,0.93,0.75) * a, 1.0); }',
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      this.beam = new THREE.Mesh(bg, this.beamMat);
      this.beam.position.copy(this.lighthouse);
      this.beam.frustumCulled = false;
      this.scene.add(this.beam);

      // vaixells (siluetes petites)
      this.boats = [];
      const boatMat = LOFI.toonMat({ vertexColors: true });
      this.boatMat = boatMat;
      const mkSail = () => {
        const G = new Geo();
        G.box(7, 1.4, 2.2, '#f4f0e6', M(0, 0.7, 0));
        const tri = new THREE.BufferGeometry();
        tri.setAttribute('position', new THREE.Float32BufferAttribute([-2.5, 1.4, 0, 2.8, 1.4, 0, 0.4, 10, 0, 2.8, 1.4, 0, -2.5, 1.4, 0, 0.4, 10, 0], 3));
        tri.computeVertexNormals();
        G.add(tri, '#fffaf0', M(0, 0, 0));
        return G.mesh(boatMat, { cast: false, receive: false });
      };
      const mkShip = () => {
        const G = new Geo();
        G.box(150, 9, 22, '#e9e6e2', M(0, 4.5, 0));
        G.box(110, 7, 18, '#f7f5f0', M(-8, 12, 0));
        G.box(70, 6, 16, '#f7f5f0', M(-14, 18, 0));
        G.box(12, 9, 8, '#3a64a8', M(-30, 24, 0));
        G.box(150, 2.4, 22.2, '#2c3c64', M(0, 1.2, 0));
        return G.mesh(boatMat, { cast: false, receive: false });
      };
      for (let i = 0; i < 2; i++) {
        const b = mkSail();
        b.userData = { kind: 'sail', z: -700 - i * 350, x: rng.range(-600, 600), v: rng.range(0.8, 1.6) * rng.sign() };
        this.boats.push(b); this.scene.add(b);
      }
      const ship = mkShip();
      ship.userData = { kind: 'ship', z: -5200, x: -3000, v: 2.4 };
      this.boats.push(ship); this.scene.add(ship);
    }

    // ---------------- punts de llum ----------------
    buildLights() {
      const rng = this.rng;
      const pos = [], colr = [], ap = [];
      const add = (x, y, z, c, size, mode, speed = 0, phase = rng.next()) => {
        const cc = new THREE.Color(c);
        pos.push(x, y, z); colr.push(cc.r, cc.g, cc.b); ap.push(size, phase, mode, speed);
      };
      // fanals del passeig
      for (let x = -1300; x < 1300; x += 22) add(x, GROUND_Y + 5, -493, '#ffcf7a', 1, 0);
      // fanals del parc (al llarg del camí central i al voltant de la font)
      for (let z = PARK.z0 - 20; z > PARK.z1 + 5; z -= 24) { add(-4.2, GROUND_Y + 4, z, '#ffd890', 1, 0); add(4.2, GROUND_Y + 4, z - 12, '#ffd890', 1, 0); }
      for (let k = 0; k < 6; k++) add(Math.cos(k * 1.047) * 15.5, GROUND_Y + 3.6, PARK.fountain + Math.sin(k * 1.047) * 15.5, '#ffe2a8', 1, 0);
      // cotxes (blancs cap a un costat, vermells cap a l'altre)
      for (let i = 0; i < 26; i++) {
        const dir = rng.sign();
        add(rng.range(-700, 700), GROUND_Y + 0.8, dir > 0 ? -484 : -480, dir > 0 ? '#fff4d8' : '#ff5a4a', 1, 3, dir * rng.range(9, 15));
      }
      // antenes vermelles
      for (const a of this.antennas) add(a.x, a.y, a.z, '#ff4a3a', 1, 1, rng.range(0.4, 0.7));
      // far
      add(this.lighthouse.x, this.lighthouse.y + 0.3, this.lighthouse.z, '#fff2c0', 3, 2, 0.2);
      // torre bala: anelles de colors
      for (let k = 0; k < 7; k++) {
        const y = GROUND_Y + 12 + k * 13;
        for (let a = -3; a <= 3; a++) {
          const ang = a * 0.34;
          const c = new THREE.Color().setHSL((k / 7 + 0.55) % 1, 0.7, 0.62);
          add(this.bullet.x + Math.sin(ang) * 16.5, y, this.bullet.z + Math.cos(ang) * 16.5, c.getHex(), 1, 0);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aColor', new THREE.Float32BufferAttribute(colr, 3));
      g.setAttribute('aP', new THREE.Float32BufferAttribute(ap, 4));
      this.lightsU = { uTime: U.uTime, uNight: { value: 0 } };
      const m = new THREE.ShaderMaterial({ uniforms: this.lightsU, vertexShader: LIGHTS_VERT, fragmentShader: LIGHTS_FRAG, depthWrite: false });
      this.points = new THREE.Points(g, m);
      this.points.frustumCulled = false;
      this.points.renderOrder = 5;
      this.scene.add(this.points);

      // llums dels vaixells i l'avió (s'actualitzen a mà)
      const dyn = new THREE.BufferGeometry();
      this.dynPos = new Float32Array(3 * 12);
      this.dynCol = new Float32Array(3 * 12);
      this.dynP = new Float32Array(4 * 12);
      dyn.setAttribute('position', new THREE.BufferAttribute(this.dynPos, 3));
      dyn.setAttribute('aColor', new THREE.BufferAttribute(this.dynCol, 3));
      dyn.setAttribute('aP', new THREE.BufferAttribute(this.dynP, 4));
      this.dynU = { uTime: U.uTime, uNight: { value: 1 } };
      this.dyn = new THREE.Points(dyn, new THREE.ShaderMaterial({ uniforms: this.dynU, vertexShader: LIGHTS_VERT, fragmentShader: LIGHTS_FRAG, depthWrite: false }));
      this.dyn.frustumCulled = false;
      this.dyn.renderOrder = 6;
      this.scene.add(this.dyn);
      this.plane = { active: false, t: 0, next: rng.range(30, 90) };
    }

    // ---------------- vida al parc: nens jugant, pares, un gos, gent amb paraigua, un estel ----------------
    buildPark() {
      const rng = this.rng, K = PARK, gy = GROUND_Y;
      const SHIRTS = ['#ff5a5a', '#ffd23f', '#4fa3ff', '#ff8ad0', '#ffffff', '#5fd08a', '#ff9f40', '#b48cff'];
      const HAIR = ['#3a2a24', '#1e1a1c', '#e8c070', '#7a4a30'];
      const UMB = ['#ff5a6a', '#ffd23f', '#4fa3ff', '#2f3a4a'];
      const P = [];
      const mk = (kind, role, extra = {}) => P.push(Object.assign({
        kind, role, x: 0, z: 0, y: 0, tx: 0, tz: 0, t: rng.next() * 10, sp: 1, vis: 0,
        c1: new THREE.Color(kind === 2 ? rng.pick(UMB) : rng.pick(HAIR)), c2: new THREE.Color(rng.pick(SHIRTS)),
      }, extra));
      for (let i = 0; i < 5; i++) mk(0, 'run', { sp: rng.range(2.2, 3.2) });
      mk(0, 'swing', { seat: 0 }); mk(0, 'swing', { seat: 1 });
      mk(0, 'slide');
      mk(0, 'seesaw', { end: 0 }); mk(0, 'seesaw', { end: 1 });
      mk(0, 'kite');
      mk(1, 'parent', { x: K.play.x + 12.5, z: K.play.z + 2 }); mk(1, 'parent', { x: K.play.x - 12.5, z: K.play.z - 5 });
      mk(1, 'walk', { sp: 1.2 }); mk(1, 'walk', { sp: 1.0 }); mk(1, 'jog', { sp: 3.0 });
      mk(3, 'dog', { sp: 3.5 });
      for (let i = 0; i < 4; i++) mk(2, 'umbrella', { sp: rng.range(0.9, 1.3) });
      for (const p of P) {
        if (p.role === 'walk' || p.role === 'jog' || p.role === 'umbrella') { p.x = rng.range(-3, 3); p.z = rng.range(K.z1 + 20, K.z0 - 20); p.tz = rng.chance(0.5) ? K.z1 + 15 : K.z0 - 15; }
        if (p.role === 'run') { p.x = K.play.x + rng.range(-9, 9); p.z = K.play.z + rng.range(-6, 6); p.tx = p.x; p.tz = p.z; }
        if (p.kind === 3) p.c2.set('#8a5a3a'), p.c1.set('#8a5a3a');
      }
      this.people = P;
      const n = P.length;
      const g = new THREE.BufferGeometry();
      this.pplPos = new Float32Array(n * 3);
      this.pplC1 = new Float32Array(n * 3);
      this.pplC2 = new Float32Array(n * 3);
      this.pplK = new Float32Array(n * 2);
      P.forEach((p, i) => { this.pplC1.set([p.c1.r, p.c1.g, p.c1.b], i * 3); this.pplC2.set([p.c2.r, p.c2.g, p.c2.b], i * 3); this.pplK[i * 2] = p.kind; });
      g.setAttribute('position', new THREE.BufferAttribute(this.pplPos, 3));
      g.setAttribute('aC1', new THREE.BufferAttribute(this.pplC1, 3));
      g.setAttribute('aC2', new THREE.BufferAttribute(this.pplC2, 3));
      g.setAttribute('aK', new THREE.BufferAttribute(this.pplK, 2));
      this.pplU = { uLight: { value: 1 } };
      this.ppl = new THREE.Points(g, new THREE.ShaderMaterial({
        uniforms: this.pplU,
        vertexShader: `attribute vec3 aC1; attribute vec3 aC2; attribute vec2 aK; uniform float uLight;
          varying vec3 vC1; varying vec3 vC2; varying float vKind; varying float vVis;
          void main(){
            vC1 = aC1 * uLight; vC2 = aC2 * uLight; vKind = aK.x; vVis = aK.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aK.x < 0.5 ? 2.0 : 3.0;
          }`,
        fragmentShader: `varying vec3 vC1; varying vec3 vC2; varying float vKind; varying float vVis;
          void main(){
            if (vVis < 0.5) discard;
            float size = vKind < 0.5 ? 2.0 : 3.0;
            vec2 px = floor(gl_PointCoord * size);
            vec3 c;
            if (vKind < 0.5) { if (px.x > 0.5) discard; c = px.y < 0.5 ? vC1 : vC2; }
            else if (vKind < 1.5) { if (abs(px.x - 1.0) > 0.5) discard; c = px.y < 0.5 ? vC1 : (px.y < 1.5 ? vC2 : vC2 * 0.5); }
            else if (vKind < 2.5) { if (px.y < 0.5) c = vC1; else { if (abs(px.x - 1.0) > 0.5) discard; c = vC2; } }
            else { if (px.y > 1.5 && px.x < 1.5) c = vC2; else if (px.y > 0.5 && px.y < 1.5 && px.x < 0.5) c = vC1 * 0.8; else discard; }
            gl_FragColor = vec4(c, 1.0);
          }`,
      }));
      this.ppl.frustumCulled = false;
      this.ppl.renderOrder = 7;
      this.scene.add(this.ppl);

      // estel: rombe de colors amb cua i fil
      const kg = new THREE.BufferGeometry();
      kg.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.7, 0, -1.3, 0, 0, 0, 0, 0, 0, 1.7, 0, 0, 0, 0, 1.3, 0, 0, -1.3, 0, 0, 0, -1.9, 0, 0, 0, 0, 0, 0, 0, 0, -1.9, 0, 1.3, 0, 0], 3));
      const kc = [], A = new THREE.Color('#ff4a5a'), B = new THREE.Color('#ffd23f');
      for (let i = 0; i < 12; i++) { const c = i < 3 || (i >= 9) ? A : B; kc.push(c.r, c.g, c.b); }
      kg.setAttribute('color', new THREE.Float32BufferAttribute(kc, 3));
      this.kite = new THREE.Mesh(kg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      this.kite.frustumCulled = false;
      this.scene.add(this.kite);
      const lg = new THREE.BufferGeometry();
      this.kitePos = new Float32Array(3 * 2 * 7);
      lg.setAttribute('position', new THREE.BufferAttribute(this.kitePos, 3));
      this.kiteLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xe8e4dc, transparent: true, opacity: 0.35, depthWrite: false }));
      this.kiteLines.frustumCulled = false;
      this.scene.add(this.kiteLines);

      // brolladors de la font
      const N = 14, fp = new Float32Array(N * 3), fs = new Float32Array(N);
      for (let i = 0; i < N; i++) { fp.set([0, GROUND_Y + 2.2, PARK.fountain], i * 3); fs[i] = i / N; }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
      fg.setAttribute('aSeed', new THREE.BufferAttribute(fs, 1));
      this.fountU = { uTime: U.uTime, uA: { value: 1 }, uColor: { value: new THREE.Color('#e8f4ff') } };
      this.fount = new THREE.Points(fg, new THREE.ShaderMaterial({
        uniforms: this.fountU, transparent: true, depthWrite: false,
        vertexShader: `attribute float aSeed; uniform float uTime; varying float vA;
          void main(){
            float t = fract(uTime * 0.7 + aSeed);
            float ang = aSeed * 6.2831 * 3.0;
            vec3 p = position + vec3(cos(ang) * t * 3.2, 3.2 * t - 3.6 * t * t, sin(ang) * t * 3.2);
            vA = 1.0 - t * 0.6;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = 1.0;
          }`,
        fragmentShader: `uniform vec3 uColor; uniform float uA; varying float vA; void main(){ if (vA * uA < 0.05) discard; gl_FragColor = vec4(uColor, vA * uA); }`,
      }));
      this.fount.frustumCulled = false;
      this.scene.add(this.fount);
    }

    updatePark(dt, tod, wx) {
      const K = PARK, gy = GROUND_Y, r = this.rng, pg = K.play;
      const day = tod.daylight, rain = wx.rain;
      const kids = day > 0.38 && rain < 0.15;
      const strollers = day > 0.22 && rain < 0.25;
      const umbrellas = day > 0.18 && rain >= 0.25;
      const walkTo = (p, speed) => {
        const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
        if (d < 0.3) return true;
        const st = Math.min(d, speed * dt);
        p.x += (dx / d) * st; p.z += (dz / d) * st;
        return false;
      };
      let kiteKid = null;
      for (let i = 0; i < this.people.length; i++) {
        const p = this.people[i];
        p.t += dt;
        let vis = 0, y = gy + 0.9;
        switch (p.role) {
          case 'run':
            vis = kids;
            if (walkTo(p, p.sp) || r.chance(dt * 0.3)) {
              // de tant en tant empaita un altre nen
              const o = r.chance(0.3) ? this.people[r.int(0, 4)] : null;
              p.tx = o ? o.x : pg.x + r.range(-10, 10); p.tz = o ? o.z : pg.z + r.range(-7, 7);
            }
            y = gy + 0.9 + Math.abs(Math.sin(p.t * 9)) * 0.25;
            break;
          case 'swing': {
            vis = kids;
            const sx = pg.x + 5.2 + p.seat * 2.6;
            const a = Math.sin(p.t * 2.6) * 0.9;
            p.x = sx; p.z = pg.z - 4 + Math.sin(a) * 2.2; y = gy + 2.8 - Math.cos(a) * 1.9;
            break;
          }
          case 'slide': {
            vis = kids;
            const ph = (p.t % 7) / 7;
            if (ph < 0.55) { const k = ph / 0.55; p.x = pg.x - 6 + Math.sin(k * 6.28) * 2.5; p.z = pg.z + 4.5 - k * 8; y = gy + 0.9; }
            else if (ph < 0.72) { const k = (ph - 0.55) / 0.17; p.x = pg.x - 6; p.z = pg.z - 3.5; y = gy + 0.9 + k * 3.8; }
            else { const k = (ph - 0.72) / 0.28; const e = Math.min(1, k * 1.6); p.x = pg.x - 6; p.z = pg.z - 3 + e * 7; y = gy + 4.7 - e * 3.8; }
            break;
          }
          case 'seesaw': {
            vis = kids;
            const a = Math.sin(p.t * 1.9 + (p.end ? Math.PI : 0));
            p.x = pg.x - 1 + (p.end ? 2.2 : -2.2); p.z = pg.z + 6; y = gy + 1.3 + a * 0.6;
            break;
          }
          case 'kite':
            vis = kids;
            p.x = K.kite.x + Math.sin(p.t * 0.4) * 1.2; p.z = K.kite.z + Math.cos(p.t * 0.3) * 1;
            kiteKid = p;
            break;
          case 'parent':
            vis = kids;
            y = gy + 1.2 + Math.sin(p.t * 0.8) * 0.05;
            break;
          case 'walk': case 'jog': case 'umbrella':
            vis = p.role === 'umbrella' ? umbrellas : strollers;
            if (walkTo(p, p.sp)) p.tz = p.tz < (K.z0 + K.z1) / 2 ? K.z0 - 15 : K.z1 + 15;
            p.tx = p.role === 'jog' ? 1.5 : (p.role === 'umbrella' ? -1.8 + (i % 2) * 3.6 : -1.2);
            y = gy + 1.2 + (p.role === 'jog' ? Math.abs(Math.sin(p.t * 8)) * 0.2 : 0);
            if (p.role === 'umbrella') y = gy + 1.5;
            break;
          case 'dog': {
            vis = strollers;
            const owner = this.people.find((q) => q.role === 'walk');
            if (owner) {
              p.tx = owner.x + Math.sin(p.t * 1.3) * 3; p.tz = owner.z + Math.cos(p.t * 0.9) * 3;
              walkTo(p, p.sp);
            }
            y = gy + 0.6;
            break;
          }
        }
        p.vis = vis ? 1 : 0;
        this.pplPos[i * 3] = p.x; this.pplPos[i * 3 + 1] = y; this.pplPos[i * 3 + 2] = p.z;
        this.pplK[i * 2 + 1] = p.vis;
      }
      this.ppl.geometry.attributes.position.needsUpdate = true;
      this.ppl.geometry.attributes.aK.needsUpdate = true;
      this.pplU.uLight.value = clamp(0.35 + 0.75 * tod.v.ambI * (1 - 0.3 * tod.v.overcast));
      // estel
      const kv = !!kiteKid && kids;
      this.kite.visible = this.kiteLines.visible = kv;
      if (kv) {
        const t = this.t;
        const kx = kiteKid.x + 10 + Math.sin(t * 0.33) * 5, ky = gy + 34 + Math.sin(t * 0.52) * 4, kz = kiteKid.z - 18 + Math.cos(t * 0.41) * 3;
        this.kite.position.set(kx, ky, kz);
        this.kite.quaternion.copy(this.cam.quaternion);
        this.kite.rotateZ(Math.sin(t * 1.3) * 0.25);
        const L = this.kitePos;
        let n = 0;
        const seg = (a, b) => { L.set([a[0], a[1], a[2], b[0], b[1], b[2]], n * 6); n++; };
        const hx = kiteKid.x, hy = gy + 1.4, hz = kiteKid.z;
        // fil amb una mica de panxa
        let prev = [hx, hy, hz];
        for (let k = 1; k <= 3; k++) {
          const u = k / 3;
          const pnt = [hx + (kx - hx) * u, hy + (ky - hy) * u - Math.sin(u * Math.PI) * 3, hz + (kz - hz) * u];
          seg(prev, pnt); prev = pnt;
        }
        // cua
        prev = [kx, ky - 1.9, kz];
        for (let k = 1; k <= 4; k++) {
          const pnt = [kx + Math.sin(t * 3 + k) * 0.8 - k * 0.4, ky - 1.9 - k * 1.3, kz];
          seg(prev, pnt); prev = pnt;
        }
        this.kiteLines.geometry.attributes.position.needsUpdate = true;
        this.kiteLines.geometry.setDrawRange(0, n * 2);
      }
      this.fountU.uA.value = day > 0.15 ? 1 : 0.5;
    }

    // ---------------- pluja ----------------
    buildRain() {
      const N = 1600, rng = this.rng;
      const pos = new Float32Array(N * 6), end = new Float32Array(N * 2), sd = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) {
        const z = -0.6 - Math.pow(rng.next(), 1.6) * 22;
        const spread = 2 + (-z) * 0.75;
        const x = rng.range(-spread, spread) + 0.0;
        const y = rng.range(-8, 8);
        const s = rng.next();
        pos.set([x, y, z, x, y, z], i * 6);
        end[i * 2] = 0; end[i * 2 + 1] = 1;
        sd[i * 2] = s; sd[i * 2 + 1] = s;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
      g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
      this.rainU = { uTime: U.uTime, uRain: { value: 0 }, uWindX: { value: 0.15 }, uColor: { value: new THREE.Color('#c8d2ea') } };
      const m = new THREE.ShaderMaterial({ uniforms: this.rainU, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false });
      this.rain = new THREE.LineSegments(g, m);
      this.rain.frustumCulled = false;
      this.rain.renderOrder = 20;
      this.scene.add(this.rain);
    }

    // ---------------- llamp ----------------
    buildBolt() {
      const g = new THREE.BufferGeometry();
      this.boltPos = new Float32Array(3 * 2 * 160);
      g.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3));
      g.setDrawRange(0, 0);
      this.boltMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false });
      this.bolt = new THREE.LineSegments(g, this.boltMat);
      this.bolt.frustumCulled = false;
      this.bolt.visible = false;
      this.bolt.renderOrder = 4;
      this.scene.add(this.bolt);
      // una segona passada desplaçada fa el llamp de 2 px amb un halo lila
      this.boltGlowMat = new THREE.LineBasicMaterial({ color: 0xb8a8ff, transparent: true, opacity: 0.8, depthWrite: false });
      this.boltGlow = new THREE.LineSegments(g, this.boltGlowMat);
      this.boltGlow.frustumCulled = false;
      this.boltGlow.renderOrder = 3;
      this.bolt.add(this.boltGlow);
      this.boltGlow2 = new THREE.LineSegments(g, this.boltGlowMat);
      this.boltGlow2.frustumCulled = false;
      this.boltGlow2.renderOrder = 3;
      this.bolt.add(this.boltGlow2);
    }

    strike(near = false) {
      const rng = this.rng;
      let n = 0;
      const P = this.boltPos;
      const seg = (x0, y0, z0, x1, y1, z1) => { if (n >= 160) return; P.set([x0, y0, z0, x1, y1, z1], n * 6); n++; };
      const branch = (x0, y0, z0, len, dirx, depth) => {
        let px = x0, py = y0, pz = z0;
        const steps = depth === 0 ? 22 : rng.int(4, 9);
        const dy = len / steps;
        for (let i = 0; i < steps; i++) {
          const nx = px + (dirx + rng.range(-1, 1)) * dy * 0.45, ny = py - dy * rng.range(0.7, 1.2), nz = pz + rng.range(-1, 1) * dy * 0.2;
          seg(px, py, pz, nx, Math.max(ny, SEA_Y), nz);
          if (depth < 2 && rng.chance(depth === 0 ? 0.22 : 0.1)) branch(nx, ny, nz, dy * rng.range(3, 7), rng.range(-1.2, 1.2), depth + 1);
          px = nx; py = ny; pz = nz;
          if (py <= SEA_Y) break;
        }
      };
      // llamp a prop: toca l'antena d'una torre que es veu per la finestra
      if (near) {
        // antenes, el far i la punta de la torre bala; només les que es veuen des de l'habitació
        const pool = this.antennas.map((p, i) => ({ p, seed: this.antennaSeeds[i] }));
        pool.push({ p: this.lighthouse.clone().add(new THREE.Vector3(0, 1.6, 0)), seed: -1 });
        pool.push({ p: new THREE.Vector3(this.bullet.x, GROUND_Y + 121, this.bullet.z), seed: 900 });
        const cands = pool.filter((c) => {
          const D = Math.hypot(c.p.x, c.p.z);
          return D < 800 && c.p.y > SEA_Y + 12 && (!this.visibleTest || this.visibleTest(c.p));
        });
        if (cands.length) {
          const pick = rng.pick(cands), T = pick.p;
          const D = Math.hypot(T.x, T.z), az = Math.atan2(T.x, -T.z);
          const top = T.y + rng.range(520, 820);
          const sx = T.x + rng.range(-45, 45), sz = T.z + rng.range(-30, 30);
          let px = sx, py = top, pz = sz;
          const steps = 30;
          let drift = 0;
          for (let k = 1; k <= steps; k++) {
            const u = k / steps, jit = (1 - u) * 0.8 + 0.2;
            const last = k === steps;
            drift += rng.range(-1, 1) * 14 * jit;
            const nx = last ? T.x : lerp(sx, T.x, u) + drift * (1 - u) + rng.range(-1, 1) * 9 * jit;
            const ny = last ? T.y : lerp(top, T.y, u) + rng.range(-0.3, 0.3) * (top - T.y) / steps;
            const nz = last ? T.z : lerp(sz, T.z, u) + rng.range(-1, 1) * 6 * jit;
            seg(px, py, pz, nx, ny, nz);
            if (k < steps - 4 && rng.chance(0.2)) branch(nx, ny, nz, rng.range(60, 170), rng.range(-1.3, 1.3), 1);
            px = nx; py = ny; pz = nz;
          }
          this.bolt.geometry.attributes.position.needsUpdate = true;
          this.bolt.geometry.setDrawRange(0, n * 2);
          this.boltDist = D;
          this.sparkBurst(T);
          this.flick = pick.seed >= 0 ? { seed: pick.seed, t: 0 } : null;
          return { az, dist: 0, near: true };
        }
      }
      // llamp llunyà, al fons, sobre el mar
      const az = rng.range(-0.32, 0.3), D = rng.range(2200, 6500);
      const x = Math.sin(az) * D, z = -Math.cos(az) * D;
      const top = 1300 + rng.range(-150, 250);
      branch(x, top, z, top - SEA_Y, rng.range(-0.3, 0.3), 0);
      this.bolt.geometry.attributes.position.needsUpdate = true;
      this.bolt.geometry.setDrawRange(0, n * 2);
      this.boltDist = D;
      return { az, dist: (D - 1800) / 4700, near: false };
    }

    // ---------------- espurnes i esclat de llum a l'impacte ----------------
    buildSparks() {
      const N = 150;
      this.spk = { n: N, p: new Float32Array(N * 3), v: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), a: new Float32Array(N) };
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.spk.p, 3));
      g.setAttribute('aL', new THREE.BufferAttribute(this.spk.a, 1));
      this.sparks = new THREE.Points(g, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: 'attribute float aL; varying float vL; void main(){ vL = aL; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aL > 0.55 ? 2.0 : 1.0; }',
        fragmentShader: 'varying float vL; void main(){ if (vL <= 0.01) discard; vec3 c = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.97, 0.75), smoothstep(0.3, 0.85, vL)); gl_FragColor = vec4(c * min(1.0, vL * 1.6), 1.0); }',
      }));
      this.sparks.frustumCulled = false;
      this.sparks.renderOrder = 9;
      this.sparks.visible = false;
      this.scene.add(this.sparks);
      // esclat de llum a l'antena
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
      this.flareU = { uSize: { value: 0 }, uA: { value: 0 } };
      this.flare = new THREE.Points(fg, new THREE.ShaderMaterial({
        uniforms: this.flareU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: 'uniform float uSize; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }',
        fragmentShader: 'uniform float uA; void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q) * 2.0; if (d > 1.0) discard; float k = d < 0.35 ? 1.0 : (d < 0.7 ? 0.55 : 0.22); gl_FragColor = vec4(vec3(0.92, 0.9, 1.0) * k * uA, 1.0); }',
      }));
      this.flare.frustumCulled = false;
      this.flare.renderOrder = 10;
      this.flare.visible = false;
      this.scene.add(this.flare);
      this.flareT = 9;
    }

    sparkBurst(T) {
      const S = this.spk, r = this.rng;
      for (let i = 0; i < S.n; i++) {
        S.p.set([T.x, T.y, T.z], i * 3);
        const th = r.range(0, Math.PI * 2), up = r.range(-0.3, 1);
        const sp = r.range(4, 22);
        S.v.set([Math.cos(th) * Math.sqrt(1 - up * up) * sp, up * sp + 3, Math.sin(th) * Math.sqrt(1 - up * up) * sp], i * 3);
        S.max[i] = S.life[i] = r.range(0.6, 2.6);
      }
      this.sparks.visible = true;
      this.flare.geometry.attributes.position.array.set([T.x, T.y, T.z]);
      this.flare.geometry.attributes.position.needsUpdate = true;
      this.flareT = 0;
      this.flare.visible = true;
    }

    updateSparks(dt) {
      const S = this.spk;
      if (this.sparks.visible) {
        let alive = 0;
        for (let i = 0; i < S.n; i++) {
          if (S.life[i] <= 0) { S.a[i] = 0; continue; }
          S.life[i] -= dt;
          S.v[i * 3 + 1] -= 7.5 * dt;
          S.v[i * 3] *= 1 - dt * 0.9; S.v[i * 3 + 2] *= 1 - dt * 0.9;
          for (let k = 0; k < 3; k++) S.p[i * 3 + k] += S.v[i * 3 + k] * dt;
          S.a[i] = Math.max(0, S.life[i] / S.max[i]) * (0.6 + 0.4 * Math.random());
          alive++;
        }
        this.sparks.geometry.attributes.position.needsUpdate = true;
        this.sparks.geometry.attributes.aL.needsUpdate = true;
        if (!alive) this.sparks.visible = false;
      }
      if (this.flare.visible) {
        this.flareT += dt;
        const k = Math.max(0, 1 - this.flareT / 0.8);
        this.flareU.uSize.value = 3 + 11 * k;
        this.flareU.uA.value = k * (0.7 + 0.3 * Math.random());
        if (k <= 0) this.flare.visible = false;
      }
      // les llums de l'edifici tocat parpellegen (sobretensió)
      const cu = this.cityU;
      if (this.flick) {
        const t = (this.flick.t += dt);
        cu.uFlickSeed.value = this.flick.seed;
        cu.uFlick.value = t < 0.35 ? 1 : t < 0.45 ? 0 : t < 0.7 ? 1 : t < 0.8 ? 0.4 : t < 1.1 ? 1 : 0;
        if (t > 1.6) { this.flick = null; cu.uFlick.value = 0; cu.uFlickSeed.value = -99; }
      }
    }

    // ---------------- ampit exterior (on es posen els coloms) ----------------
    buildLedge() {
      const L = LOFI.LAYOUT;
      const G = new Geo();
      const x0 = L.win.x0 - 0.1, x1 = L.win.x1 + 0.1;
      // ampit de pedra
      G.box(x1 - x0, 0.07, 0.34, '#d9d2c8', M((x0 + x1) / 2, L.win.y0 - 0.075, -0.3), 3);
      G.box(x1 - x0, 0.05, 0.02, '#bdb4aa', M((x0 + x1) / 2, L.win.y0 - 0.14, -0.465));
      // brancals de la façana (visibles a través del vidre als costats)
      G.box(0.18, L.win.y1 - L.win.y0 + 0.2, 0.2, '#e4dcd0', M(L.win.x0 - 0.09, (L.win.y0 + L.win.y1) / 2, -0.2), 3);
      G.box(0.18, L.win.y1 - L.win.y0 + 0.2, 0.2, '#e4dcd0', M(L.win.x1 + 0.09, (L.win.y0 + L.win.y1) / 2, -0.2), 3);
      G.box(x1 - x0 + 0.3, 0.2, 0.2, '#e4dcd0', M((x0 + x1) / 2, L.win.y1 + 0.1, -0.2), 3);
      // jardinera amb geranis
      const fx = L.win.x0 + 0.3;
      G.box(0.44, 0.13, 0.16, '#c26c4e', M(fx, L.win.y0 - 0.04 + 0.065, -0.3), 7);
      G.box(0.46, 0.025, 0.18, '#a95a40', M(fx, L.win.y0 + 0.1, -0.3));
      const rng = this.rng;
      const leaf = new THREE.IcosahedronGeometry(0.05, 0);
      for (let i = 0; i < 10; i++) {
        G.add(leaf.clone(), i % 2 ? '#4f8a52' : '#3e7045', M(fx + rng.range(-0.2, 0.2), L.win.y0 + 0.15 + rng.range(-0.02, 0.05), -0.3 + rng.range(-0.05, 0.05), rng.next() * 3, rng.next() * 3, 0, rng.range(0.7, 1.1), rng.range(0.45, 0.7), rng.range(0.7, 1.1)), 5);
      }
      for (let i = 0; i < 5; i++) {
        const cx = fx + rng.range(-0.18, 0.18), cy = L.win.y0 + rng.range(0.22, 0.3), cz = -0.3 + rng.range(-0.05, 0.05);
        G.box(0.008, cy - L.win.y0 - 0.14, 0.008, '#4c7a44', M(cx, (cy + L.win.y0 + 0.14) / 2, cz));
        for (let k = 0; k < 4; k++) G.add(new THREE.IcosahedronGeometry(0.018, 0), k % 2 ? '#e8454e' : '#ff6a6a', M(cx + rng.range(-0.025, 0.025), cy + rng.range(-0.015, 0.025), cz + rng.range(-0.025, 0.025)));
      }
      leaf.dispose();
      this.ledgeMat = toonMat({ vertexColors: true });
      this.ledge = G.mesh(this.ledgeMat, { cast: false, receive: false });
      this.scene.add(this.ledge);
      // llums per a l'ampit i els coloms
      this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
      this.dirL = new THREE.DirectionalLight(0xffffff, 1);
      this.scene.add(this.hemi, this.dirL, this.dirL.target);
    }

    // ---------------- gavines llunyanes (petites "v" que planegen sobre el mar) ----------------
    buildGulls() {
      const N = 6;
      this.gullPos = new Float32Array(N * 8 * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.gullPos, 3));
      this.gullMat = new THREE.LineBasicMaterial({ color: 0x3a3e52, transparent: true, opacity: 1, depthWrite: false });
      this.gullMesh = new THREE.LineSegments(g, this.gullMat);
      this.gullMesh.frustumCulled = false;
      this.gullMesh.renderOrder = 6;
      this.gullMesh.visible = false;
      this.scene.add(this.gullMesh);
      this.gulls = { active: false, next: this.rng.range(20, 60), t: 0, birds: [] };
    }

    updateGulls(dt, tod, wx) {
      const G = this.gulls, r = this.rng;
      const ok = tod.daylight > 0.35 && wx.rain < 0.2;
      if (!G.active) {
        this.gullMesh.visible = false;
        G.next -= dt;
        if (G.next <= 0 && ok) {
          G.active = true; G.t = 0;
          const n = r.int(2, 6), dir = r.sign();
          const D = r.range(160, 420), el = r.range(0.01, 0.06);
          G.dur = r.range(35, 60);
          G.birds = [];
          for (let i = 0; i < n; i++) G.birds.push({ dx: r.range(-18, 18), dy: r.range(-5, 5), dz: r.range(-15, 15), ph: r.next() * 10, sp: r.range(0.9, 1.1) });
          G.dir = dir; G.D = D; G.el = el;
        }
        return;
      }
      G.t += dt / G.dur;
      if (G.t >= 1 || !ok) { G.active = false; G.next = r.range(50, 150); return; }
      this.gullMesh.visible = true;
      const P = this.gullPos;
      P.fill(0);
      const az = lerp(-0.75, 0.75, G.dir > 0 ? G.t : 1 - G.t);
      for (let i = 0; i < G.birds.length; i++) {
        const b = G.birds[i];
        const bx = Math.sin(az) * G.D + b.dx + Math.sin(G.t * 9 + b.ph) * 6;
        const bz = -Math.cos(az) * G.D + b.dz;
        const by = 1.65 + Math.tan(G.el) * G.D + b.dy + Math.sin(G.t * 7 + b.ph) * 3;
        // aleteig lent amb estones planejant
        const f = Math.sin(this.t * 5 * b.sp + b.ph);
        const flap = (Math.sin(this.t * 0.4 + b.ph) > 0.3 ? f : 0.25) * 0.9;
        const span = 1.9, tipY = flap * 1.1, midY = 0.35 + flap * 0.35;
        const pts = [[-span, tipY], [-span * 0.45, midY], [-span * 0.45, midY], [0, 0], [0, 0], [span * 0.45, midY], [span * 0.45, midY], [span, tipY]];
        for (let k = 0; k < 8; k++) {
          const j = (i * 8 + k) * 3;
          P[j] = bx + pts[k][0] * 1.4; P[j + 1] = by + pts[k][1] * 1.4; P[j + 2] = bz;
        }
      }
      this.gullMesh.geometry.attributes.position.needsUpdate = true;
      this.gullMesh.geometry.setDrawRange(0, G.birds.length * 8);
      this.gullMat.color.set('#3a3e52').lerp(tod.c.fog, 0.35);
    }

    // ---------------- lluernes: un núvol al parc i, de tant en tant, alguna davant de la finestra ----------------
    buildFireflies() {
      const rng = this.rng;
      const FF_VERT = `
        attribute vec4 aF;   // x: llavor, y: període del parpelleig, z: mida (px), w: brillantor fixa (-1 = calcula-la)
        uniform float uTime, uVis;
        varying float vA; varying float vS;
        void main(){
          vec3 p = position;
          float s = aF.x;
          if (aF.w < 0.0) {
            p += vec3(sin(uTime * (0.21 + s * 0.2) + s * 13.0) * 2.2, sin(uTime * (0.33 + s * 0.3) + s * 7.0) * 0.7, cos(uTime * (0.17 + s * 0.15) + s * 5.0) * 2.2);
            float ph = fract(uTime / aF.y + s * 3.7);
            vA = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.22, 0.42, ph)) * uVis;
          } else vA = aF.w * uVis;
          vS = aF.z;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = aF.z;
        }`;
      const FF_FRAG = `
        uniform vec3 uCore, uGlow;
        varying float vA; varying float vS;
        void main(){
          if (vA < 0.02) discard;
          vec2 q = floor(gl_PointCoord * vS) - floor(vS * 0.5);
          float d = abs(q.x) + abs(q.y);
          if (d > 1.0) discard;
          vec3 c = d < 0.5 ? uCore : uGlow * 0.7;
          gl_FragColor = vec4(c * vA, 1.0);
        }`;
      const mk = (n, fill) => {
        const pos = new Float32Array(n * 3), f = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) fill(i, pos, f);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('aF', new THREE.BufferAttribute(f, 4));
        const u = { uTime: U.uTime, uVis: { value: 0 }, uCore: { value: new THREE.Color(1.25, 1.35, 0.8) }, uGlow: { value: new THREE.Color('#b6e05a') } };
        const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: FF_VERT, fragmentShader: FF_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        const pts = new THREE.Points(g, m);
        pts.frustumCulled = false; pts.renderOrder = 8;
        this.scene.add(pts);
        return { pts, u, pos, f, g };
      };
      // al parc: al voltant dels arbres i els fanals (de lluny, un píxel que parpelleja)
      this.ffPark = mk(56, (i, pos, f) => {
        const nearLamp = i % 3 === 0;
        const x = nearLamp ? (i % 2 ? -4.2 : 4.2) + rng.range(-3, 3) : rng.range(-PARK.hw + 4, PARK.hw - 4);
        const z = rng.range(PARK.z1 + 30, PARK.z0 - 60);
        pos.set([x, GROUND_Y + rng.range(0.6, 3.5), z], i * 3);
        f.set([rng.next(), rng.range(2.2, 4.5), 1, -1], i * 4);
      });
      // a prop: les posicions les mou el programa (per poder-les mirar)
      this.ffNear = mk(5, (i, pos, f) => { f.set([rng.next(), 1, 3, 0], i * 4); });
      this.nearFF = Array.from({ length: 5 }, (_, i) => ({
        base: new THREE.Vector3(rng.range(-1.5, 1.2), rng.range(1.0, 2.0), -rng.range(0.5, 2.4)),
        s: rng.next() * 10, per: rng.range(2.4, 4.2), p: new THREE.Vector3(), a: 0,
      }));
      this.ffVisit = { on: false, t: 0, next: 25, fade: 0, n: 3 };
    }

    updateFireflies(dt, tod, wx) {
      const night = tod.daylight < 0.1 && wx.rain < 0.08;
      const parkVis = clamp((0.14 - tod.daylight) / 0.1) * (1 - clamp(wx.rain * 12));
      this.ffPark.u.uVis.value = parkVis;
      this.ffPark.pts.visible = parkVis > 0.01;
      const V = this.ffVisit, r = this.rng;
      if (!V.on) {
        if (night) V.next -= dt;
        if (V.next <= 0) { V.on = true; V.t = r.range(40, 75); V.n = r.int(2, 4); for (const f of this.nearFF) f.base.set(r.range(-1.5, 1.2), r.range(1.0, 2.0), -r.range(0.5, 2.4)); }
      } else {
        V.t -= dt;
        if (V.t <= 0 || !night) { V.on = false; V.next = r.range(60, 160); }
      }
      V.fade = LOFI.damp(V.fade, V.on ? 1 : 0, 0.7, dt);
      const t = this.t, P = this.ffNear.pos, F = this.ffNear.f;
      for (let i = 0; i < this.nearFF.length; i++) {
        const f = this.nearFF[i];
        const on = i < V.n ? V.fade : 0;
        f.p.set(
          f.base.x + Math.sin(t * 0.23 + f.s) * 0.45 + Math.sin(t * 0.61 + f.s * 2) * 0.12,
          f.base.y + Math.sin(t * 0.31 + f.s * 3) * 0.25 + Math.sin(t * 0.9 + f.s) * 0.05,
          f.base.z + Math.sin(t * 0.19 + f.s * 5) * 0.35);
        const ph = ((t / f.per + f.s) % 1 + 1) % 1;
        const glow = smooth(ph / 0.12) * (1 - smooth((ph - 0.22) / 0.2));
        f.a = on * (0.3 + 0.9 * glow);
        P.set([f.p.x, f.p.y, f.p.z], i * 3);
        F[i * 4 + 3] = f.a;
      }
      this.ffNear.g.attributes.position.needsUpdate = true;
      this.ffNear.g.attributes.aF.needsUpdate = true;
      this.ffNear.u.uVis.value = 1;
      this.ffNear.pts.visible = V.fade > 0.01;
    }

    // la lluerna més visible a prop de la finestra (perquè el gat i el flexo la mirin)
    fireflyTarget() {
      if (!this.ffVisit || this.ffVisit.fade < 0.5) return null;
      let best = null;
      for (let i = 0; i < this.ffVisit.n; i++) { const f = this.nearFF[i]; if (!best || f.p.z > best.z) best = f.p; }
      return best;
    }

    // ---------------- actualització ----------------
    update(dt, tod, wx, cam, settings) {
      this.t += dt;
      const c = tod.c, v = tod.v;
      this.cam.position.copy(cam.position);
      this.cam.quaternion.copy(cam.quaternion);
      if (this.cam.fov !== cam.fov || this.cam.aspect !== cam.aspect) {
        this.cam.fov = cam.fov; this.cam.aspect = cam.aspect; this.cam.updateProjectionMatrix();
      }
      this.sky.position.copy(cam.position);

      const u = this.skyU;
      for (const k of ['top', 'mid', 'hor', 'glow', 'sun', 'cloudLit', 'cloudShade', 'cloudRim', 'seaHi', 'seaLo', 'fog']) {
        u['u' + k[0].toUpperCase() + k.slice(1)].value.copy(c[k]);
      }
      u.uGlowI.value = v.glowI;
      u.uSunI.value = clamp(smooth((tod.sunDir.y + 0.03) / 0.03)) * (1 - 0.85 * v.overcast);
      u.uSunDir.value.copy(tod.sunDir);
      u.uMoonDir.value.copy(tod.moonDir);
      u.uMoonI.value = clamp(smooth((tod.moonDir.y + 0.02) / 0.03)) * (1 - tod.daylight * 0.85) * (1 - 0.9 * v.overcast);
      u.uMoonPhase.value = tod.moonPhase;
      u.uStars.value = v.stars;
      u.uCover.value = wx.cover;
      u.uOver.value = wx.overcast;
      u.uRain.value = v.rain;
      u.uCity.value = v.city;
      u.uFlash.value = v.flash;
      u.uPixAng.value = (cam.fov * DEG) / U.uRes.value.y;
      // vent dels núvols
      this.wind.x += dt * (0.0022 + 0.004 * wx.storm) * (settings.cloudSpeed || 1);
      this.wind.y += dt * 0.0007;
      u.uWind.value.copy(this.wind);

      this.updateCumulus(dt, tod, wx, cam, settings);
      this.updateGulls(dt, tod, wx);
      this.updatePark(dt, tod, wx);
      this.updateFireflies(dt, tod, wx);
      this.updateSparks(dt);

      // estels fugaços
      const m = this.meteor;
      if (m.t >= 0) {
        m.t += dt / m.dur;
        if (m.t > 1) m.t = -1;
      } else if (v.stars > 0.6 && v.overcast < 0.3) {
        m.next -= dt;
        if (m.next <= 0) {
          const az = this.rng.range(-0.45, 0.3), el = this.rng.range(0.12, 0.3);
          u.uMeteor.value.set(az, el, az + this.rng.range(0.08, 0.2), el - this.rng.range(0.05, 0.1));
          m.t = 0; m.dur = this.rng.range(0.5, 0.9); m.next = this.rng.range(25, 70);
        }
      }
      u.uMeteorT.value = m.t;

      // ciutat
      const cu = this.cityU;
      cu.uSunDir.value.copy(tod.sunDir);
      cu.uSunCol.value.copy(c.sunLight);
      cu.uSunI.value = tod.sunLightI;
      cu.uMoonI.value = tod.moonLightI;
      cu.uAmb.value.copy(c.amb).multiplyScalar(0.55 + 0.6 * v.ambI);
      cu.uFog.value.copy(c.fog);
      cu.uHor.value.copy(c.hor);
      cu.uCamPos.value.copy(cam.position);
      cu.uCity.value = v.city;
      cu.uFogDist.value = lerp(1100, 260, clamp(v.rain * 0.8 + v.overcast * 0.25));
      cu.uFlash.value = v.flash;
      cu.uMoonDir.value.copy(tod.moonDir);
      this.lightsU.uNight.value = clamp(v.city * 1.2) * (1 - 0.3 * v.rain);

      // far
      const night = clamp(v.city * 1.3 - 0.2);
      this.beam.rotation.y = this.t * 0.9;
      this.beamMat.uniforms.uA.value = 0.22 * night * (1 - 0.5 * v.rain);

      // vaixells
      for (const b of this.boats) {
        const d = b.userData;
        d.x += d.v * dt * (d.kind === 'ship' ? 1 : 1);
        const lim = d.kind === 'ship' ? 5200 : 900;
        if (d.x > lim) d.x = -lim; if (d.x < -lim) d.x = lim;
        const bob = Math.sin(this.t * 0.8 + d.z) * 0.15;
        b.position.set(d.x, SEA_Y + bob, d.z);
        b.rotation.y = d.v > 0 ? 0 : Math.PI;
        b.visible = !(d.kind === 'sail' && night > 0.7);
      }
      this.updateDyn(dt, night, tod);

      // pluja
      this.rainU.uRain.value = v.rain;
      this.rainU.uWindX.value = 0.12 + 0.5 * wx.storm;
      this.rainU.uColor.value.copy(c.fog).lerp(new THREE.Color('#e8eeff'), 0.55 + 0.3 * tod.daylight);
      this.rain.visible = v.rain > 0.01;

      // llamp
      if (wx.boltAlpha > 0) {
        this.bolt.visible = true;
        this.boltMat.opacity = wx.boltAlpha;
        this.boltGlowMat.opacity = 0.8 * wx.boltAlpha;
        const D = this.boltDist || 4000;
        const off = D < 900 ? 0.004 : 0.0028;
        this.boltGlow.position.set(D * off, 0, 0);
        this.boltGlow2.position.set(-D * off, 0, 0);
      } else this.bolt.visible = false;

      // llums de l'ampit
      this.hemi.color.copy(c.amb).lerp(c.hor, 0.3);
      this.hemi.groundColor.copy(c.ambGround);
      this.hemi.intensity = (0.6 + 0.9 * v.ambI) * Math.PI * 0.55;
      if (tod.sunLightI >= tod.moonLightI) {
        this.dirL.position.copy(tod.sunDir).multiplyScalar(10);
        this.dirL.color.copy(c.sunLight);
        this.dirL.intensity = tod.sunLightI * Math.PI * 0.9;
      } else {
        this.dirL.position.copy(tod.moonDir).multiplyScalar(10);
        this.dirL.color.copy(tod.c.moonLight);
        this.dirL.intensity = tod.moonLightI * Math.PI * 0.5;
      }
      this.dirL.intensity += v.flash * Math.PI * 1.5;
    }

    updateDyn(dt, night, tod) {
      const P = this.dynPos, C = this.dynCol, A = this.dynP;
      let i = 0;
      const put = (x, y, z, col, size, mode, speed, phase) => {
        if (i >= 12) return;
        const cc = LOFI._tmpC || (LOFI._tmpC = new THREE.Color());
        cc.set(col);
        P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
        C[i * 3] = cc.r; C[i * 3 + 1] = cc.g; C[i * 3 + 2] = cc.b;
        A[i * 4] = size; A[i * 4 + 1] = phase; A[i * 4 + 2] = mode; A[i * 4 + 3] = speed;
        i++;
      };
      const ship = this.boats[2].userData;
      if (night > 0.2) {
        put(ship.x - 40, SEA_Y + 14, ship.z, '#fff0c8', 1, 0, 0, 0);
        put(ship.x + 20, SEA_Y + 12, ship.z, '#fff0c8', 1, 0, 0, 0);
        put(ship.x - 10, SEA_Y + 20, ship.z, '#ffe0a0', 1, 0, 0, 0);
        put(ship.x + 60, SEA_Y + 10, ship.z, '#ff6a50', 1, 1, 0.5, 0.3);
      }
      // avió
      const pl = this.plane;
      if (!pl.active) {
        pl.next -= dt;
        if (pl.next <= 0) { pl.active = true; pl.t = 0; pl.dur = this.rng.range(50, 80); pl.el = this.rng.range(0.1, 0.2); pl.dir = this.rng.sign(); }
      } else {
        pl.t += dt / pl.dur;
        if (pl.t > 1) { pl.active = false; pl.next = this.rng.range(60, 160); }
        else {
          const az = lerp(-0.7, 0.6, pl.dir > 0 ? pl.t : 1 - pl.t);
          const D = 3000;
          const x = Math.sin(az) * D, z = -Math.cos(az) * D, y = 1.65 + Math.tan(pl.el) * D;
          put(x, y, z, '#ff5040', 1, 1, 1.0, 0);
          put(x + 6, y, z, '#fffaf0', 1, 2, 1.1, 0.5);
          if (night < 0.2) put(x + 3, y, z, '#c8ccd8', 1, 0, 0, 0);
        }
      }
      for (let k = i; k < 12; k++) A[k * 4] = 0, P[k * 3 + 1] = -9999;
      this.dyn.geometry.attributes.position.needsUpdate = true;
      this.dyn.geometry.attributes.aColor.needsUpdate = true;
      this.dyn.geometry.attributes.aP.needsUpdate = true;
      this.dynU.uNight.value = 1;
    }
  }

  LOFI.Outside = Outside;
})();
