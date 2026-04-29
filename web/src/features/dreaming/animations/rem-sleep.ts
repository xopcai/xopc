/**
 * 🌈 REM Sleep — "Star-map dreaming"
 *
 * Imagery: Stars (memory shards) scattered in the night sky; faint violet links appear between them—
 * surfacing hidden ties (pattern clustering). Micro-nebulae bloom at line intersections.
 * A sweeping aurora curtain drifts along the horizon; clusters merge with soft attract–merge motion.
 *
 * Technique: Particle stars + dynamic LineSegments + full-screen shader (aurora + nebula).
 * Palette: violet / aurora #7c4dff → #e040fb.
 */
import * as THREE from 'three';

import type { PhaseAnimation } from './types';
import { FULLSCREEN_VERTEX_SHADER, createFullscreenQuad } from './types';

const STAR_BG_FRAGMENT = /* glsl */ `
  uniform float time;
  uniform float globalOpacity;
  uniform vec2 resolution;

  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p *= 2.1;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = resolution.x / resolution.y;

    // Deep space gradient: darker overall so it stays nocturnal in light theme
    vec3 zenith = vec3(0.05, 0.018, 0.12);      // deep violet sky
    vec3 horizon = vec3(0.018, 0.012, 0.055);   // near black
    vec3 nadir = vec3(0.01, 0.006, 0.028);      // abyss
    vec3 bg = mix(nadir, horizon, smoothstep(0.0, 0.3, uv.y));
    bg = mix(bg, zenith, smoothstep(0.4, 0.9, uv.y));

    // Twinkling background stars (tiny fixed dots via hash)
    for (int layer = 0; layer < 3; layer++) {
      float scale = 80.0 + float(layer) * 40.0;
      vec2 grid = floor(uv * scale);
      float starHash = hash(grid + float(layer) * 17.3);
      // Use step() instead of if-branch for GPU-friendly branchless execution
      float isVisible = step(0.97, starHash);
      vec2 starPos = (grid + 0.5) / scale;
      float dist = length((uv - starPos) * vec2(aspect, 1.0)) * scale;
      float twinkle = sin(time * (1.5 + starHash * 3.0) + starHash * 20.0) * 0.4 + 0.6;
      float brightness = exp(-dist * dist * 4.0) * twinkle * (0.3 + starHash * 0.7);
      bg += vec3(0.6, 0.5, 0.9) * brightness * 0.3 * isVisible;
    }

    // Nebula clouds: rich ink-wash style cosmic gas
    float neb1 = fbm(uv * 2.5 + time * 0.03);
    float neb2 = fbm(uv * 3.5 - time * 0.02 + 5.0);
    float neb3 = fbm(uv * 1.8 + vec2(time * 0.04, -time * 0.02) + 10.0);
    float nebulaMask = neb1 * neb2;

    vec3 nebulaViolet = vec3(0.35, 0.15, 0.8);   // deep violet
    vec3 nebulaPink = vec3(0.7, 0.15, 0.7);       // magenta
    vec3 nebulaCyan = vec3(0.15, 0.4, 0.7);       // teal accent
    vec3 nebula = nebulaViolet * nebulaMask * 0.1;
    nebula += nebulaPink * neb3 * neb1 * 0.06;
    nebula += nebulaCyan * neb2 * neb3 * 0.04;
    bg += nebula;

    // Aurora curtain: sweeping bands across the sky
    float auroraY = uv.y * 0.7 + 0.3;
    float wave1 = sin(uv.x * 6.0 + time * 0.25 + sin(uv.x * 3.0 + time * 0.1) * 2.0);
    float wave2 = sin(uv.x * 4.0 - time * 0.15 + cos(uv.x * 5.0 - time * 0.08) * 1.5);
    float auroraShape = smoothstep(-0.2, 0.8, wave1 * 0.5 + wave2 * 0.3);
    float auroraFade = smoothstep(0.3, 0.7, auroraY) * smoothstep(1.0, 0.7, auroraY);
    float aurora = auroraShape * auroraFade * 0.08;

    // Aurora color shifts: green to purple to pink
    float auroraHue = sin(uv.x * 3.0 + time * 0.2) * 0.5 + 0.5;
    vec3 auroraGreen = vec3(0.1, 0.7, 0.5);
    vec3 auroraPurple = vec3(0.5, 0.2, 0.8);
    vec3 auroraPink = vec3(0.8, 0.2, 0.5);
    vec3 auroraColor = mix(auroraGreen, mix(auroraPurple, auroraPink, auroraHue), auroraHue);
    bg += auroraColor * aurora;

    // Depth vignette
    float vignette = 1.0 - smoothstep(0.4, 1.4, length(uv - 0.5) * 1.3);

    float alpha = 0.8 * vignette * globalOpacity;
    gl_FragColor = vec4(bg, alpha);
  }
`;

