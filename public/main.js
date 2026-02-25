import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ──────────────────────────────────────────────────────────────────────────────
// Scene & Renderer
// ──────────────────────────────────────────────────────────────────────────────

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010814);
scene.fog = new THREE.FogExp2(0x010814, 0.006);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 18, 48);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('map-container').appendChild(renderer.domElement);

const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 1.1;
bloomPass.strength = 1.2;
bloomPass.radius = 0.5;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// ──────────────────────────────────────────────────────────────────────────────
// Orbit Controls
// ──────────────────────────────────────────────────────────────────────────────

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.06;
orbitControls.minDistance = 5;
orbitControls.maxDistance = 140;
orbitControls.autoRotate = true;
orbitControls.autoRotateSpeed = 0.25;
orbitControls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE
};
// Right-click is reserved for pathfinding — disable right-pan
orbitControls.enablePan = true; // pan via middle-drag still works

// Stop auto-rotate on user interaction
renderer.domElement.addEventListener('pointerdown', () => { orbitControls.autoRotate = false; });

// ──────────────────────────────────────────────────────────────────────────────
// Lighting
// ──────────────────────────────────────────────────────────────────────────────

// Deep space ambient
scene.add(new THREE.AmbientLight(0x0a1428, 2.5));

// Main key light (slight blue-white)
const keyLight = new THREE.DirectionalLight(0xcce0ff, 1.2);
keyLight.position.set(30, 40, 20);
scene.add(keyLight);

// Warm fill from opposite side
const fillLight = new THREE.DirectionalLight(0xffcc99, 0.4);
fillLight.position.set(-30, -20, -30);
scene.add(fillLight);

// Central point light for dramatic planet shading
const coreLight = new THREE.PointLight(0x4488ff, 1.5, 120);
coreLight.position.set(0, 5, 0);
scene.add(coreLight);

// ──────────────────────────────────────────────────────────────────────────────
// Data & State
// ──────────────────────────────────────────────────────────────────────────────

let factionsData = {};
let planetsData = {};
let routesData = {};

// Map from planetId → { group, sphere, atmosphere, outerGlow }
let planetObjects = {};
// List of { mesh, baseOpacity, phase, routeId, originalColor } for route animations
let routeMeshes = [];
// routeId → index in routeMeshes for O(1) lookup
let routeIndexById = {};

let selectedPlanetId = null;

let playerShip;
let shipCurrentNode = 1; // ID of the planet the ship is orbitting
let travelTween = null;
let activeRouteResult = null;
let activeRouteHop = 0;

// ──────────────────────────────────────────────────────────────────────────────
// System View State
// ──────────────────────────────────────────────────────────────────────────────

let viewMode = 'galaxy'; // 'galaxy' | 'system' | 'transitioning' | 'planet'
let focusedSystemId = null;
let focusedPlanetBody = null;
let systemViewGroups = {};       // systemId → THREE.Group, lazy-created
let systemViewPlanets = [];       // active orbiting bodies
let cameraTransition = null;     // active tween object
let prevElapsed = 0;        // for delta-time calculation

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// ──────────────────────────────────────────────────────────────────────────────
// Starfield
// ──────────────────────────────────────────────────────────────────────────────

function createStarfield() {
    const COUNT = 4000;
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 150 + Math.random() * 300;
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
        color: 0xffffff, size: 0.35,
        sizeAttenuation: true, transparent: true, opacity: 0.85,
    });
    return new THREE.Points(geo, mat);
}

// ──────────────────────────────────────────────────────────────────────────────
// Nebula Background Clouds
// ──────────────────────────────────────────────────────────────────────────────

function createNebulae() {
    // Disabled generic Sprite-based nebulae as they render as heavy rectangles under UnrealBloomPass
}

// ──────────────────────────────────────────────────────────────────────────────
// Planet Creation
// ──────────────────────────────────────────────────────────────────────────────

function createPlanet(planetData, faction) {
    const group = new THREE.Group();
    group.position.set(planetData.x, planetData.y, planetData.z);

    const factionColor = new THREE.Color(faction.color);
    const glowColor = new THREE.Color(faction.glowColor);
    const emissiveColor = factionColor.clone().multiplyScalar(0.35);

    // ── Core sphere ──
    const geo = new THREE.SphereGeometry(planetData.size, 40, 40);
    const mat = new THREE.MeshStandardMaterial({
        color: factionColor,
        emissive: emissiveColor,
        emissiveIntensity: 0.5,
        roughness: faction.roughness ?? 0.8,
        metalness: faction.metalness ?? 0.15,
    });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.userData = { isPlanet: true, planetId: planetData.planetId };
    group.add(sphere);

    // ── Thin atmosphere shell (inside-facing for halo glow) ──
    const atmosGeo = new THREE.SphereGeometry(planetData.size * 1.12, 32, 32);
    const atmosMat = new THREE.MeshStandardMaterial({
        color: glowColor,
        emissive: glowColor,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.20,
        side: THREE.BackSide,
        depthWrite: false,
    });
    const atmosphere = new THREE.Mesh(atmosGeo, atmosMat);
    group.add(atmosphere);

    // ── Outer glow shell (large, additive, BackSide) ──
    const outerGlowGeo = new THREE.SphereGeometry(planetData.size * 1.8, 24, 24);
    const outerGlowMat = new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0.08,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const outerGlow = new THREE.Mesh(outerGlowGeo, outerGlowMat);
    group.add(outerGlow);

    // ── Orbit ring (thin torus) ──
    const ringGeo = new THREE.TorusGeometry(planetData.size * 1.6, 0.015, 6, 64);
    const ringMat = new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.4;
    ring.rotation.z = (Math.random() - 0.5) * 0.4;
    group.add(ring);

    planetObjects[planetData.planetId] = { group, sphere, atmosphere, outerGlow };
    return group;
}

// ──────────────────────────────────────────────────────────────────────────────
// Star System View Generation
// ──────────────────────────────────────────────────────────────────────────────

function makeRNG(seed) {
    let s = (seed * 2147483647) >>> 0;
    return () => {
        s = Math.imul(s, 1664525) + 1013904223 >>> 0;
        return s / 4294967296;
    };
}

function weightedChoice(rng, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
    return weights.length - 1;
}

const STAR_TYPES = [
    { name: 'Yellow Dwarf', colorLow: 0x5a0a00, colorMid: 0xff3c00, colorHigh: 0xffffd2, color: 0xfffbe0, glowColor: 0xffee88, size: 0.48, intensity: 3.5 },
    { name: 'Red Dwarf', colorLow: 0x220000, colorMid: 0x881100, colorHigh: 0xff5533, color: 0xff7744, glowColor: 0xff5533, size: 0.30, intensity: 2.0 },
    { name: 'Blue Giant', colorLow: 0x001133, colorMid: 0x0055ff, colorHigh: 0xcceeff, color: 0xbbddff, glowColor: 0x88ccff, size: 0.70, intensity: 5.5 },
    { name: 'Orange Giant', colorLow: 0x550000, colorMid: 0xff5500, colorHigh: 0xffddaa, color: 0xff9944, glowColor: 0xff7722, size: 0.72, intensity: 3.8 },
    { name: 'White Dwarf', colorLow: 0x223344, colorMid: 0x88aacc, colorHigh: 0xffffff, color: 0xeeeeff, glowColor: 0xccddff, size: 0.22, intensity: 4.5 },
];

