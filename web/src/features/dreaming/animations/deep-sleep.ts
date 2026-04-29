/**
 * 🌙 Deep Sleep — "墨潭晋升"
 *
 * 意象：深夜墨潭底部，散落的记忆石子安静地躺着。
 * 月光从水面透下来，形成壮观的焦散纹理（caustics），
 * 照亮某些石子——它们开始发光、上浮，拖曳微光尾迹，
 * 穿过水面，化为墨字。底部有生物发光的微弱脉动。
 *
 * 技术：全屏深色渐变 + 水下焦散 + 月光柱 + 粒子系统分层上浮。
 * 色调：靛蓝/墨色 #1a237e → #0d1117
 */
import * as THREE from 'three';

import type { PhaseAnimation } from './types';
import { FULLSCREEN_VERTEX_SHADER, createFullscreenQuad } from './types';

const DEEP_BG_FRAGMENT = /* glsl */ `
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

  // Underwater caustic pattern: overlapping refracted light networks
  float caustic(vec2 uv, float t) {
    vec2 p1 = uv * 4.0 + vec2(t * 0.12, t * 0.08);
    vec2 p2 = uv * 3.5 + vec2(-t * 0.1, t * 0.06);
    float c1 = sin(p1.x * 3.0 + sin(p1.y * 2.5 + t * 0.3)) *
               cos(p1.y * 2.8 + sin(p1.x * 3.2 + t * 0.2));
    float c2 = sin(p2.x * 2.7 + cos(p2.y * 3.1 - t * 0.25)) *
               cos(p2.y * 3.3 + cos(p2.x * 2.6 + t * 0.15));
    return pow(abs(c1 + c2) * 0.5, 1.5);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = resolution.x / resolution.y;

    // Deep water gradient: darker at bottom, subtle indigo at top
    vec3 topColor = vec3(0.08, 0.10, 0.35);      // deep indigo
    vec3 midColor = vec3(0.04, 0.06, 0.15);       // midnight
    vec3 bottomColor = vec3(0.02, 0.03, 0.07);    // abyss
    vec3 bg = mix(bottomColor, midColor, smoothstep(0.0, 0.4, uv.y));
    bg = mix(bg, topColor, smoothstep(0.5, 1.0, uv.y));

    // Underwater caustics: dancing light network on the water
    float causticsIntensity = caustic(uv, time) * smoothstep(0.3, 0.9, uv.y);
    vec3 causticsColor = vec3(0.15, 0.25, 0.7);
    bg += causticsColor * causticsIntensity * 0.12;

    // Moonbeam: main light shaft from upper-right, more dramatic
    vec2 beamOrigin = vec2(0.65, 1.0);
    vec2 beamPos = uv - beamOrigin;
    beamPos.x *= aspect;
    float beamAngle = atan(beamPos.x, -beamPos.y);
    float beamDist = length(beamPos);

    // Wide soft cone with internal ray structure
    float beamEnvelope = exp(-abs(beamAngle) * 4.0) * exp(-beamDist * 0.6);
    float rays = (sin(beamAngle * 15.0 + time * 0.3) * 0.3 + 0.7);
    float beam = beamEnvelope * rays;

    // Beam shimmer via noise
    float shimmer = noise(vec2(uv.x * 25.0, uv.y * 12.0 - time * 0.4));
    beam *= (0.7 + shimmer * 0.4);

    // Breathing pulse
    float pulse = sin(time * 0.4) * 0.12 + 0.88;
    beam *= pulse;

    vec3 moonColor = vec3(0.95, 0.9, 0.7);
    bg += moonColor * beam * 0.2;

    // Secondary dimmer beam from upper-left
    vec2 beam2Origin = vec2(0.25, 1.0);
    vec2 beam2Pos = uv - beam2Origin;
    beam2Pos.x *= aspect;
    float beam2 = exp(-abs(atan(beam2Pos.x, -beam2Pos.y)) * 5.0) * exp(-length(beam2Pos) * 0.9);
    bg += vec3(0.6, 0.7, 0.9) * beam2 * 0.06 * pulse;

    // Bioluminescence at bottom: slow pulsing organic glow
    float bioPhase = time * 0.15;
    float bio1 = fbm(vec2(uv.x * 8.0 + bioPhase, uv.y * 3.0)) * exp(-uv.y * 4.0);
    float bio2 = fbm(vec2(uv.x * 5.0 - bioPhase * 0.7, uv.y * 6.0 + bioPhase * 0.5)) * exp(-uv.y * 5.0);
    float bioPulse = sin(time * 0.8 + uv.x * 10.0) * 0.3 + 0.7;
    bg += vec3(0.1, 0.25, 0.6) * bio1 * 0.08 * bioPulse;
    bg += vec3(0.05, 0.15, 0.45) * bio2 * 0.05;

    // Ambient suspended particles (deep sea dust)
    float dust = noise(uv * 50.0 + time * 0.08) * noise(uv * 90.0 - time * 0.04);
    bg += vec3(0.15, 0.2, 0.4) * dust * 0.03;

    // Depth vignette
    float vignette = 1.0 - smoothstep(0.35, 1.3, length(uv - 0.5) * 1.4);

    float alpha = (0.75 + beam * 0.15) * vignette * globalOpacity;
    gl_FragColor = vec4(bg, alpha);
  }
`;

