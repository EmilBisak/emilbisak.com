// WebGL backdrop: a ribbon of thin glowing lines that runs down the whole page.
// The ribbon lives in page space, so scrolling travels along it: sharp and bright
// in the hero, soft and out of focus behind content, weaving between the margins.
// Reads window.flow (main.js) for pointer and reduced motion.
import * as THREE from "three";

const F = window.flow;
const MAX_KEYS = 10;

/* ---------- Shaders ---------- */
const RIBBON_COMMON = /* glsl */ `
uniform vec2 uRes;
uniform float uUnit; // stable screen height: ignores mobile toolbar resizes
uniform float uPx; // CSS px per device pixel
uniform float uScroll;
uniform float uTime;
uniform vec3 uPointer; // xy in px, z = glow strength (0..1)
uniform float uAnchor[${MAX_KEYS}];
uniform vec4 uKeyA[${MAX_KEYS}]; // x (-1..1), spread (x width), blur (0..1), alpha
uniform vec4 uKeyB[${MAX_KEYS}]; // twist, hue, meander (0 = hold x, 1 = wander), focus drift
uniform float uBlend;

// Ribbon settings at a screen y: later anchors take over as they scroll past
void params(float y, out vec4 a, out vec4 b) {
    a = uKeyA[0];
    b = uKeyB[0];
    for (int i = 1; i < ${MAX_KEYS}; i++) {
        float k = smoothstep(uAnchor[i] - uBlend, uAnchor[i] + uBlend, y);
        a = mix(a, uKeyA[i], k);
        b = mix(b, uKeyB[i], k);
    }
    // Drift in and out of focus along the page, like a slow depth of field
    float doc = y + uScroll;
    a.z = clamp(a.z + b.w * sin(doc * 6.2832 / (uUnit * 1.9) + 0.7), 0.0, 1.0);
}

// Strands twist around each other like a ribbon turning in space (1 = flat, 0 = edge-on)
float twistAt(float doc, float seed, vec4 b) {
    return cos(doc * 0.0015 * b.x + uTime * 0.16 + seed * 0.9);
}

// Horizontal position of one strand at a screen y
float strandX(float y, float lane, float seed, vec4 a, vec4 b) {
    float doc = y + uScroll;
    float t = uTime;
    float w = uRes.x;
    float h = uUnit;
    // A slow meander across the whole page, measured in screen heights.
    // Long waves and a capped swing keep every bend wide and gentle.
    float amp = min(0.28 * w, 0.45 * h);
    float m = 0.5 * w
        + amp * sin(doc * 6.2832 / (h * 3.6) + 0.155)
        + amp * 0.15 * sin(doc * 6.2832 / (h * 2.1) + 1.1)
        + 0.02 * w * sin(doc * 0.0021 - t * 0.12);
    float x = mix((a.x * 0.5 + 0.5) * w, m, b.z);
    x += (sin(doc * 0.0019 + t * 0.21) * 0.02 + sin(doc * 0.0043 - t * 0.15 + 1.7) * 0.012) * w;

    float twist = twistAt(doc, seed, b);
    float spread = a.y * w * (0.7 + 0.3 * sin(doc * 0.0011 + 0.6));
    float off = (lane - 0.5) * spread * (0.18 + 0.82 * twist);
    off += sin(doc * 0.0062 + seed * 6.283 + t * 0.45) * spread * 0.07;

    // Hover: strands near the cursor drift apart a little, each by its own amount
    // (the matching glow is added in the vertex shader)
    float sx = x + off;
    float d = sx - uPointer.x + (seed - 0.5) * 6.0;
    float dy = y - uPointer.y;
    float stiff = 0.7 + 0.6 * fract(seed * 3.71);
    float part = 18.0 * d / sqrt(d * d + 64.0)
        * exp(-d * d / (2.0 * 160.0 * 160.0))
        * exp(-dy * dy / (2.0 * 120.0 * 120.0));
    return sx + part * uPointer.z * stiff;
}
`;

