import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { podColor, shirtColor, splitTeam, stageColor, stageName, type AgentRun, type TimelineAgent } from '../runs';
import { clock, poseOf, slotFromServer, tickActivity, type ActivitySlot, type Pose } from './activity';
import { buildBoardCards, type BoardCards } from './board';
import { animateCharacter, createCharacter, disposeCharacter, setDimmed, type Character } from './character';
import { ASK_EMOTE, THINK_EMOTE, ZZZ_EMOTE } from './emotes';
import {
  EXIT, FURNITURE, LEAD_SEAT, LEAD_ZONE, LOUNGE_ZONE, MAX_PODS, MEMBER_DESKS, RAIL_STAGES, YOU_ZONE,
  coordinatorSeat, loungeSpot, memberSeat, podId, podZone, railIndex, waitingSpot,
  type Zone, type ZoneId,
} from './layout';
import { calculateWalkDuration, interpolatePathPosition, routeThroughDoors } from './movement';
import {
  CANVAS_H, CANVAS_W, FURNITURE_GLB, FURNITURE_SCALE, FURNITURE_Y_OFFSET, ITEM_FOOTPRINT, SCALE, toWorld,
  type FurnitureItem, type Point,
} from './navigation';

export interface OfficeSceneOptions {
  assetBase: string;
  onSelect: (key: string) => void;
}

interface Member { info: TimelineAgent; character: Character; desk: number }

interface Occupant {
  run: AgentRun;
  slot: ActivitySlot;
  pod: number;
  /** Place in the owner's queue or the lounge, where people stand side by side; -1 at a desk. */
  standing: number;
  character: Character;
  members: Map<string, Member>;
  hidden: number;
}

interface Pod { pad: THREE.Mesh; strip: THREE.Mesh; sign: CSS2DObject }

const BACKGROUND = 0x0d0d0f;
const OWNER_COLOR = '#e9e2d0';
const LEAD_COLOR = '#d9d2bf';
const FREE_POD = 0x26262c;
const DONE_LINGER_SECONDS = 4;
// A ticket keeps its pod this long after its last activity, so a pause between two tools does not empty the room.
const POD_GRACE_SECONDS = 45;
const MEMBER_SCALE = 0.86;
const BOARD_SIZE: [number, number] = [22, 3.1];
const BOARD_Y = 2.5;
const OVERVIEW = { position: [-1, 26, 22.5], target: [0, 0, 1.4] } as const;
const TAG_HEIGHT = 0.9;
const TAG_STEP = 0.78;
const FALLBACK_HEIGHT: Partial<Record<FurnitureItem['type'], number>> = {
  computer: 0.35, chair: 0.5, plant: 0.7, lamp: 1.4, bookshelf: 1.7, cabinet: 1,
};

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (char) => (
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char
));

/**
 * The 3D office. DOCK owns the floor plan and the frame loop: one lead, a pod
 * per ticket with its sub-coordinator and members at their desks. Characters,
 * pathfinding, the wall board, movement and the status rules come from the
 * projects credited in frontend/public/third-party-notices.txt.
 */
