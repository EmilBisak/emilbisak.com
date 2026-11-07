// WebGL backdrop: one liquid-metal form that breathes, follows the cursor and
// glides through the page as a quiet scroll story. Reads shared state from
// window.flow (main.js): story = float chapter index, pointer = NDC cursor.
import * as THREE from "three";

const F = window.flow;

/* ---------- Shaders ---------- */
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x - floor(x * (1.0 / 289.0)) * 289.0;}
vec4 mod289(vec4 x){return x - floor(x * (1.0 / 289.0)) * 289.0;}
vec4 permute(vec4 x){return mod289(((x * 34.0) + 1.0) * x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

const FORM_VERT = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
uniform vec3 uPointer;
uniform float uPointerAmt;
varying vec3 vNormalW;
varying vec3 vPosW;
varying float vDisp;
${NOISE}

// Domain-warped noise: slow, fluid folds instead of busy bumps
float field(vec3 n) {
    float t = uTime;
    vec3 q = n * uFreq;
    float warp = snoise(q * 0.5 + vec3(0.0, t * 0.06, t * 0.045));
    float d = snoise(q + vec3(warp * 0.7, t * 0.09, -t * 0.07)) * 0.8;
    d += snoise(q * 1.9 + vec3(-t * 0.08, warp, t * 0.05)) * 0.07;
    return d;
}

vec3 displace(vec3 n) {
    float d = field(n) * uAmp;
    d += pow(max(dot(n, uPointer), 0.0), 5.0) * uPointerAmt;
    return n * (1.0 + d);
}

void main() {
    vec3 n = normalize(position);
    vec3 t = normalize(abs(n.y) > 0.98 ? cross(n, vec3(1.0, 0.0, 0.0)) : cross(n, vec3(0.0, 1.0, 0.0)));
    vec3 b = normalize(cross(n, t));
    const float e = 0.012;
    vec3 p0 = displace(n);
    vec3 p1 = displace(normalize(n + t * e));
    vec3 p2 = displace(normalize(n + b * e));
    vec3 nn = normalize(cross(p1 - p0, p2 - p0));
    if (dot(nn, n) < 0.0) nn = -nn;

    vDisp = length(p0) - 1.0;
    vec4 wp = modelMatrix * vec4(p0, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * nn);
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FORM_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uHue;
uniform vec3 uAccA;
uniform vec3 uAccB;
varying vec3 vNormalW;
varying vec3 vPosW;
varying float vDisp;

// Procedural dark studio: soft boxes and two colored strips give the metal something to reflect
vec3 env(vec3 r) {
    vec3 col = mix(vec3(0.012, 0.014, 0.02), vec3(0.05, 0.058, 0.075), smoothstep(-0.6, 0.8, r.y));
    col += vec3(1.0) * smoothstep(0.55, 0.95, r.y) * smoothstep(0.95, 0.15, abs(r.x)) * 1.5;
    col += vec3(0.9, 0.97, 1.0) * smoothstep(0.09, 0.0, abs(r.x - 0.62)) * smoothstep(-0.4, 0.6, r.y) * 1.3;
    col += uAccB * smoothstep(0.16, 0.0, abs(r.x + 0.68)) * smoothstep(-0.8, 0.4, r.y) * 1.1;
    col += uAccA * smoothstep(-0.15, -0.95, r.y) * 0.7;
    return col;
}

void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    vec3 R = reflect(-V, N);
    float ndv = max(dot(N, V), 0.0);
    float fres = pow(1.0 - ndv, 3.0);

    vec3 col = env(R) * vec3(0.82, 0.88, 0.95);

    // Thin-film shimmer that moves with the folds
    vec3 irid = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + fres * 1.1 + vDisp * 2.4 + uHue));
    col += irid * fres * 0.28;

    // Atmospheric rim
    col += mix(uAccA, uAccB, 0.5 + 0.5 * N.y) * fres * 0.85;

    col = 1.0 - exp(-col * 1.25);
    col = pow(col, vec3(1.0 / 2.2));
    gl_FragColor = vec4(col * uAlpha, uAlpha);
}
`;

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
    float d = length(vUv - 0.5) * 2.0;
    float g = pow(max(1.0 - d, 0.0), 2.4);
    gl_FragColor = vec4(uColor * g * uAlpha, 0.0);
}
`;