const RIBBON_VERT = /* glsl */ `
attribute float aT;
attribute float aSide;
attribute float aLane;
attribute float aSeed;
attribute float aDepth;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
varying float vDist;
varying float vSigma;
varying float vAmp;
varying vec3 vColor;
varying float vDoc;
varying float vY;
varying float vSeed;
${RIBBON_COMMON}

void main() {
    float y = mix(-0.15, 1.15, aT) * uRes.y;
    vec4 a, b;
    params(y, a, b);
    float x0 = strandX(y, aLane, aSeed, a, b);
    float x1 = strandX(y + 3.0, aLane, aSeed, a, b);
    // Hover: strands near the cursor glow a little brighter
    vec2 dp = vec2(x0, y) - uPointer.xy;
    float glow = exp(-dot(dp, dp) / (2.0 * 120.0 * 120.0)) * uPointer.z;
    vec2 tang = normalize(vec2(x1 - x0, 3.0));
    vec2 nrm = vec2(tang.y, -tang.x);

    // Depth of field: blur widens the line and spreads its light out
    float blur = clamp(a.z + aDepth * 0.4, 0.0, 1.0);
    float sigmaBase = mix(0.75, 16.0, blur * blur);
    // Never thinner than about a device pixel, so lines don't shimmer as they slide across pixels
    float sigma = sqrt(sigmaBase * sigmaBase + 0.2 * uPx * uPx);
    float half_ = sigma * 2.6 + 1.5 * uPx;
    // Soft strands overlap anyway, so draw fewer of them (each brighter) to save fill rate
    float keep = 1.0 - 0.7 * smoothstep(0.2, 0.9, blur);
    float r = fract(aSeed * 5.13) * 0.85;
    float on = smoothstep(r, r + 0.15, keep);
    half_ *= step(0.001, on);
    vec2 p = vec2(x0, y) + nrm * aSide * half_;

    vDist = aSide * half_;
    vSigma = sigma;
    // Where the ribbon turns edge-on its strands stack up, so each one dims to keep the glow even
    float flat_ = abs(0.18 + 0.82 * twistAt(y + uScroll, aSeed, b));
    vAmp = mix(0.3, 1.0, smoothstep(0.0, 0.6, flat_)) * on / keep * a.w * (0.35 + 0.65 * fract(aSeed * 7.31)) * pow(0.75 / sigmaBase, 0.6) * (1.0 - aDepth * 0.45);
    vAmp *= 1.0 + 0.7 * glow;
    vSeed = aSeed;
    vDoc = y + uScroll;
    vY = y;
    float h = fract(aLane + b.y + vDoc * 0.00004);
    vec3 col = mix(uColA, uColB, smoothstep(0.15, 0.85, h));
    col = mix(col, uColC, smoothstep(0.55, 1.0, abs(h - 0.5) * 2.0) * 0.6);
    col = mix(col, vec3(1.0), step(0.9, fract(aSeed * 3.17)) * 0.55);
    vColor = mix(col, vec3(1.0), glow * 0.25); // and warm toward white
    gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}
`;

const RIBBON_FRAG = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uPx;
uniform float uPulse;
varying float vSeed;
varying float vDist;
varying float vSigma;
varying float vAmp;
varying vec3 vColor;
varying float vDoc;
varying float vY;

float erf_(float x) {
    float x2 = x * x;
    float t = x2 * (1.2732395 + 0.147 * x2) / (1.0 + 0.147 * x2);
    return sign(x) * sqrt(1.0 - exp(-t));
}

void main() {
    float x = vDist;
    // Light the whole pixel the line passes through, not just its center: brightness stays
    // steady while the ribbon glides under the pixel grid
    float d = x / uPx;
    float s = vSigma / uPx * 1.4142;
    float core = 0.5 * (erf_((d + 0.5) / s) - erf_((d - 0.5) / s)) * s * 1.7725;
    float halo = exp(-x * x / (2.0 * pow(vSigma * 4.0 + 5.0, 2.0))) * 0.1;
    // Light pulses travel down the strands
    float pulse = pow(0.5 + 0.5 * sin(vDoc * 0.009 - uPulse + vSeed * 40.0), 8.0);
    float i = (core + halo) * vAmp * (0.7 + pulse * 0.9);
    i *= 1.0 - smoothstep(uReveal - 260.0, uReveal, vY);
    vec3 c = vColor * i;
    // Valid premultiplied output (color never above alpha) so the page composites it the same way every frame
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
}
`;

const SPARK_VERT = /* glsl */ `
attribute float aLane;
attribute float aSeed;
uniform float uSize;
varying float vAlpha;
${RIBBON_COMMON}