// --- SHADER SOURCE FOR STARS ---
const starVS = `
    varying vec3 vPosition;
    varying vec3 vNormal;
    void main() {
        vPosition = position;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const starFS = `
    uniform float uTime;
    uniform vec3 uColorLow;
    uniform vec3 uColorMid;
    uniform vec3 uColorHigh;
    uniform vec3 uGlow;

    varying vec3 vPosition;
    varying vec3 vNormal;

    // --- 3D NOISE FUNCTION ---
    vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
    vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

    float snoise(vec3 v){ 
      const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
      const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

      vec3 i  = floor(v + dot(v, C.yyy) );
      vec3 x0 =   v - i + dot(i, C.xxx) ;

      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min( g.xyz, l.zxy );
      vec3 i2 = max( g.xyz, l.zxy );

      vec3 x1 = x0 - i1 + 1.0 * C.xxx;
      vec3 x2 = x0 - i2 + 2.0 * C.xxx;
      vec3 x3 = x0 - 1. + 3.0 * C.xxx;

      i = mod(i, 289.0 ); 
      vec4 p = permute( permute( permute( 
                 i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
               + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
               + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

      float n_ = 1.0/7.0;
      vec3  ns = n_ * D.wyz - D.xzx;

      vec4 j = p - 49.0 * floor(p * ns.z *ns.z);

      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_ );

      vec4 x = x_ *ns.x + ns.yyyy;
      vec4 y = y_ *ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);

      vec4 b0 = vec4( x.xy, y.xy );
      vec4 b1 = vec4( x.zw, y.zw );

      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));

      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

      vec3 p0 = vec3(a0.xy,h.x);
      vec3 p1 = vec3(a0.zw,h.y);
      vec3 p2 = vec3(a1.xy,h.z);
      vec3 p3 = vec3(a1.zw,h.w);

      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;

      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                    dot(p2,x2), dot(p3,x3) ) );
    }

    void main() {
        // 1. Get 3D Noise (Smooth, larger scale)
        float n = snoise(vPosition * 1.5 + uTime * 0.05);
        n += snoise(vPosition * 3.0 - uTime * 0.1) * 0.5;
        
        // Normalize noise to 0.0 - 1.0 range
        float brightness = n * 0.5 + 0.5;

        // 2. Cinematic Color Ramp (Using existing dynamic uniforms)
        vec3 finalColor = mix(uColorLow, uColorMid, brightness);
        finalColor = mix(finalColor, uColorHigh, pow(brightness, 3.0));

        // 3. Limb Darkening (Fresnel)
        float dotProduct = max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
        float limb = pow(dotProduct, 0.8); // Limb darkening smooth edge
        finalColor *= limb;

        // Add a tiny bit of the atmospheric glow back at the absolute rim
        finalColor += uGlow * pow(1.0 - dotProduct, 4.0) * 0.4;

        // 4. Boost the output for the Bloom Pass
        gl_FragColor = vec4(finalColor * 2.0, 1.0);
    }
