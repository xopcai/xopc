/**
 * 💤 Light Sleep — "涟漪收纳"
 *
 * 意象：一滴墨水落入静水，涟漪一圈圈扩散。
 * 涟漪交汇处浮现半透明文字碎片，缓缓沉入水底。
 * 多个墨水落点随机出现，每个形成独立的涟漪波纹，
 * 水墨在暗色水面上扩散、交织、消融。
 *
 * 技术：全屏 ShaderMaterial 绘制多源涟漪 + 粒子系统模拟浮动碎片。
 * 色调：薄荷绿 #e0f7f0（暗色模式下改为深青 #0a2e26 基底）
 */
import * as THREE from 'three';

import type { PhaseAnimation } from './types';
import { FULLSCREEN_VERTEX_SHADER, createFullscreenQuad } from './types';

const RIPPLE_FRAGMENT = /* glsl */ `
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

  // FBM for richer water surface
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  // Ripple from a specific center point with birth time
  float rippleFrom(vec2 pos, vec2 center, float birthTime, float currentTime) {
    float age = currentTime - birthTime;
    if (age < 0.0) return 0.0;
    float dist = length(pos - center);
    float speed = 0.8;
    float wavePos = dist - age * speed;
    // Expanding ring that decays over time
    float wave = sin(wavePos * 25.0) * exp(-dist * 2.0) * exp(-age * 0.4);
    return wave * smoothstep(0.0, 0.5, age);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = resolution.x / resolution.y;
    vec2 pos = uv - 0.5;
    pos.x *= aspect;

    // Breathing rhythm: 6-second cycle
    float breath = sin(time * 1.047) * 0.5 + 0.5;

    // Multiple ink drop centers (procedurally placed, staggered in time)
    float ripple = 0.0;
    for (int k = 0; k < 5; k++) {
      float fk = float(k);
      float dropInterval = 4.0 + fk * 1.3;
      float birthTime = floor(time / dropInterval) * dropInterval;
      vec2 dropCenter = vec2(
        hash(vec2(fk + 1.0, birthTime)) - 0.5,
        hash(vec2(birthTime, fk + 7.0)) - 0.5
      ) * 0.6;
      ripple += rippleFrom(pos, dropCenter, birthTime, time) * (0.6 - fk * 0.08);
    }

    // Central persistent ripple (always present, gentler)
    float centralDist = length(pos);
    float centralRipple = sin(centralDist * 18.0 - time * 1.2) * exp(-centralDist * 2.5) * 0.3;
    ripple += centralRipple * (0.7 + breath * 0.3);

    // Rich water surface via FBM distortion
    float surface = fbm(uv * 6.0 + time * 0.15) * 0.06;
    float surfaceDetail = fbm(uv * 15.0 - time * 0.08) * 0.03;

    // Dark-mode ink wash palette
    vec3 waterBase = vec3(0.04, 0.18, 0.15);     // deep teal-black
    vec3 waterMid = vec3(0.06, 0.25, 0.20);      // slightly lighter
    vec3 rippleGlow = vec3(0.25, 0.75, 0.58);    // mint highlight
    vec3 inkAccent = vec3(0.0, 0.12, 0.10);      // darkest ink

    // Base: subtle radial gradient
    vec3 color = mix(waterBase, waterMid, smoothstep(0.6, 0.0, centralDist) + surface);

    // Ripple highlights: mint glow on wave crests
    float rippleIntensity = abs(ripple);
    color = mix(color, rippleGlow, rippleIntensity * 0.5);

    // Ink darkness in troughs
    color = mix(color, inkAccent, max(0.0, -ripple) * 0.3);

    // Surface shimmer
    color += vec3(0.1, 0.3, 0.22) * surfaceDetail;

    // Ink drop splash glow at center, breathing
    float inkGlow = exp(-centralDist * 6.0) * (0.2 + breath * 0.15);
    color += rippleGlow * inkGlow * 0.4;

    // Soft vignette for depth
    float vignette = 1.0 - smoothstep(0.3, 1.3, centralDist);

    float alpha = (0.7 + rippleIntensity * 0.2 + inkGlow * 0.1) * vignette * globalOpacity;
    gl_FragColor = vec4(color, alpha);
  }
`;

/** Count of floating "fragment" particles — leaves on water surface */
const FRAGMENT_COUNT = 80;

export class LightSleepAnimation implements PhaseAnimation {
  private backgroundMesh: THREE.Mesh;
  private backgroundMaterial: THREE.ShaderMaterial;
  private particleSystem: THREE.Points;
  private particleMaterial: THREE.ShaderMaterial;
  private particlePositions: Float32Array;
  private particleVelocities: Float32Array;
  private particleAlphas: Float32Array;
  private particleSizes: Float32Array;

