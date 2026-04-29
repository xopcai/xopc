import * as THREE from 'three';

/** Interface for each dreaming phase animation. */
export interface PhaseAnimation {
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

/** Creates a full-screen plane mesh for shader effects. */
export function createFullscreenQuad(material: THREE.ShaderMaterial): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(2, 2);
  return new THREE.Mesh(geometry, material);
}
