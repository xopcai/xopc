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
  private camera: THREE.OrthographicCamera;
  private clock: THREE.Clock;
  private animationFrameId: number | null = null;
  private currentScene: THREE.Scene | null = null;
  private currentAnimation: PhaseAnimation | null = null;
  private currentPhase: DreamingPhase | null = null;
  private currentElapsed = 0;

  private outgoingScene: THREE.Scene | null = null;
  private outgoingAnimation: PhaseAnimation | null = null;
  private outgoingPhase: DreamingPhase | null = null;
  private outgoingElapsed = 0;

  private isTransitioning = false;
  private transitionT = 0; // 0..1
  private readonly transitionSeconds = 1.2;
  private disposed = false;
  private fadeOpacity = 0;
  private fadeTarget = 0;
  private readonly fadeSpeed = 2.5; // opacity per second (before time scaling)
  /** Global time scaling for a calmer, meditative feel. */
  private readonly timeScale = 0.35;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.z = 1;

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
    this.outgoingAnimation?.resize(width, height, aspect);
  }

  startPhase(phase: DreamingPhase): void {
    if (this.disposed) return;
    if (this.currentPhase === phase && this.currentAnimation && !this.isTransitioning) return;

    // If we're mid-transition, collapse to the incoming scene as "current" first.
    if (this.isTransitioning) {
      this.finalizeTransition();
    }

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const aspect = width / height;

    const nextScene = new THREE.Scene();
    const nextAnimation = this.createAnimation(nextScene, phase, aspect);
    nextAnimation.resize(width, height, aspect);

    if (!this.currentAnimation || !this.currentScene || !this.currentPhase) {
      // First phase: just start it.
      this.currentScene = nextScene;
      this.currentAnimation = nextAnimation;
      this.currentPhase = phase;
      this.currentElapsed = 0;
    } else {
      // Crossfade: keep old animation running as outgoing.
      this.outgoingScene = this.currentScene;
      this.outgoingAnimation = this.currentAnimation;
      this.outgoingPhase = this.currentPhase;
      this.outgoingElapsed = this.currentElapsed;

      this.currentScene = nextScene;
      this.currentAnimation = nextAnimation;
      this.currentPhase = phase;
      this.currentElapsed = 0;

      this.isTransitioning = true;
      this.transitionT = 0;
    }

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

    // Smooth fade
    if (this.fadeOpacity < this.fadeTarget) {
      this.fadeOpacity = Math.min(this.fadeOpacity + delta * this.fadeSpeed, this.fadeTarget);
    } else if (this.fadeOpacity > this.fadeTarget) {
      this.fadeOpacity = Math.max(this.fadeOpacity - delta * this.fadeSpeed, this.fadeTarget);
    }

    if (this.fadeOpacity <= 0.001 && this.fadeTarget === 0) {
      this.stopAllAnimations();
      this.animationFrameId = null;
      return;
    }

    // Update phase animations
    if (this.outgoingAnimation && this.outgoingScene && this.isTransitioning) {
      this.outgoingElapsed += delta;
      this.outgoingAnimation.update(this.outgoingElapsed, delta);
    }
    if (this.currentAnimation && this.currentScene) {
      this.currentElapsed += delta;
      this.currentAnimation.update(this.currentElapsed, delta);
    }

    // Transition progress (smooth, calm)
    let incomingMix = 1;
    if (this.isTransitioning) {
      this.transitionT = Math.min(1, this.transitionT + delta / this.transitionSeconds);
      // Smoothstep-ish: t*t*(3-2t)
      const t = this.transitionT;
      incomingMix = t * t * (3 - 2 * t);
      if (this.transitionT >= 1) {
        this.finalizeTransition();
        incomingMix = 1;
      }
    }
    const outgoingMix = this.isTransitioning ? 1 - incomingMix : 0;

    // Render: clear once, then render outgoing -> incoming (both with global fade)
    this.renderer.clear();

    if (this.outgoingScene && this.outgoingAnimation && outgoingMix > 0.001) {
      this.applyGlobalOpacity(this.outgoingScene, this.fadeOpacity * outgoingMix);
      this.renderer.render(this.outgoingScene, this.camera);
    }
    if (this.currentScene && this.currentAnimation) {
      this.applyGlobalOpacity(this.currentScene, this.fadeOpacity * incomingMix);
      this.renderer.render(this.currentScene, this.camera);
    }

    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  private createAnimation(scene: THREE.Scene, phase: DreamingPhase, aspect: number): PhaseAnimation {
    switch (phase) {
      case 'light':
        return new LightSleepAnimation(scene, aspect);
      case 'deep':
        return new DeepSleepAnimation(scene, aspect);
      case 'rem':
        return new RemSleepAnimation(scene, aspect);
    }
  }

  private applyGlobalOpacity(scene: THREE.Scene, opacity: number): void {
    scene.traverse((child) => {
      if ((child as THREE.Mesh).material) {
        const material = (child as THREE.Mesh).material as THREE.ShaderMaterial;
        if (material.uniforms?.globalOpacity) {
          material.uniforms.globalOpacity.value = opacity;
        }
      }
    });
  }

  private finalizeTransition(): void {
    this.isTransitioning = false;
    this.transitionT = 1;

    if (this.outgoingAnimation) {
      this.outgoingAnimation.dispose();
    }
    this.outgoingScene = null;
    this.outgoingAnimation = null;
    this.outgoingPhase = null;
    this.outgoingElapsed = 0;
  }

  private stopAllAnimations(): void {
    if (this.currentAnimation) {
      this.currentAnimation.dispose();
    }
    if (this.outgoingAnimation) {
      this.outgoingAnimation.dispose();
    }
    this.currentScene = null;
    this.currentAnimation = null;
    this.currentPhase = null;
    this.currentElapsed = 0;
    this.outgoingScene = null;
    this.outgoingAnimation = null;
    this.outgoingPhase = null;
    this.outgoingElapsed = 0;
    this.isTransitioning = false;
    this.transitionT = 0;
  }

  dispose(): void {
    this.disposed = true;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.stopAllAnimations();
    this.renderer.dispose();
  }
}