/** Rising memory stone particles — three tiers */
const STONE_COUNT = 55;

export class DeepSleepAnimation implements PhaseAnimation {
  private backgroundMesh: THREE.Mesh;
  private backgroundMaterial: THREE.ShaderMaterial;
  private stoneSystem: THREE.Points;
  private stoneMaterial: THREE.ShaderMaterial;
  private stonePositions: Float32Array;
  private stoneVelocities: Float32Array;
  private stoneSizes: Float32Array;
  private stoneBrightness: Float32Array;
  private stonePhases: Float32Array;
  /** Whether each stone is "chosen" (rises to the top) or "dim" (stays at bottom) */
  private stoneChosen: Float32Array;

  constructor(
    private scene: THREE.Scene,
    aspect: number,
  ) {
    // Background
    this.backgroundMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        globalOpacity: { value: 0 },
        resolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: DEEP_BG_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.backgroundMesh = createFullscreenQuad(this.backgroundMaterial);
    // Scale full-screen quad to match orthographic camera width (2 * aspect).
    this.backgroundMesh.scale.set(aspect, 1, 1);
    this.backgroundMesh.renderOrder = 0;
    scene.add(this.backgroundMesh);

    // Rising memory stone particles
    this.stonePositions = new Float32Array(STONE_COUNT * 3);
    this.stoneVelocities = new Float32Array(STONE_COUNT);
    this.stoneSizes = new Float32Array(STONE_COUNT);
    this.stoneBrightness = new Float32Array(STONE_COUNT);
    this.stonePhases = new Float32Array(STONE_COUNT);
    this.stoneChosen = new Float32Array(STONE_COUNT);

    for (let i = 0; i < STONE_COUNT; i++) {
      this.resetStone(i, aspect, true);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.stonePositions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.stoneSizes, 1));
    geometry.setAttribute('brightness', new THREE.BufferAttribute(this.stoneBrightness, 1));
    geometry.setAttribute('phase', new THREE.BufferAttribute(this.stonePhases, 1));
    geometry.setAttribute('chosen', new THREE.BufferAttribute(this.stoneChosen, 1));

    this.stoneMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        globalOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float brightness;
        attribute float phase;
        attribute float chosen;
        varying float vBrightness;
        varying float vPhase;
        varying float vChosen;
        uniform float time;

