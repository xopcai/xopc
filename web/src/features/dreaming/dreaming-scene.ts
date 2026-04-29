/**
 * Dreaming animation scene manager.
 * Creates and manages a Three.js WebGL scene that renders full-screen
 * dreaming phase animations (Light / Deep / REM).
 *
 * Each phase has its own visual language:
 * - Light: mint-green ripples expanding from center, floating text fragments
 * - Deep: indigo-black deep pool, glowing particles rising through moonlight
 * - REM:  violet starfield, aurora threads connecting memory nodes
 */
import * as THREE from 'three';

import { LightSleepAnimation } from './animations/light-sleep';
import { DeepSleepAnimation } from './animations/deep-sleep';
import { RemSleepAnimation } from './animations/rem-sleep';
import type { PhaseAnimation } from './animations/types';

export type DreamingPhase = 'light' | 'deep' | 'rem';

export class DreamingScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private clock: THREE.Clock;
  private animationFrameId: number | null = null;
  private currentAnimation: PhaseAnimation | null = null;
  private currentPhase: DreamingPhase | null = null;
  private disposed = false;
  private fadeOpacity = 0;
  private fadeTarget = 0;
  private readonly fadeSpeed = 2.5; // opacity per second (before time scaling)
  /** Global time scaling for a calmer, meditative feel. */
  private readonly timeScale = 0.35;
  /** Accumulated scaled time in seconds. */
  private t = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.z = 1;

    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock(false);

    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(dpr);

    const aspect = width / height;
    this.camera.left = -aspect;
    this.camera.right = aspect;
    this.camera.top = 1;
    this.camera.bottom = -1;
    this.camera.updateProjectionMatrix();

    this.currentAnimation?.resize(width, height, aspect);
  }

  startPhase(phase: DreamingPhase): void {
    if (this.disposed) return;
    if (this.currentPhase === phase && this.currentAnimation) return;

    this.stopCurrentAnimation();
    this.t = 0;

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const aspect = width / height;

    switch (phase) {
      case 'light':
        this.currentAnimation = new LightSleepAnimation(this.scene, aspect);
        break;
      case 'deep':
        this.currentAnimation = new DeepSleepAnimation(this.scene, aspect);
        break;
      case 'rem':
        this.currentAnimation = new RemSleepAnimation(this.scene, aspect);
        break;
    }

    this.currentPhase = phase;
    this.currentAnimation.resize(width, height, aspect);
    this.fadeTarget = 1;
    this.clock.start();

    if (!this.animationFrameId) {
      this.tick();
    }
  }

  fadeOut(): void {
    this.fadeTarget = 0;
  }

  get isFullyFadedOut(): boolean {
    return this.fadeOpacity <= 0.001 && this.fadeTarget === 0;
  }

  private tick = (): void => {
    if (this.disposed) return;

    const rawDelta = this.clock.getDelta();
    const delta = rawDelta * this.timeScale;
    this.t += delta;
    const elapsed = this.t;

    // Smooth fade
    if (this.fadeOpacity < this.fadeTarget) {
      this.fadeOpacity = Math.min(this.fadeOpacity + delta * this.fadeSpeed, this.fadeTarget);
    } else if (this.fadeOpacity > this.fadeTarget) {
      this.fadeOpacity = Math.max(this.fadeOpacity - delta * this.fadeSpeed, this.fadeTarget);
    }

    if (this.fadeOpacity <= 0.001 && this.fadeTarget === 0) {
      this.stopCurrentAnimation();
      this.animationFrameId = null;
      return;
    }

    this.currentAnimation?.update(elapsed, delta);

    // Apply global fade via scene opacity
    this.scene.traverse((child) => {
      if ((child as THREE.Mesh).material) {
        const material = (child as THREE.Mesh).material as THREE.ShaderMaterial;
        if (material.uniforms?.globalOpacity) {
          material.uniforms.globalOpacity.value = this.fadeOpacity;
        }
      }
    });

    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  private stopCurrentAnimation(): void {
    if (this.currentAnimation) {
      this.currentAnimation.dispose();
      this.currentAnimation = null;
      this.currentPhase = null;
    }
    // Clear scene children
    while (this.scene.children.length > 0) {
      this.scene.remove(this.scene.children[0]);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.stopCurrentAnimation();
    this.renderer.dispose();
  }
}
