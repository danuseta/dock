// The box rig is ported from Claw3D (MIT, (c) 2026 Luke The Dev):
// src/features/retro-office/objects/agents.tsx. Part sizes, positions, the face
// texture and the walk cycle (arm swing 0.4, leg swing 0.35, bounce 0.04, turn
// smoothing 0.12) are the originals, rewritten from react-three-fiber JSX to
// plain three.js. Claw3D's "sitting" only leans the standing figure; the real
// seated pose (bent legs, lowered onto the chair), and the typing, folded-arms,
// raised-hand and asleep poses are DOCK's own.
// See frontend/public/third-party-notices.txt.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Pose } from './activity';
import type { ZoneId } from './layout';
import { AGENT_SCALE, WALK_ANIM_SPEED, type Point } from './navigation';

const SKIN = '#f0c9a4';
const TROUSERS = '#2d3140';
const SHOES = '#111827';
const HAIR = '#2b2320';

export interface Walk { path: Point[]; duration: number; started: number; toZone: ZoneId }

export interface Character {
  group: THREE.Group;
  rightLeg: THREE.Group;
  leftLeg: THREE.Group;
  rightArm: THREE.Group;
  leftArm: THREE.Group;
  ring: THREE.Mesh;
  tag: CSS2DObject;
  dimmed: boolean;
  x: number;
  y: number;
  zone: ZoneId;
  facing: number;
  frame: number;
  phaseOffset: number;
  walk: Walk | null;
  tagHtml: string;
  arrivedAt: number | null;
}