/** Memory star nodes */
const STAR_COUNT = 90;
/** Max connections between nearby stars */
const MAX_CONNECTIONS = 160;

export class RemSleepAnimation implements PhaseAnimation {
  readonly materials!: THREE.ShaderMaterial[];
  private backgroundMesh: THREE.Mesh;
  private backgroundMaterial: THREE.ShaderMaterial;
  private starSystem: THREE.Points;
  private starMaterial: THREE.ShaderMaterial;
  private lineSystem: THREE.LineSegments;
  private lineMaterial: THREE.ShaderMaterial;
  private starPositions: Float32Array;
  private starVelocities: Float32Array;
  private starBrightness: Float32Array;
  private starPhases: Float32Array;
  /** Cluster id per star — stars in same cluster attract each other */
  private starCluster: number[];
  private linePositions: Float32Array;
  private lineAlphas: Float32Array;
  private connectionThreshold = 0.3;
  private aspect = 1;

  /** Spatial grid for O(n·k) connection search instead of O(n²). */
  private spatialGrid = new Map<number, number[]>();
  private readonly gridCellSize = 0.6;

  constructor(
    private scene: THREE.Scene,
    aspect: number,
  ) {
    this.aspect = aspect;

    // Background
    this.backgroundMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        globalOpacity: { value: 0 },
        resolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: STAR_BG_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.backgroundMesh = createFullscreenQuad(this.backgroundMaterial);
    // Scale full-screen quad to match orthographic camera width (2 * aspect).
    this.backgroundMesh.scale.set(aspect, 1, 1);
    this.backgroundMesh.renderOrder = 0;
    scene.add(this.backgroundMesh);

    // Star particles
    this.starPositions = new Float32Array(STAR_COUNT * 3);
    this.starVelocities = new Float32Array(STAR_COUNT * 2);
    this.starBrightness = new Float32Array(STAR_COUNT);
    this.starPhases = new Float32Array(STAR_COUNT);
    this.starCluster = [];

    // Assign stars to ~8 random clusters + some loners
    const clusterCount = 8;
    const clusterCenters: { x: number; y: number }[] = [];
    for (let c = 0; c < clusterCount; c++) {
      clusterCenters.push({
        x: (Math.random() - 0.5) * 1.6 * aspect,
        y: (Math.random() - 0.5) * 1.6,
      });
    }

    for (let i = 0; i < STAR_COUNT; i++) {
      const isLoner = Math.random() < 0.25;
      const clusterId = isLoner ? -1 : Math.floor(Math.random() * clusterCount);
      this.starCluster.push(clusterId);

      if (clusterId >= 0) {
        // Place near cluster center with scatter
        const center = clusterCenters[clusterId];
        this.starPositions[i * 3] = center.x + (Math.random() - 0.5) * 0.5;
        this.starPositions[i * 3 + 1] = center.y + (Math.random() - 0.5) * 0.5;
      } else {
        this.starPositions[i * 3] = (Math.random() - 0.5) * 2 * aspect;
        this.starPositions[i * 3 + 1] = (Math.random() - 0.5) * 2;
      }
      this.starPositions[i * 3 + 2] = 0;

      this.starVelocities[i * 2] = (Math.random() - 0.5) * 0.004;
      this.starVelocities[i * 2 + 1] = (Math.random() - 0.5) * 0.004;

      this.starBrightness[i] = 0.3 + Math.random() * 0.7;
      this.starPhases[i] = Math.random() * Math.PI * 2;
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(this.starPositions, 3));
    starGeometry.setAttribute('brightness', new THREE.BufferAttribute(this.starBrightness, 1));
    starGeometry.setAttribute('phase', new THREE.BufferAttribute(this.starPhases, 1));

    this.starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        globalOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float brightness;
        attribute float phase;
        varying float vBrightness;
        varying float vPhase;
        uniform float time;

        void main() {
          vBrightness = brightness;
          vPhase = phase;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          // Rich twinkling: multiple frequencies
          float twinkle = sin(time * 2.0 + phase * 6.28) * 0.2
                        + sin(time * 3.7 + phase * 4.0) * 0.1
                        + 0.7;
          gl_PointSize = (3.0 + brightness * 5.0) * twinkle;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vBrightness;
        varying float vPhase;
        uniform float time;
        uniform float globalOpacity;

        void main() {
          float dist = length(gl_PointCoord - 0.5) * 2.0;
          if (dist > 1.0) discard;

          // Star with bright core, medium halo, wide aura
          float core = exp(-dist * dist * 12.0);
          float halo = exp(-dist * 2.0) * 0.35;
          float aura = exp(-dist * 0.8) * 0.1;
          float intensity = core + halo + aura;

          // Color cycle: violet → pink → cyan → back
          float hue = sin(time * 0.4 + vPhase * 6.28) * 0.5 + 0.5;
          vec3 violet = vec3(0.45, 0.25, 1.0);
          vec3 pink = vec3(0.9, 0.2, 0.8);
          vec3 cyan = vec3(0.3, 0.8, 1.0);
          vec3 white = vec3(0.9, 0.85, 1.0);
          vec3 color = mix(violet, pink, hue);
          // Brightest stars lean toward white/cyan
          color = mix(color, mix(cyan, white, 0.5), vBrightness * 0.3);

          float alpha = intensity * vBrightness * 0.75 * globalOpacity;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.starSystem = new THREE.Points(starGeometry, this.starMaterial);
    this.starSystem.renderOrder = 2;
    scene.add(this.starSystem);

    // Connection lines
    this.linePositions = new Float32Array(MAX_CONNECTIONS * 6);
    this.lineAlphas = new Float32Array(MAX_CONNECTIONS * 2);

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    lineGeometry.setAttribute('alpha', new THREE.BufferAttribute(this.lineAlphas, 1));
    lineGeometry.setDrawRange(0, 0);

    this.lineMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        globalOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vAlpha;
        varying vec3 vPos;
        void main() {
          vAlpha = alpha;
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vPos;
        uniform float time;
        uniform float globalOpacity;

        void main() {
          // Pulsing energy traveling along connections
          float pulse = sin(vPos.x * 8.0 + vPos.y * 6.0 - time * 3.0) * 0.3 + 0.7;

          // Color shifts along the connection
          float colorShift = sin(time * 0.6 + vPos.x * 2.0 + vPos.y * 3.0) * 0.5 + 0.5;
          vec3 violet = vec3(0.45, 0.25, 1.0);
          vec3 pink = vec3(0.85, 0.2, 0.75);
          vec3 cyan = vec3(0.3, 0.7, 0.95);
          vec3 lineColor = mix(violet, mix(pink, cyan, colorShift * 0.5), colorShift);

          float alpha = vAlpha * pulse * 0.35 * globalOpacity;
          gl_FragColor = vec4(lineColor, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.lineSystem = new THREE.LineSegments(lineGeometry, this.lineMaterial);
    this.lineSystem.renderOrder = 1;
    scene.add(this.lineSystem);

    this.materials = [this.backgroundMaterial, this.starMaterial, this.lineMaterial];
  }

  update(elapsed: number, delta: number): void {
    this.backgroundMaterial.uniforms.time.value = elapsed;
    this.starMaterial.uniforms.time.value = elapsed;
    this.lineMaterial.uniforms.time.value = elapsed;

    // Move stars: drift + subtle cluster attraction
    for (let i = 0; i < STAR_COUNT; i++) {
      const px = i * 3;
      const vx = i * 2;

      // Base drift
      this.starPositions[px] += this.starVelocities[vx] * delta * 60;
      this.starPositions[px + 1] += this.starVelocities[vx + 1] * delta * 60;

      // Cluster attraction: stars gently pulled toward same-cluster neighbors
      if (this.starCluster[i] >= 0) {
        let attractX = 0;
        let attractY = 0;
        let attractCount = 0;
        for (let j = 0; j < STAR_COUNT; j++) {
          if (i === j || this.starCluster[j] !== this.starCluster[i]) continue;
          const dx = this.starPositions[j * 3] - this.starPositions[px];
          const dy = this.starPositions[j * 3 + 1] - this.starPositions[px + 1];
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0.01 && dist < 0.8) {
            attractX += dx / dist * 0.00003;
            attractY += dy / dist * 0.00003;
            attractCount++;
          }
        }
        if (attractCount > 0) {
          this.starVelocities[vx] += attractX;
          this.starVelocities[vx + 1] += attractY;
          // Dampen velocity
          this.starVelocities[vx] *= 0.999;
          this.starVelocities[vx + 1] *= 0.999;
        }
      }

      // Wrap around edges
      if (this.starPositions[px] > this.aspect + 0.2) this.starPositions[px] = -this.aspect - 0.2;
      if (this.starPositions[px] < -this.aspect - 0.2) this.starPositions[px] = this.aspect + 0.2;
      if (this.starPositions[px + 1] > 1.2) this.starPositions[px + 1] = -1.2;
      if (this.starPositions[px + 1] < -1.2) this.starPositions[px + 1] = 1.2;

      // Multi-frequency brightness pulsing
      this.starBrightness[i] = 0.3 + 0.5 * (
        0.5 + 0.3 * Math.sin(elapsed * 1.5 + this.starPhases[i])
            + 0.2 * Math.sin(elapsed * 2.7 + this.starPhases[i] * 2)
      );
    }

    const posAttr = this.starSystem.geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    const brightAttr = this.starSystem.geometry.getAttribute('brightness') as THREE.BufferAttribute;
    brightAttr.needsUpdate = true;

    // Connection threshold grows: starts sparse, becomes a rich web
    this.connectionThreshold = 0.2 + Math.min(elapsed * 0.008, 0.3) + Math.sin(elapsed * 0.25) * 0.06;
    this.connectionThreshold = Math.min(this.connectionThreshold, 0.6);

    this.updateConnections();
  }

  /** Build spatial hash grid for efficient neighbor queries. */
  private buildSpatialGrid(): void {
    this.spatialGrid.clear();
    const invCell = 1 / this.gridCellSize;
    for (let i = 0; i < STAR_COUNT; i++) {
      const cellX = Math.floor(this.starPositions[i * 3] * invCell);
      const cellY = Math.floor(this.starPositions[i * 3 + 1] * invCell);
      const key = cellX * 73856093 + cellY * 19349663; // Spatial hash
      const bucket = this.spatialGrid.get(key);
      if (bucket) {
        bucket.push(i);
      } else {
        this.spatialGrid.set(key, [i]);
      }
    }
  }

  private updateConnections(): void {
    this.buildSpatialGrid();
    let lineIndex = 0;

    // Pre-compute squared thresholds to avoid sqrt in inner loop
    const baseThresholdSq = this.connectionThreshold * this.connectionThreshold;
    const clusterThreshold = this.connectionThreshold * 1.4;
    const clusterThresholdSq = clusterThreshold * clusterThreshold;
    const invCell = 1 / this.gridCellSize;

    // Track which pairs we've already processed to avoid duplicates
    const processed = new Set<number>();

    for (let i = 0; i < STAR_COUNT && lineIndex < MAX_CONNECTIONS; i++) {
      const ix = i * 3;
      const px = this.starPositions[ix];
      const py = this.starPositions[ix + 1];
      const cellX = Math.floor(px * invCell);
      const cellY = Math.floor(py * invCell);
      const clusterI = this.starCluster[i];

      // Check 3x3 neighboring cells
      for (let dx = -1; dx <= 1 && lineIndex < MAX_CONNECTIONS; dx++) {
        for (let dy = -1; dy <= 1 && lineIndex < MAX_CONNECTIONS; dy++) {
          const neighborKey = (cellX + dx) * 73856093 + (cellY + dy) * 19349663;
          const bucket = this.spatialGrid.get(neighborKey);
          if (!bucket) continue;

          for (let bi = 0; bi < bucket.length && lineIndex < MAX_CONNECTIONS; bi++) {
            const j = bucket[bi];
            if (j <= i) continue; // Only process each pair once (j > i)

            // Deduplicate — a star can appear in overlapping neighbor queries
            const pairKey = i * STAR_COUNT + j;
            if (processed.has(pairKey)) continue;
            processed.add(pairKey);

            const jx = j * 3;
            const ddx = px - this.starPositions[jx];
            const ddy = py - this.starPositions[jx + 1];
            const distSq = ddx * ddx + ddy * ddy;

            const sameCluster = clusterI >= 0 && clusterI === this.starCluster[j];
            const thresholdSq = sameCluster ? clusterThresholdSq : baseThresholdSq;

            if (distSq < thresholdSq) {
              const dist = Math.sqrt(distSq);
              const threshold = sameCluster ? clusterThreshold : this.connectionThreshold;
              let lineAlpha = 1.0 - dist / threshold;
              if (sameCluster) lineAlpha *= 1.3;
              lineAlpha = Math.min(lineAlpha, 1.0);

              const offset = lineIndex * 6;
              this.linePositions[offset] = px;
              this.linePositions[offset + 1] = py;
              this.linePositions[offset + 2] = 0;
              this.linePositions[offset + 3] = this.starPositions[jx];
              this.linePositions[offset + 4] = this.starPositions[jx + 1];
              this.linePositions[offset + 5] = 0;

              const alphaOffset = lineIndex * 2;
              this.lineAlphas[alphaOffset] = lineAlpha * this.starBrightness[i];
              this.lineAlphas[alphaOffset + 1] = lineAlpha * this.starBrightness[j];

              lineIndex++;
            }
          }
        }
      }
    }

    const linePosAttr = this.lineSystem.geometry.getAttribute('position') as THREE.BufferAttribute;
    linePosAttr.needsUpdate = true;
    const lineAlphaAttr = this.lineSystem.geometry.getAttribute('alpha') as THREE.BufferAttribute;
    lineAlphaAttr.needsUpdate = true;
    this.lineSystem.geometry.setDrawRange(0, lineIndex * 2);
  }

  resize(width: number, height: number, aspect: number): void {
    this.aspect = aspect;
    this.backgroundMaterial.uniforms.resolution.value.set(width, height);
    this.backgroundMesh.scale.set(aspect, 1, 1);
  }

  dispose(): void {
    // Background mesh uses shared geometry — do not dispose it.
    this.backgroundMaterial.dispose();
    this.starSystem.geometry.dispose();
    this.starMaterial.dispose();
    this.lineSystem.geometry.dispose();
    this.lineMaterial.dispose();
    this.scene.remove(this.backgroundMesh);
    this.scene.remove(this.starSystem);
    this.scene.remove(this.lineSystem);
    this.spatialGrid.clear();
  }
}