const DUST_VERT = /* glsl */ `
uniform float uTime;
uniform float uScroll;
uniform float uSize;
attribute float aSeed;
varying float vAlpha;
void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.05 + aSeed * 6.28) * 0.35;
    p.y += cos(uTime * 0.04 + aSeed * 3.1) * 0.35 + uScroll * (0.25 + aSeed * 0.5);
    p.y = mod(p.y + 6.0, 12.0) - 6.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.6 + aSeed) * (6.0 / -mv.z);
    vAlpha = 0.25 + 0.5 * aSeed;
}
`;

const DUST_FRAG = /* glsl */ `
uniform float uAlpha;
varying float vAlpha;
void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha * uAlpha;
    gl_FragColor = vec4(vec3(0.75, 0.9, 1.0) * a, 0.0);
}
`;

/* ---------- Story keyframes (x, y in half-viewport units; s = scale; a = opacity) ---------- */
// One entry per [data-chapter] section: hero, about, approach, experience, stack, work, education, contact
const KEYS_WIDE = [
    { x: 0.56, y: 0.08, s: 1.0, a: 1.0, amp: 0.26, hue: 0.0 },
    { x: -0.62, y: 0.28, s: 0.72, a: 0.75, amp: 0.22, hue: 0.2 },
    { x: 0.82, y: 0.02, s: 0.95, a: 0.7, amp: 0.36, hue: 0.45 },
    { x: 1.02, y: 0.3, s: 0.62, a: 0.3, amp: 0.26, hue: 0.62 },
    { x: -1.02, y: -0.2, s: 0.6, a: 0.28, amp: 0.26, hue: 0.8 },
    { x: 1.02, y: 0.45, s: 0.6, a: 0.28, amp: 0.28, hue: 0.4 },
    { x: -1.02, y: 0.1, s: 0.6, a: 0.28, amp: 0.26, hue: 0.22 },
    { x: 0.0, y: -0.06, s: 1.15, a: 0.3, amp: 0.34, hue: 0.08 },
];
const KEYS_NARROW = [
    { x: 0.0, y: 0.54, s: 0.56, a: 1.0, amp: 0.26, hue: 0.0 },
    { x: 0.35, y: 1.6, s: 0.55, a: 0.3, amp: 0.22, hue: 0.2 },
    { x: 0.2, y: -0.92, s: 0.6, a: 0.55, amp: 0.34, hue: 0.45 },
    { x: 1.05, y: 0.6, s: 0.45, a: 0.22, amp: 0.26, hue: 0.62 },
    { x: -1.05, y: -0.5, s: 0.45, a: 0.22, amp: 0.26, hue: 0.8 },
    { x: 1.05, y: 0.55, s: 0.45, a: 0.22, amp: 0.28, hue: 0.4 },
    { x: -1.05, y: -0.4, s: 0.45, a: 0.22, amp: 0.26, hue: 0.22 },
    { x: 0.0, y: 0.0, s: 0.8, a: 0.22, amp: 0.34, hue: 0.08 },
];
const KEY_FIELDS = ["x", "y", "s", "a", "amp", "hue"];