void main() {
    float span = uRes.y * 1.3;
    float y = mod(aSeed * span * 7.0 - uScroll - uTime * (8.0 + aSeed * 18.0), span) - uRes.y * 0.15;
    vec4 a, b;
    params(y, a, b);
    float x = strandX(y, aLane, aSeed, a, b) + sin(aSeed * 91.0) * a.y * uRes.x * 0.12;
    gl_Position = vec4(x / uRes.x * 2.0 - 1.0, 1.0 - y / uRes.y * 2.0, 0.0, 1.0);
    float tw = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 40.0);
    vAlpha = a.w * (1.0 - a.z * 0.8) * (0.25 + 0.75 * tw);
    gl_PointSize = uSize * (0.5 + fract(aSeed * 13.7));
}
`;

const SPARK_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    gl_FragColor = vec4(uColor * a, a);
}
`;

/* ---------- Ribbon keyframes, each anchored to the top of an element ---------- */
// a: [x (-1 left .. 1 right), spread (share of width), blur (0 sharp .. 1 haze), alpha]
// b: [twist, hue shift, meander (0 hold x .. 1 wander), focus drift]
// The hero holds the ribbon beside the headline; after that it wanders freely behind everything,
// sharp the whole way. Phones dim it a little behind text, since it crosses whole paragraphs there.
const KEYS_WIDE = [
    { at: "#top", a: [0.5, 0.2, 0.0, 1.0], b: [1.0, 0.0, 0.0, 0.0] },
    { at: ".stats", a: [0.5, 0.2, 0.0, 0.95], b: [1.1, 0.08, 1.0, 0.0] },
    { at: "#about", a: [0.0, 0.2, 0.0, 0.9], b: [1.2, 0.15, 1.0, 0.0] },
    { at: "#contact", a: [0.0, 0.22, 0.0, 1.0], b: [1.0, 0.05, 1.0, 0.0] },
];
const KEYS_NARROW = [
    { at: "#top", a: [0.55, 0.38, 0.0, 1.0], b: [1.0, 0.0, 0.0, 0.0] },
    { at: ".hero-copy", a: [0.6, 0.34, 0.0, 0.65], b: [1.0, 0.05, 0.5, 0.0] },
    { at: "#about", a: [0.0, 0.34, 0.0, 0.6], b: [1.2, 0.15, 1.0, 0.0] },
    { at: "#contact", a: [0.0, 0.38, 0.0, 0.75], b: [1.0, 0.05, 1.0, 0.0] },
];