        void main() {
          vBrightness = brightness;
          vPhase = phase;
          vChosen = chosen;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          // Gentle flicker + "excitement" wobble for chosen stones
          float flicker = 1.0 + sin(time * 3.0 + phase * 6.28) * 0.15;
          float excitement = chosen * sin(time * 5.0 + phase * 12.0) * 0.12;
          gl_PointSize = size * (flicker + excitement);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vBrightness;
        varying float vPhase;
        varying float vChosen;
        uniform float time;
        uniform float globalOpacity;

        void main() {
          float dist = length(gl_PointCoord - 0.5) * 2.0;
          if (dist > 1.0) discard;

          // Intense core + wide halo + outer aura for chosen stones
          float core = exp(-dist * dist * 10.0);
          float halo = exp(-dist * 2.5) * 0.35;
          float aura = exp(-dist * 1.2) * 0.15 * vChosen;
          float intensity = core + halo + aura;

          // Color: dim stones are cool blue, chosen are warm gold with trail
          vec3 dimColor = vec3(0.2, 0.3, 0.7);
          vec3 brightColor = vec3(1.0, 0.88, 0.55);
          vec3 trailColor = vec3(1.0, 0.6, 0.3); // warm orange trail
          vec3 color = mix(dimColor, brightColor, vBrightness);
          // Chosen stones get a pulsing warm trail aura
          color = mix(color, trailColor, vChosen * sin(time * 2.0 + vPhase * 6.28) * 0.2 + vChosen * 0.1);

          float alpha = intensity * max(vBrightness, 0.15) * 0.65 * globalOpacity;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.stoneSystem = new THREE.Points(geometry, this.stoneMaterial);
    this.stoneSystem.renderOrder = 1;
    scene.add(this.stoneSystem);
  }

  private resetStone(index: number, aspect: number, initialSpread = false): void {
    const idx = index * 3;
    // Place within the moonbeam corridor with some spread
    const spreadX = (Math.random() - 0.5) * 1.2;
    this.stonePositions[idx] = spreadX * aspect;
    this.stonePositions[idx + 1] = initialSpread
      ? -1.0 + Math.random() * 1.8
      : -0.9 - Math.random() * 0.3;
    this.stonePositions[idx + 2] = 0;

    // ~30% are "chosen" — they rise all the way up with dramatic brightness
    const isChosen = Math.random() < 0.3;
    this.stoneChosen[index] = isChosen ? 1.0 : 0.0;
    this.stoneVelocities[index] = isChosen
      ? 0.005 + Math.random() * 0.01
      : 0.001 + Math.random() * 0.003; // dim stones drift slowly
    this.stoneSizes[index] = isChosen
      ? 5 + Math.random() * 8
      : 2 + Math.random() * 4;
    this.stoneBrightness[index] = isChosen ? 0.5 + Math.random() * 0.5 : 0.1 + Math.random() * 0.25;
    this.stonePhases[index] = Math.random();
  }

  update(elapsed: number, delta: number): void {
    this.backgroundMaterial.uniforms.time.value = elapsed;
    this.stoneMaterial.uniforms.time.value = elapsed;

    const aspect = this.backgroundMaterial.uniforms.resolution.value.x /
      Math.max(1, this.backgroundMaterial.uniforms.resolution.value.y);

    for (let i = 0; i < STONE_COUNT; i++) {
      const idx = i * 3;
      const isChosen = this.stoneChosen[i] > 0.5;

      // Rise speed: chosen stones accelerate slightly as they ascend
      const speedMultiplier = isChosen
        ? 1.0 + Math.max(0, (this.stonePositions[idx + 1] + 0.5)) * 0.5
        : 1.0;
      this.stonePositions[idx + 1] += this.stoneVelocities[i] * speedMultiplier * delta * 60;

      // Horizontal drift: gentle sine sway, wider for dim stones
      const driftAmplitude = isChosen ? 0.0008 : 0.002;
      this.stonePositions[idx] += Math.sin(elapsed * 0.6 + this.stonePhases[i] * 12) * driftAmplitude;

      // Brightness ramps up for chosen stones as they enter the moonbeam
      if (isChosen) {
        const normalizedY = (this.stonePositions[idx + 1] + 1) / 2;
        this.stoneBrightness[i] = Math.min(1.0, 0.3 + normalizedY * 0.7);
      }

      // Dim stones hover: reverse direction if they float too high
      if (!isChosen && this.stonePositions[idx + 1] > -0.2) {
        this.stoneVelocities[i] = -Math.abs(this.stoneVelocities[i]) * 0.5;
      }
      if (!isChosen && this.stonePositions[idx + 1] < -0.9) {
        this.stoneVelocities[i] = Math.abs(this.stoneVelocities[i]);
      }

      // Reset chosen stones when above viewport
      if (isChosen && this.stonePositions[idx + 1] > 1.4) {
        this.resetStone(i, aspect);
      }
    }

    const posAttr = this.stoneSystem.geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    const brightAttr = this.stoneSystem.geometry.getAttribute('brightness') as THREE.BufferAttribute;
    brightAttr.needsUpdate = true;
    const chosenAttr = this.stoneSystem.geometry.getAttribute('chosen') as THREE.BufferAttribute;
    chosenAttr.needsUpdate = true;
  }

  resize(width: number, height: number, aspect: number): void {
    this.backgroundMaterial.uniforms.resolution.value.set(width, height);
    this.backgroundMesh.scale.set(aspect, 1, 1);
  }

  dispose(): void {
    this.backgroundMesh.geometry.dispose();
    this.backgroundMaterial.dispose();
    this.stoneSystem.geometry.dispose();
    this.stoneMaterial.dispose();
    this.scene.remove(this.backgroundMesh);
    this.scene.remove(this.stoneSystem);
  }
}