function init() {
    const canvas = document.querySelector("[data-stage]");
    const isSmallDevice = Math.min(window.innerWidth, window.innerHeight) < 600;
    const reduceMotion = F.reduceMotion;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    let pixelRatio = Math.min(window.devicePixelRatio, isSmallDevice ? 1.5 : 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 6);

    const accA = new THREE.Color("#4fd1e8");
    const accB = new THREE.Color("#a093ff");

    /* Form */
    const formUniforms = {
        uTime: { value: 0 },
        uAmp: { value: 0.3 },
        uFreq: { value: 0.95 },
        uPointer: { value: new THREE.Vector3(0, 0, 1) },
        uPointerAmt: { value: 0 },
        uAlpha: { value: 1 },
        uHue: { value: 0 },
        uAccA: { value: accA.clone() },
        uAccB: { value: accB.clone() },
    };
    const formMaterial = new THREE.ShaderMaterial({
        vertexShader: FORM_VERT,
        fragmentShader: FORM_FRAG,
        uniforms: formUniforms,
        transparent: true,
        premultipliedAlpha: true,
    });
    let detail = isSmallDevice ? 40 : 72;
    const form = new THREE.Mesh(new THREE.IcosahedronGeometry(1, detail), formMaterial);
    scene.add(form);

    /* Halo behind the form */
    const glowUniforms = { uColor: { value: accA.clone() }, uAlpha: { value: 0.5 } };
    const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
            vertexShader: GLOW_VERT,
            fragmentShader: GLOW_FRAG,
            uniforms: glowUniforms,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        })
    );
    glow.renderOrder = -1;
    scene.add(glow);

    /* Dust */
    const dustCount = isSmallDevice ? 110 : 240;
    const dustPos = new Float32Array(dustCount * 3);
    const dustSeed = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
        dustPos[i * 3] = (Math.random() - 0.5) * 16;
        dustPos[i * 3 + 1] = (Math.random() - 0.5) * 12;
        dustPos[i * 3 + 2] = -4 + Math.random() * 5;
        dustSeed[i] = Math.random();
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute("aSeed", new THREE.BufferAttribute(dustSeed, 1));
    const dustUniforms = { uTime: { value: 0 }, uScroll: { value: 0 }, uSize: { value: 3.2 * pixelRatio }, uAlpha: { value: 0.55 } };
    const dust = new THREE.Points(
        dustGeo,
        new THREE.ShaderMaterial({
            vertexShader: DUST_VERT,
            fragmentShader: DUST_FRAG,
            uniforms: dustUniforms,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        })
    );
    scene.add(dust);

    /* ---------- Sizing ---------- */
    let viewW = 1;
    let viewH = 1;
    let wide = true;
    const resize = () => {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        viewH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
        viewW = viewH * camera.aspect;
        wide = w >= 900;
        needsRender = true;
    };

    /* ---------- State ---------- */
    const cur = { x: 0, y: 0, s: 0.2, a: 0, amp: 0.3, hue: 0 };
    const target = { ...cur };
    const pointer = new THREE.Vector3();
    const pointerLocal = new THREE.Vector3(0, 0, 1);
    const invQuat = new THREE.Quaternion();
    let pointerAmt = 0;
    let tiltX = 0;
    let tiltY = 0;
    let time = Math.random() * 100;
    let last = performance.now();
    let needsRender = true;
    let lastStory = -1;
    let introT = reduceMotion ? 1 : 0;

    const smoothstep = (t) => t * t * (3 - 2 * t);

    const readStory = () => {
        const keys = wide ? KEYS_WIDE : KEYS_NARROW;
        const s = Math.min(Math.max(F.story, 0), keys.length - 1);
        const i = Math.min(Math.floor(s), keys.length - 2);
        const t = smoothstep(Math.min(Math.max(s - i, 0), 1));
        for (const k of KEY_FIELDS) target[k] = keys[i][k] + (keys[i + 1][k] - keys[i][k]) * t;
    };

    /* ---------- Adaptive quality ---------- */
    let quality = 2;
    let frames = [];
    let windowMs = 0;
    const watch = (ms) => {
        if (quality === 0 || reduceMotion) return;
        frames.push(ms);
        windowMs += ms;
        if (frames.length < 90 && (windowMs < 2000 || frames.length < 8)) return;
        const median = frames.sort((a, b) => a - b)[frames.length >> 1];
        frames = [];
        windowMs = 0;
        if (median <= 24) return;
        quality--;
        F.quality = quality;
        if (quality === 1) {
            pixelRatio = 1;
            renderer.setPixelRatio(1);
            resize();
            dust.visible = false;
        } else {
            detail = Math.round(detail / 2);
            form.geometry.dispose();
            form.geometry = new THREE.IcosahedronGeometry(1, detail);
        }
    };
    document.addEventListener("visibilitychange", () => {
        last = performance.now();
        frames = [];
        windowMs = 0;
    });

    /* ---------- Loop ---------- */
    let reported = false;
    const frame = (now) => {
        requestAnimationFrame(frame);
        const ms = now - last;
        const dt = Math.min(ms / 1000, 0.05);
        last = now;

        if (reduceMotion) {
            // Static form: only re-render when the story position changes
            if (F.story === lastStory && !needsRender) return;
            lastStory = F.story;
            readStory();
            Object.assign(cur, target);
        } else {
            time += dt;
            introT = Math.min(1, introT + dt / 2.2);
            readStory();
            // Frame-rate independent easing toward the story target
            const k = 1 - Math.exp(-dt * 3.2);
            for (const f of KEY_FIELDS) cur[f] += (target[f] - cur[f]) * k;
        }
        needsRender = false;

        const intro = smoothstep(introT);
        const px = cur.x * viewW * 0.5;
        const py = cur.y * viewH * 0.5;
        const scale = cur.s * 0.9 * (0.55 + 0.45 * intro);

        form.position.set(px, py, 0);
        form.scale.setScalar(scale);

        // Slow spin plus a tilt toward the cursor
        const p = F.pointer;
        if (!reduceMotion) {
            const kt = 1 - Math.exp(-dt * 2.5);
            tiltX += ((p.active ? -p.y * 0.35 : 0) - tiltX) * kt;
            tiltY += ((p.active ? p.x * 0.45 : 0) - tiltY) * kt;
        }
        form.rotation.set(tiltX + 0.25, time * 0.06 + F.story * 0.55 + tiltY, 0.12);

        // Cursor swells the surface on the side it is closest to
        pointer.set(p.x * viewW * 0.5, p.y * viewH * 0.5, 0);
        const dist = Math.hypot(pointer.x - px, pointer.y - py) / Math.max(scale, 0.2);
        const wantAmt = p.active && !reduceMotion ? 0.22 * Math.max(0, Math.min(1, (3.2 - dist) / 2.2)) : 0;
        pointerAmt += (wantAmt - pointerAmt) * (1 - Math.exp(-dt * 4));
        pointerLocal.set(pointer.x - px, pointer.y - py, 1.6 * scale).normalize();
        invQuat.copy(form.quaternion).invert();
        pointerLocal.applyQuaternion(invQuat);

        const alpha = cur.a * intro;
        formUniforms.uTime.value = time;
        formUniforms.uAmp.value = cur.amp;
        formUniforms.uAlpha.value = alpha;
        formUniforms.uHue.value = cur.hue;
        formUniforms.uPointer.value.copy(pointerLocal);
        formUniforms.uPointerAmt.value = pointerAmt;
        formUniforms.uAccA.value.copy(accA).lerp(accB, cur.hue * 0.6);
        formUniforms.uAccB.value.copy(accB).lerp(accA, cur.hue * 0.6);

        glow.position.set(px, py, -1.2);
        glow.scale.setScalar(scale * 5.2);
        glowUniforms.uAlpha.value = 0.32 * alpha;
        glowUniforms.uColor.value.copy(formUniforms.uAccA.value);

        dustUniforms.uTime.value = time;
        dustUniforms.uScroll.value = F.story;
        dustUniforms.uAlpha.value = 0.55 * intro;

        renderer.render(scene, camera);
        if (!reported) {
            reported = true;
            F.onReady();
        }
        if (introT >= 1) watch(ms);
    };

    new ResizeObserver(resize).observe(canvas);
    resize();
    readStory();
    Object.assign(cur, target, { a: 0 });
    requestAnimationFrame((t) => {
        last = t;
        frame(t);
    });
}

// Start last, once every shader and keyframe constant above is defined
if (F && !F.disabled) {
    try {
        init();
    } catch (error) {
        console.warn("WebGL form disabled:", error);
        document.documentElement.classList.add("no-webgl");
        F.onReady();
    }
}
