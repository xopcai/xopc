import * as THREE from 'three';

/** Interface for each dreaming phase animation. */
export interface PhaseAnimation {
  /** Collect all ShaderMaterials for direct opacity control (avoids scene.traverse). */
  readonly materials: THREE.ShaderMaterial[];

  /** Update animation state each frame. */
  update(elapsed: number, delta: number): void;

  /** Handle viewport resize. */
  resize(width: number, height: number, aspect: number): void;

  /** Clean up GPU resources. */
  dispose(): void;
}

/** Shared vertex shader for full-screen quad effects. */
export const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Shared PlaneGeometry(2,2) for all full-screen quads.
 * Reusing a single geometry avoids redundant GPU buffer allocations.
 */
let sharedFullscreenGeometry: THREE.PlaneGeometry | null = null;

function getFullscreenGeometry(): THREE.PlaneGeometry {
  if (!sharedFullscreenGeometry) {
    sharedFullscreenGeometry = new THREE.PlaneGeometry(2, 2);
  }
  return sharedFullscreenGeometry;
}

/** Creates a full-screen plane mesh using the shared geometry. */
export function createFullscreenQuad(material: THREE.ShaderMaterial): THREE.Mesh {
  return new THREE.Mesh(getFullscreenGeometry(), material);
}