function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  color: THREE.ColorRepresentation,
  position?: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshLambertMaterial({ color }));
  if (position) mesh.position.set(...position);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeFaceTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = SKIN;
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = 'rgba(255,255,255,0.14)';
    context.fillRect(0, 0, 64, 10);
    context.fillStyle = 'rgba(196,122,84,0.18)';
    context.beginPath();
    context.arc(18, 38, 7, 0, Math.PI * 2);
    context.arc(46, 38, 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#d8a06e';
    context.fillRect(30, 28, 4, 10);
    context.fillRect(29, 37, 6, 2);
    context.fillStyle = '#1f2937';
    context.fillRect(17, 24, 6, 6);
    context.fillRect(41, 24, 6, 6);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createCharacter(key: string, topColor: string, at: Point, zone: ZoneId, scale = 1): Character {
  const group = new THREE.Group();
  group.scale.setScalar(AGENT_SCALE * scale);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.12, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2 }),
  );
  shadow.position.y = 0.001;
  shadow.rotation.x = -Math.PI / 2;
  group.add(shadow);

  const leg = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.1, 0);
    box(pivot, [0.07, 0.14, 0.08], TROUSERS);
    box(pivot, [0.07, 0.05, 0.12], SHOES, [0, -0.09, 0]);
    group.add(pivot);
    return pivot;
  };
  const rightLeg = leg(-0.045);
  const leftLeg = leg(0.045);

  box(group, [0.18, 0.2, 0.1], topColor, [0, 0.28, 0]);

  const arm = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.28, 0);
    box(pivot, [0.06, 0.16, 0.06], topColor, [0, -0.08, 0]);
    box(pivot, [0.05, 0.05, 0.05], SKIN, [0, -0.17, 0]);
    group.add(pivot);
    return pivot;
  };
  const rightArm = arm(-0.12);
  const leftArm = arm(0.12);

  box(group, [0.07, 0.05, 0.07], SKIN, [0, 0.39, 0]);
  const headMaterials = [0, 1, 2, 3, 4, 5].map((index) => (
    index === 4 ? new THREE.MeshLambertMaterial({ map: makeFaceTexture() }) : new THREE.MeshLambertMaterial({ color: SKIN })
  ));
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.14), headMaterials);
  head.position.set(0, 0.47, 0);
  head.castShadow = true;
  group.add(head);
  box(group, [0.17, 0.05, 0.15], HAIR, [0, 0.555, 0]);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.25, 40),
    new THREE.MeshBasicMaterial({ color: 0xe9e2d0, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  ring.visible = false;
  group.add(ring);

  group.traverse((object) => { object.userData.key = key; });

  const element = document.createElement('div');
  element.className = 'dock-agent-label';
  const tag = new CSS2DObject(element);
  tag.position.set(0, 0.9, 0);
  group.add(tag);

  return {
    group, rightLeg, leftLeg, rightArm, leftArm, ring, tag, dimmed: false,
    x: at.x, y: at.y, zone, facing: Math.PI,
    frame: Math.random() * 40, phaseOffset: Math.random() * 6,
    walk: null, tagHtml: '', arrivedAt: null,
  };
}

export interface Posture { seated?: boolean; folded?: boolean; seatHeight?: number }

/** Top of the desk chair's seat and of the lounge sofa's cushion above the floor, measured from the models at their scale. */
export const CHAIR_SEAT_HEIGHT = 0.228;
export const SOFA_SEAT_HEIGHT = 0.414;
/** Underside of a figure's thigh when its legs are bent forward, in the figure's own units. */
const THIGH_UNDERSIDE = 0.06;

export function animateCharacter(character: Character, pose: Pose, walking: boolean, deltaSeconds: number, still: boolean, posture: Posture = {}): void {
  const { group, leftArm, rightArm, leftLeg, rightLeg } = character;
  const sitting = Boolean(posture.seated) && !walking;
  const folded = sitting && Boolean(posture.folded);
  character.frame += deltaSeconds * 60;

  let rotationDelta = character.facing - group.rotation.y;
  while (rotationDelta > Math.PI) rotationDelta -= Math.PI * 2;
  while (rotationDelta < -Math.PI) rotationDelta += Math.PI * 2;
  group.rotation.y += rotationDelta * (still ? 1 : 0.12);

  const frameValue = character.frame + character.phaseOffset / WALK_ANIM_SPEED;
  const walkPhase = Math.sin(frameValue * WALK_ANIM_SPEED);
  const typing = !walking && !folded && pose === 'SeatedTyping';
  const asleep = !walking && pose === 'Asleep';
  const raised = !walking && pose === 'SeatedWaiting';

  group.rotation.x = typing ? -0.15 : asleep ? 0.42 : 0;
  const bounce = walking ? walkPhase * 0.04 : 0;
  const breathe = !walking && !typing && !still ? Math.sin(frameValue * 0.03) * 0.01 : 0;
  // A seated figure is raised until its thighs rest on the seat; without this it sinks through the chair.
  const lift = sitting ? Math.max(0, (posture.seatHeight ?? CHAIR_SEAT_HEIGHT) - THIGH_UNDERSIDE * group.scale.y) : 0;
  group.position.y = bounce + breathe + lift;

  leftArm.rotation.set(0, 0, 0);
  rightArm.rotation.set(0, 0, 0);
  if (walking) {
    leftArm.rotation.x = walkPhase * 0.4;
    rightArm.rotation.x = -walkPhase * 0.4;
  } else if (typing) {
    const tap = still ? 0 : 0.12;
    leftArm.rotation.x = -1.05 + Math.sin(character.frame * 0.5) * tap;
    rightArm.rotation.x = -1.05 + Math.cos(character.frame * 0.5) * tap;
  } else if (folded && !raised) {
    // Sitting back with folded arms while the team works.
    leftArm.rotation.set(-0.75, 0, -0.55);
    rightArm.rotation.set(-0.75, 0, 0.55);
  } else if (raised) {
    rightArm.rotation.x = -2.75 + (still ? 0 : Math.sin(character.frame * 0.08) * 0.08);
    rightArm.rotation.z = -0.12;
  }
  rightLeg.rotation.x = walking ? -walkPhase * 0.35 : sitting ? -Math.PI / 2 : 0;
  leftLeg.rotation.x = walking ? walkPhase * 0.35 : sitting ? -Math.PI / 2 : 0;
}

/** A member that has finished stays at its desk, faded, until the ticket moves on. */
export function setDimmed(character: Character, dimmed: boolean): void {
  if (character.dimmed === dimmed) return;
  character.dimmed = dimmed;
  character.group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      material.transparent = true;
      material.opacity = dimmed ? 0.38 : object === character.group.children[0] ? 0.2 : 1;
    }
  });
}

export function disposeCharacter(character: Character): void {
  character.group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      (material as THREE.MeshLambertMaterial).map?.dispose();
      material.dispose();
    }
  });
  character.group.remove(character.tag);
  character.tag.element.remove();
  character.group.removeFromParent();
}
