import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { shirtColor, stageColor, type AgentRun } from '../runs';
import { clock, poseOf, slotFromServer, tickActivity, type ActivitySlot, type Pose } from './activity';
import { buildBoardCards, type BoardCards } from './board';
import { animateCharacter, createCharacter, disposeCharacter, type Character } from './character';
import { ASK_EMOTE, THINK_EMOTE, ZZZ_EMOTE } from './emotes';
import {
  EXIT, FURNITURE, SPOTS, STAGE_ZONES, WAITING_GAP, WAITING_ROW, ZONES, ZONE_META, zoneForStage,
  type StageZone, type ZoneId,
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

interface Occupant {
  run: AgentRun;
  slot: ActivitySlot;
  character: Character;
}

const BACKGROUND = 0x0d0d0f;
const OWNER_COLOR = '#e9e2d0';
const DONE_LINGER_SECONDS = 4;
const BOARD_SIZE: [number, number] = [22, 3.1];
const FALLBACK_HEIGHT: Partial<Record<FurnitureItem['type'], number>> = {
  computer: 0.35, chair: 0.5, plant: 0.7, lamp: 1.4, bookshelf: 1.7, cabinet: 1,
};

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (char) => (
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char
));

/**
 * The 3D office. DOCK owns the floor plan and the frame loop; characters,
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
  private readonly labels: CSS2DObject[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly corner = new THREE.Vector3();
  private selected: string | null = null;
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
    this.camera.position.set(-1.2, 16, 20.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.9, -0.6);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = 1.42;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 46;
    this.controls.update();

    this.buildRoom();
    const depth = CANVAS_H * SCALE;
    this.board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE[0], BOARD_SIZE[1], 0.14), new THREE.MeshLambertMaterial({ color: 0x15161a }));
    this.board.position.set(0, 2.5, -depth / 2 - 0.68);
    this.scene.add(this.board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE[0] + 0.4, BOARD_SIZE[1] + 0.4, 0.1), new THREE.MeshLambertMaterial({ color: 0x33343b }));
    frame.position.set(0, 2.5, -depth / 2 - 0.74);
    this.scene.add(frame);
    this.boardCards = buildBoardCards(
      this.board,
      STAGE_ZONES.map((zone) => ZONE_META[zone].name.toUpperCase()),
      (key) => this.options.onSelect(key),
    );

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
      disposeCharacter(occupant.character);
      this.occupants.delete(key);
    }

    const fresh: Occupant[] = [];
    for (const run of runs) {
      const slot = slotFromServer(run, now);
      const existing = this.occupants.get(run.key);
      if (existing) {
        existing.run = run;
        existing.slot = slot;
        continue;
      }
      const character = createCharacter(run.key, shirtColor(run.key), { x: 0, y: 0 }, 'corridor');
      this.scene.add(character.group);
      const occupant = { run, slot, character };
      this.occupants.set(run.key, occupant);
      fresh.push(occupant);
    }

    // New arrivals start in place; everyone else walks to wherever their ticket now belongs.
    for (const occupant of this.occupants.values()) {
      const target = this.spotFor(occupant);
      const zone = this.zoneOf(occupant);
      if (fresh.includes(occupant)) {
        Object.assign(occupant.character, { x: target.x, y: target.y, zone });
        if (occupant.run.stage === 'done') occupant.character.arrivedAt = now - DONE_LINGER_SECONDS;
        continue;
      }
      this.retarget(occupant, target, zone, now);
    }

    this.boardCards.render([...this.occupants.values()]
      .filter((occupant) => occupant.run.stage !== 'done')
      .map((occupant) => {
        const zone = zoneForStage(occupant.run.stage);
        return {
          id: occupant.run.key,
          column: zone === 'corridor' ? 0 : STAGE_ZONES.indexOf(zone),
          title: `${occupant.run.key} · ${occupant.run.acPassed}/${occupant.run.acTotal}`,
          status: occupant.run.waiting ? 'review' as const : occupant.run.stalled || occupant.run.acFailed > 0 ? 'blocked' as const : 'running' as const,
        };
      }));
  }

  setSelected(key: string | null): void {
    this.selected = key;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.labelRenderer.domElement.removeEventListener('click', this.handleLabelClick);
    for (const occupant of this.occupants.values()) disposeCharacter(occupant.character);
    this.occupants.clear();
    this.boardCards.dispose();
    for (const label of this.labels) label.element.remove();
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

  private zoneOf(occupant: Occupant): ZoneId {
    if (occupant.run.stage === 'done') return 'corridor';
    return occupant.slot.state === 'WAITING' ? 'you' : zoneForStage(occupant.run.stage);
  }

  private spotFor(occupant: Occupant): Point {
    if (occupant.run.stage === 'done') return { ...EXIT };
    const all = [...this.occupants.values()].filter((other) => other.run.stage !== 'done');
    if (occupant.slot.state === 'WAITING') {
      const queue = all.filter((other) => other.slot.state === 'WAITING');
      const index = Math.max(0, queue.indexOf(occupant));
      const perRow = 6;
      const rowSize = Math.min(perRow, queue.length - Math.floor(index / perRow) * perRow);
      return {
        x: WAITING_ROW.x + ((index % perRow) - (rowSize - 1) / 2) * WAITING_GAP,
        y: WAITING_ROW.y - Math.floor(index / perRow) * 70,
      };
    }
    const zone = zoneForStage(occupant.run.stage) as StageZone;
    const same = all.filter((other) => other.slot.state !== 'WAITING' && zoneForStage(other.run.stage) === zone);
    const spots = SPOTS[zone];
    return spots[Math.max(0, same.indexOf(occupant)) % spots.length];
  }

  private retarget(occupant: Occupant, target: Point, zone: ZoneId, now: number): void {
    const { character } = occupant;
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

    for (const id of [...STAGE_ZONES, 'you'] as const) {
      const zone = ZONES[id];
      const colorValue = id === 'you' ? OWNER_COLOR : ZONE_META[id].color;
      const color = new THREE.Color(colorValue);
      const [centerX, , centerZ] = toWorld(zone.x + zone.width / 2, zone.y + zone.height / 2);
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(zone.width * SCALE, 0.06, zone.height * SCALE),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2a2a31).lerp(color, 0.13), roughness: 0.9 }),
      );
      pad.position.set(centerX, 0.03, centerZ);
      pad.receiveShadow = true;
      this.scene.add(pad);

      const edgeZ = id === 'you' ? centerZ - (zone.height * SCALE) / 2 : centerZ + (zone.height * SCALE) / 2;
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(zone.width * SCALE, 0.08, 0.12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 }),
      );
      strip.position.set(centerX, 0.05, edgeZ);
      this.scene.add(strip);
      // The owner's label sits off-centre so the queue of raised hands does not cover it.
      const labelX = id === 'you' ? centerX - zone.width * SCALE * 0.34 : centerX;
      this.addLabel(id === 'you' ? 'Your desk · decision gates' : ZONE_META[id].name, colorValue, [labelX, 0.1, edgeZ + (id === 'you' ? -0.45 : 0.45)]);
    }

    const [exitX, , exitZ] = toWorld(EXIT.x + 30, EXIT.y);
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 2.6, 1.7),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2e, emissive: 0x62cf9f, emissiveIntensity: 0.15 }),
    );
    door.position.set(exitX, 1.3, exitZ);
    this.scene.add(door);
    this.addLabel('Done →', '#62cf9f', [exitX, 3, exitZ]);
  }

  private addLabel(text: string, color: string, position: [number, number, number]): void {
    const element = document.createElement('div');
    element.className = 'dock-zone-label';
    element.textContent = text;
    element.style.color = color;
    const label = new CSS2DObject(element);
    label.position.set(...position);
    this.scene.add(label);
    this.labels.push(label);
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
        model.traverse((object) => {
          if ((object as THREE.Mesh).isMesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        this.scene.add(holder);
      });
    } catch {
      if (!this.disposed) FURNITURE.forEach((item) => this.placeFallback(item));
    }
  }

  private tagHtml(run: AgentRun, pose: Pose | null): string {
    if (run.stage === 'done') return '<span class="dock-agent-tag dock-agent-tag-done">Done ✓</span>';
    const emote = pose === 'SeatedWaiting' ? ASK_EMOTE : pose === 'Asleep' ? ZZZ_EMOTE : pose === 'SeatedThinking' ? THINK_EMOTE : '';
    return `${emote}<button type="button" class="dock-agent-tag" data-key="${escapeHtml(run.key)}"><i style="background:${stageColor(run.stage)}"></i>${escapeHtml(run.key)}</button>`;
  }

  private readonly frame = (): void => {
    if (this.disposed) return;
    const now = clock();
    const delta = Math.min(Math.max(now - this.lastFrame, 0), 0.05);
    this.lastFrame = now;
    const still = this.reducedMotion.matches;

    for (const occupant of this.occupants.values()) {
      const { character, run, slot } = occupant;
      tickActivity(slot, now);
      const pose = poseOf(slot, now);
      let walking = false;
      if (character.walk) {
        const progress = (now - character.walk.started) / character.walk.duration;
        const position = interpolatePathPosition(character.walk.path, progress);
        const dx = position.x - character.x;
        const dy = position.y - character.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.01) character.facing = Math.atan2(dx, dy);
        character.x = position.x;
        character.y = position.y;
        walking = progress < 1;
        if (!walking) {
          character.zone = character.walk.toZone;
          character.walk = null;
          character.arrivedAt = now;
        }
      }
      if (!walking) character.facing = run.stage === 'done' ? Math.PI / 2 : pose === 'SeatedWaiting' ? 0 : Math.PI;

      const [worldX, , worldZ] = toWorld(character.x, character.y);
      character.group.position.x = worldX;
      character.group.position.z = worldZ;
      animateCharacter(character, pose, walking, delta, still);

      const gone = run.stage === 'done' && !walking && now - (character.arrivedAt ?? now) >= DONE_LINGER_SECONDS;
      character.group.visible = !gone;
      character.tag.element.style.display = gone ? 'none' : '';
      const html = this.tagHtml(run, walking ? null : pose);
      if (html !== character.tagHtml) {
        character.tagHtml = html;
        character.tag.element.innerHTML = html;
      }
      const isSelected = run.key === this.selected;
      character.tag.element.classList.toggle('is-selected', isSelected);
      character.ring.visible = isSelected;
    }

    const [boardWidth, boardHeight] = this.boardPixelSize();
    this.boardCards.setBoardSize(boardWidth, boardHeight);
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
    const groups = [...this.occupants.values()].filter((occupant) => occupant.character.group.visible).map((occupant) => occupant.character.group);
    const key = raycaster.intersectObjects(groups, true)[0]?.object.userData.key;
    if (typeof key === 'string') this.options.onSelect(key);
  };

  private readonly handleLabelClick = (event: MouseEvent): void => {
    const key = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset.key;
    if (key) this.options.onSelect(key);
  };
}