`;


const textureLoader = new THREE.TextureLoader();
const planetTextures = {
    molten: textureLoader.load('textures/molten.png'),
    rocky: textureLoader.load('textures/rocky.png'),
    ocean: textureLoader.load('textures/ocean.png'),
    desert: textureLoader.load('textures/desert.png'),
    gas: textureLoader.load('textures/gas.png'),
    ice: textureLoader.load('textures/ice.png'),
    terran: textureLoader.load('textures/terran.png'),
    ring: textureLoader.load('textures/ring.png'),
    asteroids: textureLoader.load('textures/asteroids.png'),
};
Object.values(planetTextures).forEach(t => {
    t.colorSpace = THREE.SRGBColorSpace;
});

const BODY_TYPES = [
    { name: 'Molten Rock', color: 0xdd4422, roughness: 0.55, metalness: 0.45, atmColor: 0xff5522, atmOpacity: 0.25, tex: 'molten' },
    { name: 'Rocky World', color: 0x997755, roughness: 0.90, metalness: 0.10, tex: 'rocky' },
    { name: 'Ocean World', color: 0x1155aa, roughness: 0.40, metalness: 0.10, atmColor: 0x55aaff, atmOpacity: 0.45, tex: 'ocean' },
    { name: 'Desert World', color: 0xcc9944, roughness: 0.90, metalness: 0.05, atmColor: 0xffcc88, atmOpacity: 0.35, tex: 'desert' },
    { name: 'Gas Giant', color: 0xcc8844, roughness: 0.30, metalness: 0.10, isGas: true, atmColor: 0xffddaa, atmOpacity: 0.3, tex: 'gas' },
    { name: 'Ice World', color: 0xaaccee, roughness: 0.50, metalness: 0.20, atmColor: 0xddffff, atmOpacity: 0.35, tex: 'ice' },
    { name: 'Terran World', color: 0x335588, roughness: 0.65, metalness: 0.15, atmColor: 0x66bbff, atmOpacity: 0.55, tex: 'terran' },
];

function createSystemView(systemData, faction) {
    const group = new THREE.Group();
    group.position.set(systemData.x, systemData.y, systemData.z);

    const rng = makeRNG(systemData.planetId * 13 + faction.factionId * 7);

    // ── Star type (weighted random, seeded) ──
    const starIdx = weightedChoice(rng, [3, 2, 1, 2, 1]);
    const starType = STAR_TYPES[starIdx];

    // ── Central Star(s) ──
    const starGroup = new THREE.Group();
    group.add(starGroup);

    const isBinary = rng() > 0.8; // 20% chance of binary stars
    let displayStarType = starType.name;

    // Star 1
    const star1Geo = new THREE.IcosahedronGeometry(starType.size, 15);

    // Calculate color ramps from base star config
    const cGlow = new THREE.Color(starType.glowColor);

    const uni1 = {
        uTime: { value: 0.0 },
        uColorLow: { value: new THREE.Color(starType.colorLow) },
        uColorMid: { value: new THREE.Color(starType.colorMid) },
        uColorHigh: { value: new THREE.Color(starType.colorHigh) },
        uGlow: { value: cGlow }
    };
    const star1Mat = new THREE.ShaderMaterial({
        uniforms: uni1,
        vertexShader: starVS,
        fragmentShader: starFS
    });

    const star1 = new THREE.Mesh(star1Geo, star1Mat);
    star1.userData = {
        isSystemBody: true,
        isStar: true,
        name: systemData.name + (isBinary ? ' A' : ' Prime Star'),
        type: starType.name,
        color: starType.glowColor,
        desc: `The primary star of the ${systemData.name} system. Its intense radiation provides the energy needed to sustain life, or harvest exotic particles.`
    };
    starGroup.add(star1);

    const interactableMeshes = [star1];

    // Star 1 Corona & Halo
    star1.add(new THREE.PointLight(new THREE.Color(starType.color), starType.intensity, 35));

    const starUniforms = [uni1];

    if (isBinary) {
        const star2Type = STAR_TYPES[Math.floor(rng() * STAR_TYPES.length)];
        const s2Size = star2Type.size * (0.5 + rng() * 0.5); // Secondary star is smaller

        const star2Geo = new THREE.IcosahedronGeometry(s2Size, 15);

        const c2Glow = new THREE.Color(star2Type.glowColor);
        const uni2 = {
            uTime: { value: 0.0 },
            uColorLow: { value: new THREE.Color(star2Type.colorLow) },
            uColorMid: { value: new THREE.Color(star2Type.colorMid) },
            uColorHigh: { value: new THREE.Color(star2Type.colorHigh) },
            uGlow: { value: c2Glow }
        };
        const star2Mat = new THREE.ShaderMaterial({
            uniforms: uni2,
            vertexShader: starVS,
            fragmentShader: starFS
        });
        const star2 = new THREE.Mesh(star2Geo, star2Mat);
        star2.userData = {
            isSystemBody: true,
            isStar: true,
            name: systemData.name + ' B',
            type: star2Type.name,
            color: star2Type.glowColor,
            desc: `The secondary star in the ${systemData.name} binary system.`
        };

        star2.add(new THREE.PointLight(new THREE.Color(star2Type.color), star2Type.intensity * 0.6, 35));

        const dist = starType.size + s2Size + 0.5;
        star1.position.x = -dist * (s2Size / (starType.size + s2Size));
        star2.position.x = dist * (starType.size / (starType.size + s2Size));

        starGroup.add(star2);
        interactableMeshes.push(star2);
        starUniforms.push(uni2);
        displayStarType = `Binary (${starType.name} / ${star2Type.name})`;
    }

    // ── Orbiting bodies ──
    const bodyCount = Math.floor(rng() * 4) + 1 + Math.floor(rng() * 4) + 1; // 2d4 (2-8 planets, mean 5)

    // Star mass proxy for Goldilocks spacing & velocity (GM)
    const starMass = starType.intensity;

    // Base orbit start - push out further for massive/binary stars
    let currentOrbitRadius = starType.size * 1.5 + (starMass * 0.4);
    if (isBinary) currentOrbitRadius += 1.8;

    const orbitBodies = [];
    let beltR = 0;

    for (let i = 0; i < bodyCount; i++) {
        // Titius-Bode inspired spacing: orbits get naturally wider the further out you go
        const minDistance = 0.8;
        const spacingMultiplier = 0.4 + (i * 0.25); // Spacing grows as we move outwards
        const randomOffset = 0.5 + (rng() * 1.5);

        // Advance the radius for this planet relative to star mass (hotter stars push planets out)
        currentOrbitRadius += minDistance + (randomOffset * spacingMultiplier * (starMass * 0.25));

        // If we want an asteroid belt, slot it after planet 1 or 2 and push the next planet further out
        if (i === 1 && bodyCount >= 3 && rng() > 0.4) {
            beltR = currentOrbitRadius + 1.2;
            currentOrbitRadius += 2.2; // Extra gap for the debris field
        }

        const orbitRadius = currentOrbitRadius;

        // Keplerian velocity v = sqrt(GM/r)
        // Add slight RNG variance so it isn't perfectly clinical
        const orbitSpeed = Math.sqrt(starMass / orbitRadius) * (0.35 + rng() * 0.15);

        const orbitAngle = rng() * Math.PI * 2;
        const orbitTilt = (rng() - 0.5) * 0.18; // slight inclination

        // Pick body type by orbital zone
        let btIdx;
        if (i === 0) btIdx = rng() > 0.5 ? 0 : 1;
        else if (i === bodyCount - 1 && i > 1) btIdx = rng() > 0.5 ? 5 : 4;
        else btIdx = Math.floor(rng() * BODY_TYPES.length);
        const bt = BODY_TYPES[btIdx];

        const bodyRadius = bt.isGas ? 0.20 + rng() * 0.14 : 0.055 + rng() * 0.085;

        // Orbital path ring
        const orbitRingGeo = new THREE.TorusGeometry(orbitRadius, 0.006, 6, 128);
        const orbitRingMat = new THREE.MeshBasicMaterial({
            color: 0x223344, transparent: true, opacity: 0.28, depthWrite: false,
        });
        const orbitRing = new THREE.Mesh(orbitRingGeo, orbitRingMat);
        orbitRing.rotation.x = Math.PI / 2 + orbitTilt;
        group.add(orbitRing);

        // Body mesh
        const bodyGeo = new THREE.SphereGeometry(bodyRadius, 24, 24);
        const bodyMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0xffffff),
            map: planetTextures[bt.tex] || null,
            emissive: new THREE.Color(bt.color).multiplyScalar(0.04),
            emissiveIntensity: 0.3,
            roughness: bt.roughness, metalness: bt.metalness ?? 0.05,
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        const romanNumerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX", "XXX"];
        const romanNumeral = romanNumerals[i] || (i + 1);
        const pName = `${systemData.name} ${romanNumeral}`;
        body.userData = {
            isSystemBody: true,
            name: pName,
            type: bt.name,
            color: bt.color,
            desc: `A ${bt.name.toLowerCase()} orbiting ${systemData.name}. It presents various opportunities and hazards to explorers.`
        };
        interactableMeshes.push(body);

        // Gas giant ring
        if (bt.isGas && rng() > 0.35) {
            const innerR = bodyRadius * 1.3;
            const outerR = bodyRadius * 3.2;
            const grGeo = new THREE.RingGeometry(innerR, outerR, 64);
            const grMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(bt.color).lerp(new THREE.Color(0xffffff), 0.6),
                map: planetTextures.ring,
                alphaMap: planetTextures.ring,
                transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
                blending: THREE.NormalBlending
            });
            const gr = new THREE.Mesh(grGeo, grMat);
            gr.rotation.x = Math.PI / 2 + (rng() - 0.5) * 0.4;
            body.add(gr);
        }

        body.userData.orbiters = [];
        // Moon
        if (!bt.isGas && rng() > 0.55 && i > 0) {
            const moonR = bodyRadius * 0.38;
            const moonDst = bodyRadius * 2.8;
            const moonGeo = new THREE.SphereGeometry(moonR, 12, 12);
            const moonMat = new THREE.MeshStandardMaterial({ color: 0x778899, roughness: 0.95, metalness: 0.05 });
            const moon = new THREE.Mesh(moonGeo, moonMat);
            moon.position.set(moonDst, 0, 0);
            moon.visible = false;

            moon.userData = {
                isSystemBody: true,
                isOrbiter: true,
                name: pName + "a",
                type: "Natural Satellite",
                color: 0x778899,
                desc: `A barren natural satellite tidally locked to ${pName}. Often used as a staging ground or secret cache.`
            };
            interactableMeshes.push(moon);
            body.userData.orbiters.push(moon);
            body.add(moon);
        }

        // Space Station
        if (!bt.isGas && rng() > 0.7) {
            const stSize = bodyRadius * 0.4;
            const stGeo = new THREE.CylinderGeometry(stSize, stSize, stSize * 0.6, 8);
            const stMat = new THREE.MeshStandardMaterial({ color: faction.color, emissive: faction.glowColor, emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.8 });
            const st = new THREE.Mesh(stGeo, stMat);
            st.position.set(-bodyRadius * 2.2, bodyRadius * 1.5, 0);
            st.rotation.z = Math.PI / 4;
            st.visible = false;

            st.userData = {
                isSystemBody: true,
                isOrbiter: true,
                name: faction.name + " Outpost",
                type: "Space Station",
                color: faction.glowColor,
                desc: `An orbital station controlled by the ${faction.name}. Serves as a refuelling depot and defensive listening post.`
            };
            interactableMeshes.push(st);
            body.userData.orbiters.push(st);
            body.add(st);
        }

        // Atmosphere visual
        if (bt.atmColor) {
            const atmGeo = new THREE.SphereGeometry(bodyRadius * 1.15, 24, 24);
            const atmMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(bt.atmColor),
                transparent: true, opacity: bt.atmOpacity,
                blending: THREE.AdditiveBlending,
                side: THREE.BackSide, depthWrite: false
            });
            body.add(new THREE.Mesh(atmGeo, atmMat));

            // Outer softer planetary halo
            const outerGeo = new THREE.SphereGeometry(bodyRadius * 1.35, 16, 16);
            const outerMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(bt.atmColor),
                transparent: true, opacity: bt.atmOpacity * 0.35,
                blending: THREE.AdditiveBlending,
                side: THREE.BackSide, depthWrite: false
            });
            body.add(new THREE.Mesh(outerGeo, outerMat));
        }

        // Starting position on orbit
        body.position.set(
            Math.cos(orbitAngle) * orbitRadius,
            Math.sin(orbitTilt) * orbitRadius * 0.12,
            Math.sin(orbitAngle) * orbitRadius,
        );
        group.add(body);
        orbitBodies.push({ mesh: body, orbitRadius, orbitSpeed, orbitAngle, orbitTilt });
    }

    // Asteroid belt after the inner rocky zone
    const beltMeshes = [];
    if (beltR > 0) {

        // Inner belt (less dense / transparent)
        const innerBeltGeo = new THREE.RingGeometry(beltR - 0.5, beltR + 0.3, 64);
        const innerBeltMat = new THREE.MeshBasicMaterial({
            color: 0xaa9988,
            map: planetTextures.asteroids,
            alphaMap: planetTextures.asteroids,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.NormalBlending
        });
        const innerBelt = new THREE.Mesh(innerBeltGeo, innerBeltMat);
        innerBelt.rotation.x = Math.PI / 2;
        beltMeshes.push({ mesh: innerBelt, speed: 0.04 });
        group.add(innerBelt);

        // Outer belt (denser edge)
        const outerBeltGeo = new THREE.RingGeometry(beltR - 0.1, beltR + 0.8, 64);
        const outerBeltMat = new THREE.MeshBasicMaterial({
            color: 0xc2b2a2,
            map: planetTextures.asteroids,
            alphaMap: planetTextures.asteroids,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.NormalBlending
        });
        const outerBelt = new THREE.Mesh(outerBeltGeo, outerBeltMat);
        outerBelt.rotation.x = Math.PI / 2;
        outerBelt.rotation.z = Math.PI / 3; // offset texture
        beltMeshes.push({ mesh: outerBelt, speed: 0.05 });
        group.add(outerBelt);
    }

    group.userData = { orbitBodies, starType: { name: displayStarType }, bodyCount, systemId: systemData.planetId, interactableMeshes, starGroup, beltMeshes, starUniforms };
    group.visible = false;
    return group;
}

// ──────────────────────────────────────────────────────────────────────────────
// Route Creation
// ──────────────────────────────────────────────────────────────────────────────

function createRoute(routeData, fromPlanet, toPlanet, fromFaction, toFaction) {
    const from = new THREE.Vector3(fromPlanet.x, fromPlanet.y, fromPlanet.z);
    const to = new THREE.Vector3(toPlanet.x, toPlanet.y, toPlanet.z);

    // Curved midpoint — offset perpendicular to add arc feel
    const mid = from.clone().lerp(to, 0.5);
    const perp = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4,
    );
    mid.add(perp);

    const curve = new THREE.CatmullRomCurve3([from, mid, to]);
    const radius = 0.025 + ((routeData.size || 1) * 0.012);
    const geo = new THREE.TubeGeometry(curve, 40, radius, 5, false);

    // Blend faction colors for cross-faction routes
    const fromColor = new THREE.Color(fromFaction.glowColor);
    const toColor = new THREE.Color(toFaction.glowColor);
    const routeColor = fromColor.clone().lerp(toColor, 0.5);

    const baseOpacity = routeData.security === 'unknown' ? 0.15 : 0.35;
    const mat = new THREE.MeshBasicMaterial({
        color: routeColor,
        transparent: true,
        opacity: baseOpacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const tube = new THREE.Mesh(geo, mat);
    const entry = { mesh: tube, curve: curve, baseOpacity, phase: Math.random() * Math.PI * 2, routeId: routeData.routeId, originalColor: routeColor.clone() };
    routeIndexById[routeData.routeId] = routeMeshes.length;
    routeMeshes.push(entry);
    return tube;
}

// ──────────────────────────────────────────────────────────────────────────────
// UI: Legend
// ──────────────────────────────────────────────────────────────────────────────

function buildLegend() {
    const container = document.getElementById('legend-items');
    Object.values(factionsData).forEach(faction => {
        const el = document.createElement('div');
        el.className = 'legend-item';
        el.innerHTML = `
            <span class="legend-dot" style="background:${faction.glowColor};box-shadow:0 0 7px ${faction.glowColor}80"></span>
            <span>${faction.name}</span>
        `;
        container.appendChild(el);
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// UI: Planet Info Panel
// ──────────────────────────────────────────────────────────────────────────────

function showPlanetInfo(planetId) {
    const planet = planetsData[planetId];
    const faction = factionsData[planet.factionId];

    document.getElementById('planet-name').textContent = planet.name;
    document.getElementById('planet-faction').textContent = faction.name;
    document.getElementById('planet-faction').style.color = faction.glowColor;
    document.getElementById('planet-description').textContent = planet.description;

    const badge = document.getElementById('faction-badge');
    badge.style.background = faction.glowColor;
    badge.style.boxShadow = `0 0 12px ${faction.glowColor}`;

    // Connected routes
    const connections = Object.values(routesData).filter(
        r => r.fromId === planetId || r.toId === planetId
    );
    const connHTML = connections.map(r => {
        const otherId = r.fromId === planetId ? r.toId : r.fromId;
        const other = planetsData[otherId];
        return `
            <div class="conn-item">
                <span class="conn-dot sec-${r.security}"></span>
                <span>${other.name}</span>
                <span class="conn-sec">${r.security}</span>
            </div>`;
    }).join('');
    document.getElementById('planet-connections').innerHTML =
        `<div class="conn-title">Connected Systems (${connections.length})</div>${connHTML}`;

    document.getElementById('info-panel').classList.remove('hidden');
    selectedPlanetId = planetId;

    // Highlight selected planet
    highlightPlanet(planetId);
}

function hidePlanetInfo() {
    document.getElementById('info-panel').classList.add('hidden');
    resetHighlight();
    selectedPlanetId = null;
}

let currentSystemBodyIndex = -1;

function showBodyInfo(index) {
    currentSystemBodyIndex = index;
    const sysGroup = systemViewGroups[focusedSystemId];
    if (!sysGroup || !sysGroup.userData.interactableMeshes) return;
    const bodyData = sysGroup.userData.interactableMeshes[index].userData;

    document.getElementById('body-name').textContent = bodyData.name;
    document.getElementById('body-type').textContent = bodyData.type;
    document.getElementById('body-description').textContent = bodyData.desc;

    const badge = document.getElementById('body-color-badge');
    badge.style.background = '#' + new THREE.Color(bodyData.color).getHexString();
    badge.style.boxShadow = `0 0 12px ${badge.style.background}`;

    document.getElementById('body-info-panel').classList.remove('hidden');

    if (viewMode === 'planet') {
        const bodyObj = getActiveBodyList()[index];
        if (bodyObj) enterPlanetView(bodyObj);
    } else {
        hideSystemUI();
    }
}

function hideBodyInfo() {
    document.getElementById('body-info-panel').classList.add('hidden');
    if (viewMode === 'planet') {
        exitPlanetView();
    }
}

function getActiveBodyList() {
    const sysGroup = systemViewGroups[focusedSystemId];
    if (!sysGroup || !sysGroup.userData.interactableMeshes) return [];

    // In planet view, only tab between the planet and its moons/orbiters
    if (viewMode === 'planet' && focusedPlanetBody) {
        let root = focusedPlanetBody;
        if (root.userData.isOrbiter) root = root.parent;
        const orbiters = root.userData.orbiters ? root.userData.orbiters : [];
        return [root, ...orbiters];
    }

    return sysGroup.userData.interactableMeshes;
}

function prevBody() {
    const list = getActiveBodyList();
    if (!list.length) return;
    let newIndex = currentSystemBodyIndex - 1;
    if (newIndex < 0) newIndex = list.length - 1;

    // For system view, we must map this restricted index back to the global interactableMeshes index to show correctly
    const sysGroup = systemViewGroups[focusedSystemId];
    const globalIndex = sysGroup.userData.interactableMeshes.indexOf(list[newIndex]);
    if (globalIndex !== -1) showBodyInfo(globalIndex);
}

function nextBody() {
    const list = getActiveBodyList();
    if (!list.length) return;
    let newIndex = currentSystemBodyIndex + 1;
    if (newIndex >= list.length) newIndex = 0;

    // For system view, we must map this restricted index back to the global interactableMeshes index to show correctly
    const sysGroup = systemViewGroups[focusedSystemId];
    const globalIndex = sysGroup.userData.interactableMeshes.indexOf(list[newIndex]);
    if (globalIndex !== -1) showBodyInfo(globalIndex);
}

function highlightPlanet(planetId) {
    Object.entries(planetObjects).forEach(([id, obj]) => {
        const isSelected = parseInt(id) === planetId;
        obj.sphere.material.emissiveIntensity = isSelected ? 1.2 : 0.2;
    });
}

function resetHighlight() {
    Object.values(planetObjects).forEach(obj => {
        obj.sphere.material.emissiveIntensity = 0.2;
    });
}



// ──────────────────────────────────────────────────────────────────────────────
// System View Navigation
// ──────────────────────────────────────────────────────────────────────────────

function startCameraTransition(endPos, endTarget, duration, onComplete) {
    cameraTransition = {
        startPos: camera.position.clone(),
        endPos,
        startTarget: orbitControls.target.clone(),
        endTarget,
        duration,
        elapsed: 0,
        onComplete,
    };
    orbitControls.enabled = false;
}

function enterSystemView(systemId) {
    if (viewMode !== 'galaxy') return;
    viewMode = 'transitioning';
    focusedSystemId = systemId;
    clearPath();
    hidePlanetInfo();

    const sys = planetsData[systemId];
    const sysPos = new THREE.Vector3(sys.x, sys.y, sys.z);

    // Lazy-create the star system geometry
    if (!systemViewGroups[systemId]) {
        systemViewGroups[systemId] = createSystemView(sys, factionsData[sys.factionId]);
        scene.add(systemViewGroups[systemId]);
    }

    // Camera glide: approach from current direction, stop 7 units away
    const dir = camera.position.clone().sub(sysPos).normalize();
    const endPos = sysPos.clone().add(dir.multiplyScalar(7));

    // Dim galaxy while travelling
    Object.values(planetObjects).forEach(o => { o.group.visible = false; });
    routeMeshes.forEach(r => { r.mesh.visible = false; });
    if (playerShip) playerShip.visible = false;
    systemViewGroups[systemId].visible = true;

    document.getElementById('controls-hint').textContent =
        '⎌ ESC / Back to return to galaxy · Drag to orbit · Scroll to zoom';

    startCameraTransition(endPos, sysPos, 1.8, () => {
        viewMode = 'system';
        systemViewPlanets = systemViewGroups[systemId].userData.orbitBodies;
        orbitControls.enabled = true;
        orbitControls.target.copy(sysPos);
        orbitControls.minDistance = 1.5;
        orbitControls.maxDistance = 60; // Allowed to zoom out further
        showSystemUI(systemId);

        document.getElementById('controls-hint').textContent = '⎌ ESC / Back to return to galaxy · Double-click planet to zoom in · Scroll to zoom';
        document.getElementById('system-back-btn').textContent = '← Galaxy Map';
    });
}

function enterPlanetView(bodyMesh) {
    if (viewMode !== 'system') return;
    viewMode = 'transitioning';
    focusedPlanetBody = bodyMesh;
    hideSystemUI();
    hideBodyInfo();

    if (bodyMesh.userData.orbiters) {
        bodyMesh.userData.orbiters.forEach(o => o.visible = true);
    }

    // Calculate world position manually relative to group
    const sysPos = new THREE.Vector3(planetsData[focusedSystemId].x, planetsData[focusedSystemId].y, planetsData[focusedSystemId].z);
    const targetPos = sysPos.clone().add(bodyMesh.position);

    const dir = camera.position.clone().sub(targetPos).normalize();
    const endPos = targetPos.clone().add(dir.multiplyScalar(0.7));

    orbitControls.enabled = false;
    startCameraTransition(endPos, targetPos, 1.2, () => {
        viewMode = 'planet';
        orbitControls.enabled = true;
        orbitControls.target.copy(targetPos);
        orbitControls.minDistance = 0.2;
        orbitControls.maxDistance = 5;

        document.getElementById('controls-hint').textContent = '⎌ ESC / Back to return to system center';
        document.getElementById('system-back-btn').textContent = '← System View';
        document.getElementById('system-back-btn').classList.remove('hidden');
    });
}

function exitPlanetView() {
    if (viewMode !== 'planet') return;
    viewMode = 'transitioning';
    hideBodyInfo();

    if (focusedPlanetBody && focusedPlanetBody.userData.orbiters) {
        focusedPlanetBody.userData.orbiters.forEach(o => o.visible = false);
    }

    const sys = planetsData[focusedSystemId];
    const sysPos = new THREE.Vector3(sys.x, sys.y, sys.z);

    const targetPos = sysPos.clone().add(focusedPlanetBody.position);
    const dir = camera.position.clone().sub(sysPos).normalize();
    if (dir.lengthSq() < 0.001) dir.set(0, 0, 1);
    const endPos = sysPos.clone().add(dir.multiplyScalar(10));

    orbitControls.enabled = false;
    startCameraTransition(endPos, sysPos, 1.2, () => {
        viewMode = 'system';
        focusedPlanetBody = null;
        orbitControls.enabled = true;
        orbitControls.target.copy(sysPos);
        orbitControls.minDistance = 1.5;
        orbitControls.maxDistance = 60;
        showSystemUI(focusedSystemId);

        document.getElementById('controls-hint').textContent = '⎌ ESC / Back to return to galaxy · Double-click planet to zoom in · Scroll to zoom';
        document.getElementById('system-back-btn').textContent = '← Galaxy Map';
        document.getElementById('global-back-btn').classList.remove('hidden');
    });
}

function handleSystemBackBtn() {
    if (viewMode === 'planet') exitPlanetView();
    else if (viewMode === 'system') exitSystemView();
}

function exitSystemView() {
    if (viewMode !== 'system') return;
    viewMode = 'transitioning';
    hideSystemUI();
    hideBodyInfo();
    orbitControls.enabled = false;

    const endPos = new THREE.Vector3(0, 18, 48);
    const endTarget = new THREE.Vector3(0, 0, 0);

    startCameraTransition(endPos, endTarget, 2.2, () => {
        Object.values(planetObjects).forEach(o => { o.group.visible = true; });
        routeMeshes.forEach(r => { r.mesh.visible = true; });
        if (playerShip) playerShip.visible = true;
        if (systemViewGroups[focusedSystemId]) systemViewGroups[focusedSystemId].visible = false;

        viewMode = 'galaxy';
        focusedSystemId = null;
        systemViewPlanets = [];

        orbitControls.target.copy(endTarget);
        orbitControls.minDistance = 5;
        orbitControls.maxDistance = 140;
        orbitControls.enabled = true;
        document.getElementById('controls-hint').textContent =
            '🖱 Drag · Scroll to zoom · Left-click planet for info · Right-click to set path';
        document.getElementById('global-back-btn').classList.add('hidden');
    });
}

function showSystemUI(systemId) {
    const sys = planetsData[systemId];
    const faction = factionsData[sys.factionId];
    const sv = systemViewGroups[systemId];
    const starType = sv.userData.starType;

    document.getElementById('sys-name').textContent = sys.name;
    document.getElementById('sys-faction').textContent = faction.name;
    document.getElementById('sys-faction').style.color = faction.glowColor;
    document.getElementById('sys-star-type').textContent = starType.name;
    document.getElementById('sys-body-count').textContent = sv.userData.bodyCount + ' bodies';
    document.getElementById('sys-desc').textContent = sys.description;
    document.getElementById('system-ui').classList.remove('hidden');
}

function hideSystemUI() {
    document.getElementById('system-ui').classList.add('hidden');
}

// ──────────────────────────────────────────────────────────────────────────────
// Pathfinding
// ──────────────────────────────────────────────────────────────────────────────

let pathOriginId = null;
let pathDestinId = null;
let pathRouteIds = new Set();
let pathMarkers = []; // { mesh, group } torus rings added to planet groups

function bfsPath(fromId, toId) {
    // Build adjacency list
    const adj = {};
    Object.values(planetsData).forEach(p => { adj[p.planetId] = []; });
    Object.values(routesData).forEach(r => {
        adj[r.fromId].push({ id: r.toId, routeId: r.routeId });
        adj[r.toId].push({ id: r.fromId, routeId: r.routeId });
    });

    if (fromId === toId) return { planets: [fromId], routes: [] };

    const visited = new Set([fromId]);
    const queue = [{ id: fromId, planets: [fromId], routes: [] }];

    while (queue.length) {
        const { id, planets, routes } = queue.shift();
        for (const nb of (adj[id] ?? [])) {
            if (nb.id === toId) return { planets: [...planets, toId], routes: [...routes, nb.routeId] };
            if (!visited.has(nb.id)) {
                visited.add(nb.id);
                queue.push({ id: nb.id, planets: [...planets, nb.id], routes: [...routes, nb.routeId] });
            }
        }
    }
    return null; // no path
}

function addPathMarker(planetId, hexColor) {
    const planet = planetsData[planetId];
    const pObj = planetObjects[planetId];
    const r = planet.size * 2.1;
    const geo = new THREE.TorusGeometry(r, 0.09, 8, 64);
    const mat = new THREE.MeshBasicMaterial({ color: hexColor, transparent: true, opacity: 0.9, depthWrite: false });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = Math.PI / 2;
    pObj.group.add(ring);
    pathMarkers.push({ mesh: ring, group: pObj.group });
    return ring;
}

function clearPathVisuals() {
    pathMarkers.forEach(({ mesh, group }) => group.remove(mesh));
    pathMarkers = [];
    pathRouteIds.clear();
}

function clearPath() {
    clearPathVisuals();
    pathOriginId = null;
    pathDestinId = null;
    activeRouteResult = null;
    activeRouteHop = 0;

    if (travelTween && playerShip) {
        travelTween = null;
        if (planetsData[shipCurrentNode]) {
            const p = planetsData[shipCurrentNode];
            playerShip.position.set(p.x, p.y + p.size + 1.2, p.z);
            playerShip.rotation.set(0, 0, 0);
        }
    }

    updatePathHUD();
}

function setOrigin(planetId) {
    clearPath();
    pathOriginId = planetId;
    addPathMarker(planetId, 0x00ff88); // green
    updatePathHUD();
}

function setDestination(planetId) {
    pathDestinId = planetId;
    addPathMarker(planetId, 0xff4444); // red

    const result = bfsPath(pathOriginId, pathDestinId);
    if (result) {
        activeRouteResult = result;
        activeRouteHop = 0;
        result.routes.forEach(id => pathRouteIds.add(id));
        // Cyan rings for intermediate planets
        result.planets.slice(1, -1).forEach(id => addPathMarker(id, 0x44ccff));
        updatePathHUD(activeRouteResult);
    } else {
        updatePathHUD(null, true);
    }
}

function checkTravelConditions() {
    const cb = document.querySelector('.hop-cb'); // we only show one checkbox at a time now
    let canTravel = true;
    if (cb && !cb.checked) canTravel = false;

    const btn = document.getElementById('travel-btn');
    if (btn) {
        if (canTravel && activeRouteResult && activeRouteHop < activeRouteResult.routes.length) {
            btn.classList.remove('hidden');
            btn.textContent = activeRouteHop === 0 ? 'ENGAGE TRAVEL 🚀' : 'CONTINUE TRANSIT 🚀';
        } else {
            btn.classList.add('hidden');
        }
    }
}

function updatePathHUD(result, noPath = false) {
    const hud = document.getElementById('path-hud');
    const status = document.getElementById('path-status');
    const detail = document.getElementById('path-detail');
    const btn = document.getElementById('travel-btn');

    if (!pathOriginId) {
        hud.classList.add('hidden');
        detail.classList.add('hidden');
        if (btn) btn.classList.add('hidden');
        return;
    }
    hud.classList.remove('hidden');

    const oName = planetsData[pathOriginId].name;

    // Waiting for destination
    if (!pathDestinId) {
        status.innerHTML = `<span class="ph-origin">⬤ ${oName}</span><span class="ph-arrow">→</span><span class="ph-hint">right-click destination</span>`;
        detail.classList.add('hidden');
        if (btn) btn.classList.add('hidden');
        return;
    }

    const dName = planetsData[pathDestinId].name;

    // No route found
    if (noPath) {
        status.innerHTML = `<span class="ph-origin">⬤ ${oName}</span><span class="ph-arrow">→</span><span class="ph-dest">⬤ ${dName}</span><span class="ph-noresult">✕ No route</span>`;
        detail.classList.add('hidden');
        if (btn) btn.classList.add('hidden');
        return;
    }

    // ── Summary pill ──
    const hops = result.routes.length;
    status.innerHTML = `<span class="ph-origin">⬤ ${oName}</span><span class="ph-arrow">→</span><span class="ph-dest">⬤ ${dName}</span><span class="ph-hops">${hops} hop${hops !== 1 ? 's' : ''}</span>`;

    // ── Hop detail cards ──
    const cards = result.routes.map((routeId, i) => {
        const route = routesData[routeId];
        const fromPlanet = planetsData[result.planets[i]];
        const toPlanet = planetsData[result.planets[i + 1]];
        const fromFac = factionsData[fromPlanet.factionId];
        const toFac = factionsData[toPlanet.factionId];

        const ctrl = route.controllingFactionId ? factionsData[route.controllingFactionId] : null;
        const ctrlHTML = ctrl
            ? `<span class="hop-ctrl-dot" style="color:${ctrl.glowColor}">◉</span><span>Controlled by <strong style="color:${ctrl.glowColor}">${ctrl.name}</strong></span>`
            : `<span class="hop-ctrl-dot" style="color:#ddc844">◉</span><span style="color:#ddc844">Contested — no single controlling faction</span>`;

        const access = route.security || 'Medium';
        let cbHTML = '';

        if (i < activeRouteHop) {
            cbHTML = `<div class="checkbox-row" style="color:#00e87a; font-weight:600;">✓ Transit Completed</div>`;
        } else if (i > activeRouteHop) {
            cbHTML = `<div class="checkbox-row" style="color:#666">Pending Arrival...</div>`;
        } else {
            if (access === 'High') {
                const isChecked = localStorage.getItem(`perm_${route.routeId}`) !== 'false';
                cbHTML = `<div class="checkbox-row"><input type="checkbox" class="hop-cb" data-id="perm_${route.routeId}" data-type="permission" ${isChecked ? 'checked' : ''}> Sector Authority Permission</div>`;
            } else if (access === 'Medium') {
                cbHTML = `<div class="checkbox-row"><input type="checkbox" class="hop-cb" data-type="temporal"> Temporary Transit Pass</div>`;
            } else if (access === 'Low') {
                cbHTML = `<div class="checkbox-row"><input type="checkbox" class="hop-cb" data-type="temporal"> Gate Bribe Paid</div>`;
            }
        }

        const accessText = access === 'High' ? '✕ High Security' : (access === 'Medium' ? '⊡ Medium Security' : '◈ Low Security');
        const activeStyle = i === activeRouteHop ? 'border-left: 3px solid #00e87a; background: rgba(0, 232, 122, 0.05);' : '';

        return `
        <div class="hop-card" style="${activeStyle}">
            <div class="hop-number">Hop ${i + 1} of ${hops}</div>
            <div class="hop-route">
                <span style="color:${fromFac.glowColor}">${fromPlanet.name}</span>
                <span class="hop-route-arrow">——▶</span>
                <span style="color:${toFac.glowColor}">${toPlanet.name}</span>
            </div>
            <div class="hop-ctrl">${ctrlHTML}</div>
            <div class="hop-access access-${access.toLowerCase()}">${accessText}</div>
            <div class="hop-desc">Distance: ${route.distance} lightyears</div>
            ${cbHTML}
        </div>`;
    }).join('');

    detail.innerHTML = cards;
    detail.classList.remove('hidden');

    document.querySelectorAll('.hop-cb').forEach(cb => {
        cb.addEventListener('change', (e) => {
            if (e.target.dataset.type === 'permission') {
                localStorage.setItem(e.target.dataset.id, e.target.checked);
            }
            checkTravelConditions();
        });
    });

    checkTravelConditions();
}

function travelNextHop() {
    if (!activeRouteResult || !playerShip || activeRouteHop >= activeRouteResult.routes.length) return;

    document.getElementById('travel-btn').classList.add('hidden');

    const rId = activeRouteResult.routes[activeRouteHop];
    const curve = routeMeshes[routeIndexById[rId]].curve;
    const fromP = planetsData[activeRouteResult.planets[activeRouteHop]];
    const fromVec = new THREE.Vector3(fromP.x, fromP.y, fromP.z);
    const p0 = curve.getPoint(0);
    const isReversed = p0.distanceTo(fromVec) > 0.1;

    travelTween = {
        curve,
        isReversed,
        progress: 0,
        duration: 2.0
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Event Handlers
// ──────────────────────────────────────────────────────────────────────────────

// Track pointer movement to distinguish click from drag
let pointerDownPos = { x: 0, y: 0 };
let isDragClick = false;

function onPointerDown(event) {
    pointerDownPos = { x: event.clientX, y: event.clientY };
    isDragClick = false;
}

function onPointerMove(event) {
    const dx = event.clientX - pointerDownPos.x;
    const dy = event.clientY - pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) isDragClick = true;
}

let isSystemPaused = false;

function onCanvasClick(event) {
    if (isDragClick) return; // was a drag, not a click

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = (event.clientY / window.innerHeight) * -2 + 1;
    raycaster.setFromCamera(mouse, camera);

    if (viewMode === 'system' || viewMode === 'planet') {
        const sysGroup = systemViewGroups[focusedSystemId];
        if (sysGroup && sysGroup.userData.interactableMeshes) {
            const hits = raycaster.intersectObjects(sysGroup.userData.interactableMeshes, true);
            if (hits.length > 0) {
                let hitObj = hits[0].object;
                while (hitObj && !hitObj.userData.isSystemBody) hitObj = hitObj.parent;

                if (hitObj && hitObj.userData.isSystemBody) {
                    const index = sysGroup.userData.interactableMeshes.indexOf(hitObj);
                    if (index !== -1) showBodyInfo(index);
                } else {
                    hideBodyInfo();
                    isSystemPaused = !isSystemPaused; // Toggle pause on background click
                }
            } else {
                hideBodyInfo();
                isSystemPaused = !isSystemPaused; // Toggle pause on background click
            }
        }
        return;
    }

    // Galaxy view handling
    const spheres = Object.values(planetObjects).map(o => o.sphere);
    const hits = raycaster.intersectObjects(spheres);

    if (hits.length > 0 && hits[0].object.userData.isPlanet) {
        showPlanetInfo(hits[0].object.userData.planetId);
    } else {
        hidePlanetInfo();
    }
}

function onContextMenu(event) {
    event.preventDefault();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = (event.clientY / window.innerHeight) * -2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const objectsToTest = Object.values(planetObjects).map(o => o.sphere);
    if (playerShip) objectsToTest.push(playerShip);
    const hits = raycaster.intersectObjects(objectsToTest);

    if (hits.length > 0) {
        if (hits[0].object.userData.isShip) {
            setOrigin(shipCurrentNode);
        } else if (hits[0].object.userData.isPlanet) {
            const planetId = hits[0].object.userData.planetId;
            if (!pathOriginId) {
                // Let user set origin from ship dynamically if they misclick, but default to ship origin for ease if desired.
                // For now, if they click a planet without origin, just set ship as origin, or the planet itself if they want.
                // Assuming ship is main focus:
                if (shipCurrentNode === planetId) {
                    setOrigin(shipCurrentNode);
                } else {
                    setOrigin(planetId);
                }
            } else if (planetId === pathOriginId) {
                clearPath(); // right-click origin again → cancel
            } else if (!pathDestinId) {
                setDestination(planetId);
            } else {
                setDestination(planetId);
            }
        }
    } else {
        clearPath();
    }
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function onCanvasDblClick(event) {
    if (viewMode === 'galaxy') {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = (event.clientY / window.innerHeight) * -2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const spheres = Object.values(planetObjects).map(o => o.sphere);
        const hits = raycaster.intersectObjects(spheres);
        if (hits.length > 0 && hits[0].object.userData.isPlanet) {
            enterSystemView(hits[0].object.userData.planetId);
        }
    } else if (viewMode === 'system') {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = (event.clientY / window.innerHeight) * -2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const sysGroup = systemViewGroups[focusedSystemId];
        if (sysGroup && sysGroup.userData.interactableMeshes) {
            const hits = raycaster.intersectObjects(sysGroup.userData.interactableMeshes, true);
            if (hits.length > 0) {
                let hitObj = hits[0].object;
                while (hitObj && !hitObj.userData.isSystemBody) hitObj = hitObj.parent;

                if (hitObj && hitObj.userData.isSystemBody) {
                    if (!hitObj.userData.isStar && hitObj.userData.type !== "Asteroid Belt" && !hitObj.userData.isOrbiter) {
                        enterPlanetView(hitObj);
                    }
                }
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Loading Screen
// ──────────────────────────────────────────────────────────────────────────────

function injectLoadingScreen() {
    const el = document.createElement('div');
    el.id = 'loading';
    el.innerHTML = `<div class="spinner"></div><h2>Initializing Star Chart…</h2>`;
    document.body.appendChild(el);
    return el;
}

function removeLoadingScreen(el) {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 700);
}

// ──────────────────────────────────────────────────────────────────────────────
// Initialization
// ──────────────────────────────────────────────────────────────────────────────

async function init() {
    const loadingEl = injectLoadingScreen();

    // Load all data concurrently
    const [factions, planets, routes] = await Promise.all([
        fetch('data/factions.json').then(r => r.json()),
        fetch('data/planets.json').then(r => r.json()),
        fetch('data/routes.json').then(r => r.json()),
    ]);

    factions.forEach(f => factionsData[f.factionId] = f);
    planets.forEach(p => planetsData[p.planetId] = p);
    routes.forEach(r => routesData[r.routeId] = r);

    // Add Player Ship
    const shipGeo = new THREE.ConeGeometry(0.8, 1.8, 4);
    shipGeo.rotateX(Math.PI / 2);
    const shipMat = new THREE.MeshStandardMaterial({
        color: 0xffaa00,
        emissive: 0xff8800,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.8
    });
    playerShip = new THREE.Mesh(shipGeo, shipMat);
    playerShip.userData.isShip = true;

    if (planetsData[shipCurrentNode]) {
        const p = planetsData[shipCurrentNode];
        playerShip.position.set(p.x, p.y + p.size + 1.2, p.z);
    }
    scene.add(playerShip);

    // Background
    scene.add(createStarfield());
    createNebulae();

    // Routes (draw behind planets — add first)
    routes.forEach(route => {
        const from = planetsData[route.fromId];
        const to = planetsData[route.toId];
        if (!from || !to) return;
        const fromFaction = factionsData[from.factionId];
        const toFaction = factionsData[to.factionId];
        scene.add(createRoute(route, from, to, fromFaction, toFaction));
    });

    // Planets
    planets.forEach(planet => {
        const faction = factionsData[planet.factionId];
        scene.add(createPlanet(planet, faction));
    });

    // UI
    buildLegend();

    // Events
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('click', onCanvasClick);
    renderer.domElement.addEventListener('dblclick', onCanvasDblClick);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);
    document.getElementById('close-panel').addEventListener('click', hidePlanetInfo);
    document.getElementById('close-body-panel').addEventListener('click', hideBodyInfo);
    document.getElementById('prev-body-btn').addEventListener('click', prevBody);
    document.getElementById('next-body-btn').addEventListener('click', nextBody);
    document.getElementById('path-clear-btn').addEventListener('click', clearPath);
    document.getElementById('system-back-btn').addEventListener('click', handleSystemBackBtn);
    document.getElementById('travel-btn').addEventListener('click', () => {
        if (!travelTween) travelNextHop();
    });

    document.getElementById('global-back-btn').addEventListener('click', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    window.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (viewMode === 'planet') exitPlanetView();
            else if (viewMode === 'system') exitSystemView();
            else clearPath();
        }
    });
    window.addEventListener('resize', onResize);

    // Update controls hint
    document.getElementById('controls-hint').textContent =
        '🖱 Drag · Scroll to zoom · Left-click system for info · Right-click to set path · Double-click to zoom in';

    removeLoadingScreen(loadingEl);
    animate();
}

// ──────────────────────────────────────────────────────────────────────────────
// Animation Loop
// ──────────────────────────────────────────────────────────────────────────────

const clock = new THREE.Clock();
let prevElapsedRef = 0; // track previous time for delta

function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    const delta = Math.min(t - prevElapsedRef, 0.1);
    prevElapsedRef = t;

    // ── Camera transition tween ──
    if (cameraTransition) {
        cameraTransition.elapsed += delta;
        const prog = Math.min(cameraTransition.elapsed / cameraTransition.duration, 1);
        const ease = prog < 0.5 ? 2 * prog * prog : -1 + (4 - 2 * prog) * prog;
        camera.position.lerpVectors(cameraTransition.startPos, cameraTransition.endPos, ease);
        orbitControls.target.lerpVectors(cameraTransition.startTarget, cameraTransition.endTarget, ease);
        if (prog >= 1) {
            const cb = cameraTransition.onComplete;
            cameraTransition = null;
            if (cb) cb();
        }
    }

    // ── Galaxy view: rotate system nodes ──
    if (viewMode === 'galaxy') {
        Object.values(planetObjects).forEach((obj, i) => {
            obj.sphere.rotation.y += 0.0015 + i * 0.0001;
            obj.sphere.rotation.x += 0.0003;
        });
        routeMeshes.forEach(({ mesh, baseOpacity, phase, routeId, originalColor }) => {
            const onPath = pathRouteIds.has(routeId);
            if (onPath) {
                mesh.material.color.set(0xffffff);
                mesh.material.opacity = 0.65 + 0.25 * Math.sin(t * 2.5 + phase);
            } else {
                mesh.material.color.copy(originalColor);
                mesh.material.opacity = (pathRouteIds.size > 0 ? 0.08 : baseOpacity) + 0.08 * Math.sin(t * 0.7 + phase);
            }
        });
        pathMarkers.forEach(({ mesh }, i) => {
            mesh.rotation.z += 0.012;
            mesh.material.opacity = 0.7 + 0.3 * Math.sin(t * 3 + i * 1.2);
        });
        coreLight.intensity = 1.3 + 0.3 * Math.sin(t * 0.4);

        // ── Ship Travel Animation ──
        if (travelTween && playerShip) {
            travelTween.progress += delta / travelTween.duration;
            if (travelTween.progress >= 1.0) {
                // Transit hop complete
                activeRouteHop++;
                shipCurrentNode = activeRouteResult.planets[activeRouteHop];
                const finalP = planetsData[shipCurrentNode];
                playerShip.position.set(finalP.x, finalP.y + finalP.size + 1.2, finalP.z);
                playerShip.rotation.set(0, 0, 0);
                travelTween = null;

                // End of whole route?
                if (activeRouteHop >= activeRouteResult.routes.length) {
                    clearPath();
                } else {
                    updatePathHUD(activeRouteResult);
                }
            }
            if (travelTween) {
                const p = Math.max(0, Math.min(1, travelTween.progress));
                const evalT = travelTween.isReversed ? 1 - p : p;
                const pt = travelTween.curve.getPoint(evalT);
                playerShip.position.copy(pt);

                if (p < 0.99) {
                    const nextT = travelTween.isReversed ? 1 - (p + 0.01) : (p + 0.01);
                    const ptNext = travelTween.curve.getPoint(Math.max(0, Math.min(1, nextT)));
                    playerShip.lookAt(ptNext);
                }
            }
        } else if (!travelTween && playerShip) {
            // Idle ship bob
            const sp = planetsData[shipCurrentNode];
            if (sp) {
                playerShip.position.y = sp.y + sp.size + 1.2 + Math.sin(t * 2.5) * 0.3;
                playerShip.rotation.y += delta * 0.8;
            }
        }
    }

    // ── System view / Planet view: orbit bodies ──
    if (viewMode === 'system' || viewMode === 'planet' || viewMode === 'transitioning') {
        const sysGroup = systemViewGroups[focusedSystemId];

        if (!isSystemPaused) {
            if (sysGroup && sysGroup.userData.starGroup) {
                sysGroup.userData.starGroup.rotation.y += 0.25 * delta;
                if (sysGroup.userData.starUniforms) {
                    sysGroup.userData.starUniforms.forEach(u => u.uTime.value += delta * 1.5);
                }
            }
            if (sysGroup && sysGroup.userData.beltMeshes) {
                sysGroup.userData.beltMeshes.forEach(b => {
                    b.mesh.rotation.z += b.speed * delta;
                });
            }

            if (viewMode === 'system' || viewMode === 'transitioning') {
                systemViewPlanets.forEach((p, i) => {
                    p.orbitAngle += p.orbitSpeed * delta;
                    p.mesh.position.set(
                        Math.cos(p.orbitAngle) * p.orbitRadius,
                        Math.sin(p.orbitTilt) * p.orbitRadius * 0.12,
                        Math.sin(p.orbitAngle) * p.orbitRadius,
                    );
                    p.mesh.rotation.y += 0.004 + i * 0.001;
                });
            }

            if ((viewMode === 'planet' || viewMode === 'transitioning') && focusedPlanetBody) {
                focusedPlanetBody.rotation.y += 0.08 * delta;
                if (focusedPlanetBody.userData.orbiters) {
                    focusedPlanetBody.userData.orbiters.forEach((o, i) => {
                        o.rotation.y += 0.1 * delta;
                    });
                }
            }
        } else {
            // Keep object tracking updated while paused so arrows keys work
            if (viewMode === 'system' || viewMode === 'transitioning') {
                systemViewPlanets.forEach((p, i) => {
                    p.mesh.position.set(
                        Math.cos(p.orbitAngle) * p.orbitRadius,
                        Math.sin(p.orbitTilt) * p.orbitRadius * 0.12,
                        Math.sin(p.orbitAngle) * p.orbitRadius,
                    );
                });
            }
        }
    }

    orbitControls.update();
    composer.render();
}

// ──────────────────────────────────────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────────────────────────────────────

init().catch(err => {
    console.error('Galaxy map init failed:', err);
});