  constructor(
    private scene: THREE.Scene,
    aspect: number,
  ) {
    // Full-screen ripple background
    this.backgroundMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        globalOpacity: { value: 0 },
        resolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: RIPPLE_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.backgroundMesh = createFullscreenQuad(this.backgroundMaterial);
    this.backgroundMesh.renderOrder = 0;
    scene.add(this.backgroundMesh);

    // Floating fragment particles — lotus petal-like text scraps
    this.particlePositions = new Float32Array(FRAGMENT_COUNT * 3);
    this.particleVelocities = new Float32Array(FRAGMENT_COUNT * 3);
    this.particleAlphas = new Float32Array(FRAGMENT_COUNT);
    this.particleSizes = new Float32Array(FRAGMENT_COUNT);

    for (let i = 0; i < FRAGMENT_COUNT; i++) {
      this.resetParticle(i, aspect, true);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.particleAlphas, 1));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.particleSizes, 1));

    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        globalOpacity: { value: 0 },
        baseSize: { value: 5.0 },
      },
      vertexShader: /* glsl */ `
        attribute float alpha;
        attribute float size;
        varying float vAlpha;
        varying float vSize;
        uniform float time;
        uniform float baseSize;

        void main() {
          vAlpha = alpha;
          vSize = size;
          vec3 pos = position;
          // Water surface sway: organic, wave-like
          pos.x += sin(time * 0.6 + position.y * 4.0) * 0.04;
          pos.y += cos(time * 0.4 + position.x * 3.0) * 0.015;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = baseSize * size * (0.6 + alpha * 0.4);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying float vSize;
        uniform float globalOpacity;
        uniform float time;

        void main() {
          vec2 centered = gl_PointCoord - 0.5;
          float dist = length(centered) * 2.0;
          if (dist > 1.0) discard;

          // Elongated shape for text fragment look
          float shape = 1.0 - smoothstep(0.2, 1.0, dist);

          // Soft color: mix between mint and pale jade
          float colorVar = sin(time * 0.5 + vSize * 6.28) * 0.5 + 0.5;
          vec3 mint = vec3(0.3, 0.85, 0.65);
          vec3 jade = vec3(0.2, 0.65, 0.5);
          vec3 color = mix(jade, mint, colorVar);

          // Some fragments glow brighter (being "selected")
          float glow = smoothstep(0.7, 1.0, vAlpha) * 0.4;
          color += vec3(0.2, 0.4, 0.3) * glow;

          float alpha = shape * vAlpha * 0.5 * globalOpacity;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.particleSystem = new THREE.Points(geometry, this.particleMaterial);
    this.particleSystem.renderOrder = 1;
    scene.add(this.particleSystem);
  }

  private resetParticle(index: number, aspect: number, initialSpread: boolean): void {
    const idx = index * 3;
    this.particlePositions[idx] = (Math.random() - 0.5) * 2 * aspect;
    this.particlePositions[idx + 1] = initialSpread
      ? (Math.random() - 0.5) * 2
      : 0.9 + Math.random() * 0.3;
    this.particlePositions[idx + 2] = 0;

    this.particleVelocities[idx] = (Math.random() - 0.5) * 0.015;
    this.particleVelocities[idx + 1] = -Math.random() * 0.012 - 0.003; // slowly sinking
    this.particleVelocities[idx + 2] = 0;

    this.particleAlphas[index] = 0.3 + Math.random() * 0.7;
    this.particleSizes[index] = 0.6 + Math.random() * 1.4;
  }

  update(elapsed: number, delta: number): void {
    this.backgroundMaterial.uniforms.time.value = elapsed;
    this.particleMaterial.uniforms.time.value = elapsed;

    const aspect = this.backgroundMaterial.uniforms.resolution.value.x /
      Math.max(1, this.backgroundMaterial.uniforms.resolution.value.y);

    for (let i = 0; i < FRAGMENT_COUNT; i++) {
      const idx = i * 3;
      this.particlePositions[idx] += this.particleVelocities[idx] * delta * 60;
      this.particlePositions[idx + 1] += this.particleVelocities[idx + 1] * delta * 60;

      // Breathing-synchronized fade: some fragments dissolve (dedup simulation)
      const breathPhase = Math.sin(elapsed * 1.047 + i * 0.3);
      if (breathPhase > 0.8 && this.particleAlphas[i] < 0.4) {
        // This fragment is "deduplicated" — fade faster
        this.particleAlphas[i] -= delta * 0.3;
      } else {
        this.particleAlphas[i] -= delta * 0.06;
      }

      // Reset when faded or out of bounds
      if (this.particleAlphas[i] <= 0 || this.particlePositions[idx + 1] < -1.3) {
        this.resetParticle(i, aspect, false);
      }
    }

    const posAttr = this.particleSystem.geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    const alphaAttr = this.particleSystem.geometry.getAttribute('alpha') as THREE.BufferAttribute;
    alphaAttr.needsUpdate = true;
  }

  resize(width: number, height: number, _aspect: number): void {
    this.backgroundMaterial.uniforms.resolution.value.set(width, height);
    this.particleMaterial.uniforms.baseSize.value = Math.max(4, Math.min(8, width / 200));
  }

  dispose(): void {
    this.backgroundMesh.geometry.dispose();
    this.backgroundMaterial.dispose();
    this.particleSystem.geometry.dispose();
    this.particleMaterial.dispose();
    this.scene.remove(this.backgroundMesh);
    this.scene.remove(this.particleSystem);
  }
}