export class OfficeScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  private readonly controls: OrbitControls;
  private readonly board: THREE.Mesh;
  private readonly boardCards: BoardCards;
  private readonly occupants = new Map<string, Occupant>();
  private readonly pods: Pod[] = [];
  private readonly lead: Character;
  private readonly labels: CSS2DObject[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly corner = new THREE.Vector3();
  private selected: string | null = null;
  private view = 'overview';
  private viewPending = false;
  private flight: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private pointerDown: [number, number] | null = null;
  private animationFrame = 0;
  private lastFrame = clock();
  private disposed = false;

  constructor(private readonly host: HTMLElement, private readonly options: OfficeSceneOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'dock-office-canvas';
    host.appendChild(this.renderer.domElement);

    const labelLayer = document.createElement('div');
    labelLayer.className = 'dock-office-labels';
    host.appendChild(labelLayer);
    this.labelRenderer = new CSS2DRenderer({ element: labelLayer });

    this.scene.background = new THREE.Color(BACKGROUND);
    this.scene.fog = new THREE.Fog(BACKGROUND, 40, 80);
    this.camera.position.set(...OVERVIEW.position);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...OVERVIEW.target);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = 1.42;
    this.controls.minDistance = 3;
    // Dragging or zooming by hand ends a camera move that is still under way.
    this.controls.addEventListener('start', this.cancelFlight);
    this.controls.maxDistance = 46;
    this.controls.update();

    this.buildRoom();
    const depth = CANVAS_H * SCALE;
    this.board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE[0], BOARD_SIZE[1], 0.14), new THREE.MeshLambertMaterial({ color: 0x15161a }));
    this.board.position.set(0, BOARD_Y, -depth / 2 - 0.68);
    this.scene.add(this.board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE[0] + 0.4, BOARD_SIZE[1] + 0.4, 0.1), new THREE.MeshLambertMaterial({ color: 0x33343b }));
    frame.position.set(0, BOARD_Y, -depth / 2 - 0.74);
    this.scene.add(frame);
    this.boardCards = buildBoardCards(
      this.board,
      RAIL_STAGES.map((stage) => stageName(stage, 'build').toUpperCase()),
      (key) => this.options.onSelect(key),
    );

    this.lead = createCharacter('', LEAD_COLOR, LEAD_SEAT, 'lead');
    this.scene.add(this.lead.group);

    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    labelLayer.addEventListener('click', this.handleLabelClick);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();

    void this.loadFurniture();
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  setRuns(runs: AgentRun[]): void {
    if (this.disposed) return;
    const now = clock();
    const keys = new Set(runs.map((run) => run.key));
    for (const [key, occupant] of this.occupants) {
      if (keys.has(key)) continue;
      this.removeOccupant(occupant);
      this.occupants.delete(key);
    }

    const fresh = new Set<Occupant>();
    for (const run of runs) {
      const slot = slotFromServer(run, now);
      const existing = this.occupants.get(run.key);
      if (existing) {
        existing.run = run;
        existing.slot = slot;
        continue;
      }
      if (run.stage === 'done') continue;
      const character = createCharacter(run.key, shirtColor(run.key), { ...LEAD_SEAT }, 'lounge');
      this.scene.add(character.group);
      const occupant: Occupant = { run, slot, pod: -1, standing: -1, character, members: new Map(), hidden: 0 };
      this.occupants.set(run.key, occupant);
      fresh.add(occupant);
    }

    // A pod is for work in progress. A ticket that is waiting on the owner queues at the owner's
    // desk, and one that nobody is working on stands in the lounge, so neither uses up a pod.
    const live = [...this.occupants.values()].filter((occupant) => occupant.run.stage !== 'done');
    const waiting = live.filter((occupant) => occupant.slot.state === 'WAITING');
    const working = (occupant: Occupant) => occupant.slot.state === 'ACTIVE'
      || splitTeam(occupant.run.members).members.some((member) => member.state === 'active')
      || Boolean(splitTeam(occupant.run.members).coordinator && splitTeam(occupant.run.members).coordinator?.state === 'active')
      || (occupant.pod >= 0 && occupant.run.idleSeconds < POD_GRACE_SECONDS);
    for (const occupant of this.occupants.values()) {
      const keeps = occupant.run.stage !== 'done' && occupant.slot.state !== 'WAITING' && working(occupant);
      if (!keeps && occupant.pod >= 0) {
        for (const member of occupant.members.values()) disposeCharacter(member.character);
        occupant.members.clear();
        occupant.pod = -1;
      }
    }
    for (const occupant of live) {
      if (occupant.pod === -1 && occupant.slot.state !== 'WAITING' && working(occupant)) occupant.pod = this.freePod();
    }
    const parked = live.filter((occupant) => occupant.pod === -1 && occupant.slot.state !== 'WAITING');

    for (const occupant of this.occupants.values()) {
      const done = occupant.run.stage === 'done';
      const queued = waiting.indexOf(occupant);
      occupant.standing = done || occupant.pod >= 0 ? -1 : queued >= 0 ? queued : parked.indexOf(occupant);
      const zone: ZoneId = done ? 'corridor' : queued >= 0 ? 'you' : occupant.pod >= 0 ? podId(occupant.pod) : 'lounge';
      const target = done ? { ...EXIT }
        : queued >= 0 ? waitingSpot(queued, waiting.length)
          : occupant.pod >= 0 ? coordinatorSeat(occupant.pod) : loungeSpot(parked.indexOf(occupant));
      if (fresh.has(occupant)) Object.assign(occupant.character, { x: target.x, y: target.y, zone });
      else this.walk(occupant.character, target, zone, now);
      this.syncMembers(occupant, now, fresh.has(occupant));
    }
    this.paintPods();
    if (this.viewPending) this.setView(this.view);

    this.boardCards.render([...this.occupants.values()]
      .filter((occupant) => occupant.run.stage !== 'done')
      .map((occupant) => ({
        id: occupant.run.key,
        column: Math.min(RAIL_STAGES.length - 1, railIndex(occupant.run.stage)),
        title: `${occupant.run.key} · ${occupant.run.acPassed}/${occupant.run.acTotal}`,
        status: occupant.run.waiting ? 'review' as const : occupant.run.stalled || occupant.run.acFailed > 0 ? 'blocked' as const : 'running' as const,
      })));
  }

  setSelected(key: string | null): void {
    this.selected = key;
  }

  /** Moves the camera to a named point of view: `overview`, `lead`, `owner`, or `ticket:<key>` for that ticket's team. */
  setView(view: string): void {
    if (this.disposed) return;
    this.view = view;
    const at = (point: Point, lift: number): THREE.Vector3 => {
      const [x, , z] = toWorld(point.x, point.y);
      return new THREE.Vector3(x, lift, z);
    };
    const above = (target: THREE.Vector3, height: number, back: number) => ({ position: target.clone().add(new THREE.Vector3(0, height, back)), target });
    this.viewPending = false;
    if (view === 'lead') {
      this.flight = above(at({ x: LEAD_ZONE.x + LEAD_ZONE.width * 0.7, y: LEAD_ZONE.y + LEAD_ZONE.height * 0.6 }, 0.6), 7.5, 8.5);
    } else if (view === 'owner') {
      // From behind the owner's chair, looking over the desk at the queue.
      this.flight = { position: at({ x: 1330, y: 0 }, 10.5), target: at({ x: 1325, y: 262 }, 0.4) };
    } else if (view.startsWith('ticket:')) {
      const occupant = this.occupants.get(view.slice(7));
      if (!occupant || occupant.run.stage === 'done') {
        // The ticket has not reported in yet (or has just left): show everything and try again when it arrives.
        this.viewPending = !occupant;
        this.flight = { position: new THREE.Vector3(...OVERVIEW.position), target: new THREE.Vector3(...OVERVIEW.target) };
      } else if (occupant.pod >= 0) {
        const zone = podZone(occupant.pod);
        this.flight = above(at({ x: zone.x + zone.width / 2, y: zone.y + zone.height * 0.55 }, 0.5), 8.5, 9);
      } else {
        const path = occupant.character.walk?.path;
        const destination = path?.[path.length - 1] ?? occupant.character;
        this.flight = above(at({ x: destination.x, y: destination.y }, 0.8), 6, 7);
      }
    } else {
      this.flight = { position: new THREE.Vector3(...OVERVIEW.position), target: new THREE.Vector3(...OVERVIEW.target) };
    }
    if (this.reducedMotion.matches) this.landFlight();
  }

  private readonly cancelFlight = (): void => {
    this.flight = null;
  };

  private landFlight(): void {
    if (!this.flight) return;
    this.camera.position.copy(this.flight.position);
    this.controls.target.copy(this.flight.target);
    this.flight = null;
  }

  private advanceFlight(delta: number): void {
    if (!this.flight) return;
    const ease = 1 - Math.exp(-delta * 4.5);
    this.camera.position.lerp(this.flight.position, ease);
    this.controls.target.lerp(this.flight.target, ease);
    if (this.camera.position.distanceTo(this.flight.position) < 0.03) this.landFlight();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.labelRenderer.domElement.removeEventListener('click', this.handleLabelClick);
    for (const occupant of this.occupants.values()) this.removeOccupant(occupant);
    this.occupants.clear();
    disposeCharacter(this.lead);
    this.boardCards.dispose();
    for (const label of this.labels) label.element.remove();
    this.controls.removeEventListener('start', this.cancelFlight);
    this.controls.dispose();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }

  private removeOccupant(occupant: Occupant): void {
    for (const member of occupant.members.values()) disposeCharacter(member.character);
    occupant.members.clear();
    disposeCharacter(occupant.character);
  }

  private freePod(): number {
    const taken = new Set([...this.occupants.values()].map((occupant) => occupant.pod).filter((pod) => pod >= 0));
    for (let index = 0; index < MAX_PODS; index += 1) if (!taken.has(index)) return index;
    return -1;
  }

  private walk(character: Character, target: Point, zone: ZoneId, now: number): void {
    const destination = character.walk ? character.walk.path[character.walk.path.length - 1] : character;
    if (Math.hypot(target.x - destination.x, target.y - destination.y) < 4) {
      if (!character.walk) character.zone = zone;
      return;
    }
    if (this.reducedMotion.matches) {
      Object.assign(character, { x: target.x, y: target.y, zone, walk: null });
      return;
    }
    const path = routeThroughDoors({ x: character.x, y: character.y }, target, character.zone, zone);
    character.walk = { path, duration: calculateWalkDuration(path), started: now, toZone: zone };
    character.arrivedAt = null;
  }

  /** Moves a character along its walk; true while it is still on the way. */
  private advance(character: Character, now: number): boolean {
    if (!character.walk) return false;
    const progress = (now - character.walk.started) / character.walk.duration;
    const position = interpolatePathPosition(character.walk.path, progress);
    const dx = position.x - character.x;
    const dy = position.y - character.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.01) character.facing = Math.atan2(dx, dy);
    character.x = position.x;
    character.y = position.y;
    if (progress < 1) return true;
    character.zone = character.walk.toZone;
    character.walk = null;
    character.arrivedAt = now;
    return false;
  }

  /**
   * The ticket's character is its sub-coordinator. Everyone it (or the lead)
   * spawned for this ticket takes a desk in the pod and keeps it until the
   * server stops reporting them; a finished member stays, faded.
   */
  private syncMembers(occupant: Occupant, now: number, atOnce: boolean): void {
    const team = occupant.run.stage === 'done' || occupant.pod < 0 ? [] : splitTeam(occupant.run.members).members;
    const ids = new Set(team.map((member) => member.id));
    for (const [id, member] of occupant.members) {
      if (ids.has(id)) continue;
      disposeCharacter(member.character);
      occupant.members.delete(id);
    }
    occupant.hidden = 0;
    if (occupant.pod < 0) return;
    const zone = podId(occupant.pod);
    for (const info of team) {
      let member = occupant.members.get(info.id);
      if (!member) {
        const taken = new Set([...occupant.members.values()].map((item) => item.desk));
        let desk = 0;
        while (desk < MEMBER_DESKS && taken.has(desk)) desk += 1;
        if (desk >= MEMBER_DESKS) {
          occupant.hidden += 1;
          continue;
        }
        const seat = memberSeat(occupant.pod, desk);
        const start = atOnce ? seat : coordinatorSeat(occupant.pod);
        const character = createCharacter(occupant.run.key, shirtColor(occupant.run.key), start, zone, MEMBER_SCALE);
        this.scene.add(character.group);
        member = { info, character, desk };
        occupant.members.set(info.id, member);
      }
      member.info = info;
      this.walk(member.character, memberSeat(occupant.pod, member.desk), zone, now);
      setDimmed(member.character, info.state !== 'active');
    }
  }

  private paintPods(): void {
    const byPod = new Map([...this.occupants.values()].filter((occupant) => occupant.pod >= 0).map((occupant) => [occupant.pod, occupant]));
    this.pods.forEach((pod, index) => {
      const occupant = byPod.get(index);
      const active = occupant && occupant.run.stage !== 'done' ? occupant : undefined;
      const tint = active ? new THREE.Color(podColor(index)) : null;
      (pod.pad.material as THREE.MeshStandardMaterial).color.copy(tint ? new THREE.Color(0x2a2a31).lerp(tint, 0.16) : new THREE.Color(FREE_POD));
      const strip = pod.strip.material as THREE.MeshStandardMaterial;
      strip.color.copy(tint ?? new THREE.Color(0x34343b));
      strip.emissive.copy(tint ?? new THREE.Color(0x000000));
      const html = active ? this.signHtml(active) : '<span class="dock-pod-free">free pod</span>';
      if (pod.sign.element.innerHTML !== html) pod.sign.element.innerHTML = html;
    });
  }

  private signHtml(occupant: Occupant): string {
    const { run } = occupant;
    const team = splitTeam(run.members);
    const working = team.members.filter((member) => member.state === 'active').length;
    const extra = occupant.hidden > 0 ? ` +${occupant.hidden}` : '';
    return `<button type="button" class="dock-pod-sign" data-key="${escapeHtml(run.key)}" style="--pod:${podColor(occupant.pod)}">`
      + `<b>${escapeHtml(run.key)}</b>`
      + `<span>${run.kind === 'review' ? 'review · ' : ''}${escapeHtml(stageName(run.stage, run.kind))}</span>`
      + `<span>${team.members.length ? `${working}/${team.members.length} working${extra}` : 'no team yet'}</span>`
      + '</button>';
  }

  private buildRoom(): void {
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x23232c, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(-12, 24, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 16, bottom: -16, near: 1, far: 70 });
    this.scene.add(sun);

    const width = CANVAS_W * SCALE;
    const depth = CANVAS_H * SCALE;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(width + 2, 0.3, depth + 2), new THREE.MeshStandardMaterial({ color: 0x1c1c21, roughness: 0.95 }));
    floor.position.y = -0.15;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width + 2, 4.6, 0.3), new THREE.MeshLambertMaterial({ color: 0x24242a }));
    wall.position.set(0, 2.3, -depth / 2 - 0.9);
    wall.receiveShadow = true;
    this.scene.add(wall);

    const area = (zone: Zone, color: THREE.ColorRepresentation, tint: number) => {
      const [centerX, , centerZ] = toWorld(zone.x + zone.width / 2, zone.y + zone.height / 2);
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(zone.width * SCALE, 0.06, zone.height * SCALE),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2a2a31).lerp(new THREE.Color(color), tint), roughness: 0.9 }),
      );
      pad.position.set(centerX, 0.03, centerZ);
      pad.receiveShadow = true;
      this.scene.add(pad);
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(zone.width * SCALE, 0.08, 0.12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55 }),
      );
      strip.position.set(centerX, 0.05, centerZ - (zone.height * SCALE) / 2);
      this.scene.add(strip);
      return { pad, strip, centerX, frontZ: centerZ - (zone.height * SCALE) / 2, backZ: centerZ + (zone.height * SCALE) / 2 };
    };

    area(LEAD_ZONE, LEAD_COLOR, 0.13);
    const lounge = area(LOUNGE_ZONE, '#7c8190', 0.1);
    this.addLabel('dock-zone-label', 'Not being worked on', '#9aa0aa', [lounge.centerX, 0.1, lounge.frontZ + 0.35]);
    const youArea = area(YOU_ZONE, OWNER_COLOR, 0.13);
    this.addLabel('dock-zone-label', 'Your desk · decision gates', OWNER_COLOR, [youArea.centerX - YOU_ZONE.width * SCALE * 0.3, 0.1, youArea.frontZ + 0.35]);

    for (let index = 0; index < MAX_PODS; index += 1) {
      const zone = podZone(index);
      const pod = area(zone, FREE_POD, 0);
      const sign = this.addLabel('dock-pod-label', '', '', [pod.centerX - zone.width * SCALE * 0.3, 0.12, pod.frontZ + 0.42]);
      this.pods.push({ pad: pod.pad, strip: pod.strip, sign });
    }

    const [exitX, , exitZ] = toWorld(EXIT.x + 22, EXIT.y);
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 2.6, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2e, emissive: 0x62cf9f, emissiveIntensity: 0.15 }),
    );
    door.position.set(exitX, 1.3, exitZ);
    this.scene.add(door);
    this.addLabel('dock-zone-label', 'Done →', '#62cf9f', [exitX, 3, exitZ]);
  }

  private addLabel(className: string, text: string, color: string, position: [number, number, number]): CSS2DObject {
    const element = document.createElement('div');
    element.className = className;
    element.textContent = text;
    if (color) element.style.color = color;
    const label = new CSS2DObject(element);
    label.position.set(...position);
    this.scene.add(label);
    this.labels.push(label);
    return label;
  }

  private placeFallback(item: FurnitureItem): void {
    const [width, depth] = ITEM_FOOTPRINT[item.type];
    const [x, , z] = toWorld(item.x + width / 2, item.y + depth / 2);
    const height = FALLBACK_HEIGHT[item.type] ?? 0.72;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width * SCALE, height, depth * SCALE),
      new THREE.MeshLambertMaterial({ color: item.type === 'computer' ? 0x1a1a22 : 0x7b6a55 }),
    );
    mesh.position.set(x, (item.type === 'computer' ? 0.61 : 0) + height / 2, z);
    mesh.castShadow = true;
    this.scene.add(mesh);
  }

  private async loadFurniture(): Promise<void> {
    const loader = new GLTFLoader();
    const cache = new Map<string, Promise<GLTF>>();
    const load = (file: string) => {
      let pending = cache.get(file);
      if (!pending) {
        pending = loader.loadAsync(`${this.options.assetBase}/furniture/${file}`);
        cache.set(file, pending);
      }
      return pending;
    };
    try {
      const models = await Promise.all(FURNITURE.map((item) => load(FURNITURE_GLB[item.type])));
      if (this.disposed) return;
      FURNITURE.forEach((item, index) => {
        const model = models[index].scene.clone(true);
        const [width, depth] = ITEM_FOOTPRINT[item.type];
        const [x, , z] = toWorld(item.x + width / 2, item.y + depth / 2);
        model.scale.set(...FURNITURE_SCALE[item.type]);
        // The models keep their origin at a corner: recentre each on its footprint.
        const bounds = new THREE.Box3().setFromObject(model);
        const centre = bounds.getCenter(new THREE.Vector3());
        model.position.set(-centre.x, -bounds.min.y, -centre.z);
        const holder = new THREE.Group();
        holder.add(model);
        holder.position.set(x, FURNITURE_Y_OFFSET[item.type] ?? 0, z);
        holder.rotation.y = ((item.r ?? 0) * Math.PI) / 2;
        // A hundred-odd small desks each casting a shadow is the costly part; only the large pieces do.
        const casts = item.type !== 'computer' && item.type !== 'chair';
        model.traverse((object) => {
          if ((object as THREE.Mesh).isMesh) {
            object.castShadow = casts;
            object.receiveShadow = true;
          }
        });
        this.scene.add(holder);
      });
    } catch {
      if (!this.disposed) FURNITURE.forEach((item) => this.placeFallback(item));
    }
  }

  private coordinatorTag(occupant: Occupant, pose: Pose | null): string {
    const { run } = occupant;
    if (run.stage === 'done') return '<span class="dock-agent-tag dock-agent-tag-done">Done ✓</span>';
    const emote = pose === 'SeatedWaiting' ? ASK_EMOTE : pose === 'Asleep' ? ZZZ_EMOTE : pose === 'SeatedThinking' ? THINK_EMOTE : '';
    const role = splitTeam(run.members).coordinator ? 'coordinator' : 'lead direct';
    // At its desk the pod's sign already names the ticket; away from it (the owner's queue, the door) the tag has to.
    // Standing in the owner's queue or the lounge the tag is the ticket key alone, so several fit side by side;
    // on the way somewhere it also says what the ticket is, and at its desk the pod's sign already names it.
    const label = pose === 'SeatedWaiting' || (occupant.pod < 0 && !occupant.character.walk) ? escapeHtml(run.key)
      : occupant.character.walk || occupant.pod < 0 ? `${escapeHtml(run.key)} <small>${occupant.pod < 0 ? escapeHtml(stageName(run.stage, run.kind)) : role}</small>` : role;
    return `${emote}<button type="button" class="dock-agent-tag" data-key="${escapeHtml(run.key)}"><i style="background:${stageColor(run.stage)}"></i>${label}</button>`;
  }

  private memberTag(key: string, info: TimelineAgent): string {
    const active = info.state === 'active';
    const title = `${info.name}${info.detail ? ` — ${info.detail}` : ''}${active ? (info.tool ? ` · ${info.tool}` : '') : ' · done'}`;
    return `<button type="button" class="dock-agent-tag dock-agent-tag-member${active ? '' : ' is-done'}" data-key="${escapeHtml(key)}" title="${escapeHtml(title)}"><i></i><span>${escapeHtml(info.name)}</span></button>`;
  }

  private place(character: Character): void {
    const [worldX, , worldZ] = toWorld(character.x, character.y);
    character.group.position.x = worldX;
    character.group.position.z = worldZ;
  }

  private setTag(character: Character, html: string): void {
    if (html === character.tagHtml) return;
    character.tagHtml = html;
    character.tag.element.innerHTML = html;
  }

  private readonly frame = (): void => {
    if (this.disposed) return;
    const now = clock();
    const delta = Math.min(Math.max(now - this.lastFrame, 0), 0.05);
    this.lastFrame = now;
    const still = this.reducedMotion.matches;
    let tickets = 0;
    let busy = 0;
    let delegated = 0;

    for (const occupant of this.occupants.values()) {
      const { character, run, slot } = occupant;
      tickActivity(slot, now);
      const pose = poseOf(slot, now);
      const walking = this.advance(character, now);
      const done = run.stage === 'done';
      const queued = !done && slot.state === 'WAITING';
      const working = [...occupant.members.values()].filter((member) => member.info.state === 'active').length;
      if (!done) {
        tickets += 1;
        if (slot.state === 'ACTIVE') busy += 1;
        if (occupant.members.size > 0) delegated += 1;
      }
      if (!walking) character.facing = done ? Math.PI / 2 : queued ? Math.PI : occupant.pod >= 0 ? Math.PI : 0;
      this.place(character);
      // People standing in a row hold their tags at alternating heights, so neighbouring tags do not cover each other.
      character.tag.position.y = TAG_HEIGHT + (occupant.standing >= 0 && !walking ? (occupant.standing % (queued ? 2 : 3)) * TAG_STEP : 0);
      const seated = !done && !queued && occupant.pod >= 0;
      animateCharacter(character, pose, walking, delta, still, { seated, folded: working > 0 });

      const gone = done && !walking && now - (character.arrivedAt ?? now) >= DONE_LINGER_SECONDS;
      character.group.visible = !gone;
      character.tag.element.style.display = gone ? 'none' : '';
      this.setTag(character, this.coordinatorTag(occupant, walking || (seated && working > 0) ? null : pose));
      const isSelected = run.key === this.selected;
      character.tag.element.classList.toggle('is-selected', isSelected);
      character.ring.visible = isSelected;

      for (const member of occupant.members.values()) {
        const body = member.character;
        const moving = this.advance(body, now);
        if (!moving) body.facing = Math.PI;
        this.place(body);
        animateCharacter(body, member.info.state === 'active' ? 'SeatedTyping' : 'SeatedThinking', moving, delta, still, { seated: true });
        this.setTag(body, this.memberTag(run.key, member.info));
      }
    }

    // The lead never leaves its desk: it types while it handles a ticket itself and sits back once the work is delegated.
    this.lead.facing = Math.PI;
    this.place(this.lead);
    const leadPose: Pose = busy > 0 ? 'SeatedTyping' : tickets > 0 ? 'SeatedThinking' : 'Asleep';
    animateCharacter(this.lead, leadPose, false, delta, still, { seated: true, folded: tickets > 0 && delegated === tickets });
    this.setTag(this.lead, `${tickets === 0 ? ZZZ_EMOTE : ''}<span class="dock-agent-tag dock-agent-tag-lead">LEAD <small>${tickets} ${tickets === 1 ? 'ticket' : 'tickets'}</small></span>`);

    const [boardWidth, boardHeight] = this.boardPixelSize();
    this.boardCards.setBoardSize(boardWidth, boardHeight);
    this.advanceFlight(delta);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private boardPixelSize(): [number, number] {
    const project = (x: number, y: number): [number, number] => {
      this.corner.set(x, y, 0.07);
      this.board.localToWorld(this.corner);
      this.corner.project(this.camera);
      return [((this.corner.x + 1) / 2) * this.host.clientWidth, ((1 - this.corner.y) / 2) * this.host.clientHeight];
    };
    const low = project(-BOARD_SIZE[0] / 2, -BOARD_SIZE[1] / 2);
    const high = project(BOARD_SIZE[0] / 2, BOARD_SIZE[1] / 2);
    return [Math.abs(high[0] - low[0]), Math.abs(high[1] - low[1])];
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = [event.clientX, event.clientY];
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const start = this.pointerDown;
    this.pointerDown = null;
    if (!start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    ), this.camera);
    const groups = [...this.occupants.values()].filter((occupant) => occupant.character.group.visible)
      .flatMap((occupant) => [occupant.character.group, ...[...occupant.members.values()].map((member) => member.character.group)]);
    const key = raycaster.intersectObjects(groups, true)[0]?.object.userData.key;
    if (typeof key === 'string' && key) this.options.onSelect(key);
  };

  private readonly handleLabelClick = (event: MouseEvent): void => {
    const key = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset.key;
    if (key) this.options.onSelect(key);
  };
}