function buildRibbon(lines, segments) {
    const verts = lines * (segments + 1) * 2;
    const aT = new Float32Array(verts);
    const aSide = new Float32Array(verts);
    const aLane = new Float32Array(verts);
    const aSeed = new Float32Array(verts);
    const aDepth = new Float32Array(verts);
    const index = [];
    let v = 0;
    for (let l = 0; l < lines; l++) {
        // Golden-ratio lanes: any prefix of lines still covers the whole ribbon
        const lane = (l * 0.618034 + 0.31) % 1;
        const seed = Math.random();
        const depth = Math.random() < 0.22 ? 0.5 + Math.random() * 0.5 : 0;
        for (let s = 0; s <= segments; s++) {
            for (const side of [-1, 1]) {
                aT[v] = s / segments;
                aSide[v] = side;
                aLane[v] = lane;
                aSeed[v] = seed;
                aDepth[v] = depth;
                v++;
            }
            if (s < segments) {
                const i = v - 2;
                index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
            }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geo.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
    geo.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
    geo.setAttribute("aLane", new THREE.BufferAttribute(aLane, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
    geo.setAttribute("aDepth", new THREE.BufferAttribute(aDepth, 1));
    geo.setIndex(index);
    return geo;
}

function init() {
    const canvas = document.querySelector("[data-stage]");
    const isSmallDevice = Math.min(window.innerWidth, window.innerHeight) < 600;
    const reduceMotion = F.reduceMotion;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "high-performance" });
    let pixelRatio = Math.min(window.devicePixelRatio, 1.5);
    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.Camera(); // shaders output clip space directly

    const shared = {
        uRes: { value: new THREE.Vector2(1, 1) },
        uUnit: { value: 1 },
        uPx: { value: 1 },
        uScroll: { value: 0 },
        uTime: { value: 0 },
        uPointer: { value: new THREE.Vector3(-9999, -9999, 0) },
        uAnchor: { value: new Array(MAX_KEYS).fill(1e7) },
        uKeyA: { value: Array.from({ length: MAX_KEYS }, () => new THREE.Vector4()) },
        uKeyB: { value: Array.from({ length: MAX_KEYS }, () => new THREE.Vector4()) },
        uBlend: { value: 400 },
    };

    /* Ribbon */
    const lineCount = isSmallDevice ? 44 : 72;
    const ribbonGeo = buildRibbon(lineCount, isSmallDevice ? 90 : 140);
    const ribbonUniforms = {
        ...shared,
        uReveal: { value: 0 },
        uPulse: { value: 0 },
        uColA: { value: new THREE.Color("#4fd1e8") },
        uColB: { value: new THREE.Color("#a093ff") },
        uColC: { value: new THREE.Color("#5f8dff") },
    };
    const ribbon = new THREE.Mesh(
        ribbonGeo,
        new THREE.ShaderMaterial({
            vertexShader: RIBBON_VERT,
            fragmentShader: RIBBON_FRAG,
            uniforms: ribbonUniforms,
            transparent: true,
            depthTest: false,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            premultipliedAlpha: true,
        })
    );
    ribbon.frustumCulled = false;
    scene.add(ribbon);

    /* Sparks drifting along the ribbon */
    const sparkCount = isSmallDevice ? 70 : 160;
    const sparkLane = new Float32Array(sparkCount);
    const sparkSeed = new Float32Array(sparkCount);
    for (let i = 0; i < sparkCount; i++) {
        sparkLane[i] = Math.random();
        sparkSeed[i] = Math.random();
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3));
    sparkGeo.setAttribute("aLane", new THREE.BufferAttribute(sparkLane, 1));
    sparkGeo.setAttribute("aSeed", new THREE.BufferAttribute(sparkSeed, 1));
    const sparkUniforms = { ...shared, uSize: { value: 4 * pixelRatio }, uColor: { value: new THREE.Color("#cfefff") } };
    const sparks = new THREE.Points(
        sparkGeo,
        new THREE.ShaderMaterial({
            vertexShader: SPARK_VERT,
            fragmentShader: SPARK_FRAG,
            uniforms: sparkUniforms,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            premultipliedAlpha: true,
        })
    );
    sparks.frustumCulled = false;
    scene.add(sparks);

    /* ---------- Layout: anchor keyframes to the page ---------- */
    let keys = KEYS_WIDE;
    let anchorsDoc = [];
    let needsRender = true;

    const measure = () => {
        const y = window.scrollY;
        anchorsDoc = keys.map((k, i) => {
            if (i === 0) return -1e7;
            const el = document.querySelector(k.at);
            return el ? el.getBoundingClientRect().top + y : 1e7;
        });
        for (let i = 0; i < MAX_KEYS; i++) {
            const k = keys[Math.min(i, keys.length - 1)];
            shared.uKeyA.value[i].set(...k.a);
            shared.uKeyB.value[i].set(...k.b);
        }
        needsRender = true;
    };

    const resize = () => {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        // The ribbon's shape is measured in screen heights; only re-measure when the width
        // changes, so a mobile toolbar sliding in and out never reshapes it mid-scroll
        if (w !== shared.uRes.value.x || shared.uUnit.value === 1) {
            shared.uUnit.value = h;
            shared.uBlend.value = Math.min(h * 0.45, 420);
        }
        shared.uRes.value.set(w, h);
        shared.uPx.value = 1 / pixelRatio;
        sparkUniforms.uSize.value = 4 * pixelRatio;
        const next = w >= 900 ? KEYS_WIDE : KEYS_NARROW;
        keys = next;
        measure();
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
            sparks.visible = false;
            resize();
        } else {
            // Golden-ratio lanes keep the ribbon full with half the strands
            ribbonGeo.setDrawRange(0, Math.floor(ribbonGeo.index.count / 2 / 6) * 6);
        }
    };

    /* ---------- Loop ---------- */
    let time = Math.random() * 50;
    let last = performance.now();
    let lastScroll = window.scrollY;
    let energy = 0;
    let pulse = 0; // integrated, so a change in scroll speed never makes the pulses jump
    // Hover glow: follows a softened cursor, fades in quickly and dies away slowly
    const ptr = { x: -9999, y: -9999, seen: false };
    let glow = 0;
    let reveal = reduceMotion ? 1 : 0;
    let reported = false;

    document.addEventListener("visibilitychange", () => {
        last = performance.now();
        frames = [];
        windowMs = 0;
    });

    const frame = (now) => {
        requestAnimationFrame(frame);
        const ms = now - last;
        const dt = Math.min(ms / 1000, 0.05);
        last = now;
        // Advance the smooth scroll first so the ribbon never lags the page by a frame
        if (F.stepScroll) F.stepScroll(now);
        const scroll = window.scrollY;
        const h = shared.uRes.value.y;

        if (reduceMotion) {
            // Still ribbon: only redraw when the page moves under it
            if (scroll === lastScroll && !needsRender) return;
        } else {
            time += dt;
            reveal = Math.min(1, reveal + dt / 1.8);
            const speed = Math.abs(scroll - lastScroll) / Math.max(dt, 0.001);
            energy += (Math.min(speed / 2500, 1) - energy) * (1 - Math.exp(-dt * (speed > energy ? 6 : 1.5)));
            pulse += dt * (1.6 + energy * 2.0);
            const p = F.pointer;
            const tx = ((p.x + 1) / 2) * shared.uRes.value.x;
            const ty = ((1 - p.y) / 2) * h;
            if (p.active && !ptr.seen) Object.assign(ptr, { x: tx, y: ty, seen: true });
            const kp = 1 - Math.exp(-dt * 8);
            ptr.x += (tx - ptr.x) * kp;
            ptr.y += (ty - ptr.y) * kp;
            const target = p.active ? 1 : 0;
            glow += (target - glow) * (1 - Math.exp(-dt * (target > glow ? 5 : 1.6)));
            shared.uPointer.value.set(ptr.x, ptr.y, glow);
        }
        lastScroll = scroll;
        needsRender = false;
        // Adapt quality before drawing: a resize clears the canvas, so never do it after a draw
        if (reveal >= 1) watch(ms);

        shared.uScroll.value = scroll;
        shared.uTime.value = time;
        for (let i = 0; i < MAX_KEYS; i++) shared.uAnchor.value[i] = i < anchorsDoc.length ? anchorsDoc[i] - scroll : 1e7;
        ribbonUniforms.uPulse.value = pulse;
        const r = reveal * reveal * (3 - 2 * reveal);
        ribbonUniforms.uReveal.value = -300 + r * (h * 1.3 + 600);

        renderer.render(scene, camera);
        if (!reported) {
            reported = true;
            F.onReady();
        }
    };

    new ResizeObserver(resize).observe(canvas);
    // Section heights shift as fonts and images load
    new ResizeObserver(measure).observe(document.body);
    resize();
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
        console.warn("WebGL ribbon disabled:", error);
        document.documentElement.classList.add("no-webgl");
        F.onReady();
    }
}
