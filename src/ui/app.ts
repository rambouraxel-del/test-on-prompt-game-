import { MAP, RES_KEYS, RES_LABEL, SEASONS, VICTORY, AUTOSAVE_SECONDS } from '../config/balance';
import { BUILDINGS, CATEGORY_LABEL, type BuildingType, type Category } from '../config/buildings';
import { computeAlerts, type Alert } from '../sim/alerts';
import { autonomy, averageHappiness, demand, EVENT_LABEL, recentRates, refreshInstant } from '../sim/logic';
import { hashSeed } from '../sim/rng';
import { Runner } from '../sim/runner';
import { Game } from '../sim/world';
import { Renderer, drawMinimap, type Overlay } from '../render/renderer';
import { TS, iconURL } from '../render/sprites';
import { $, esc, fmt, patch, signed } from './dom';
import {
  buildingPanel,
  buildingThumb,
  citizenPanel,
  costHTML,
  fmtCostPlain,
  helpModal,
  icon,
  nodePanel,
  objectivesModal,
  parcelPanel,
  populationModal,
  RES_ICON,
} from './panels';
import {
  downloadSave,
  loadSettings,
  parseSave,
  pickFile,
  readSlot,
  saveSettings,
  slotInfo,
  writeSlot,
  type Settings,
  type Slot,
} from './storage';

type Tool = { kind: 'select' } | { kind: 'build'; type: BuildingType; rot: 0 | 1 } | { kind: 'road' } | { kind: 'demolish' } | { kind: 'parcel' };
type Selection =
  | { kind: 'building'; id: number }
  | { kind: 'citizen'; id: number }
  | { kind: 'node'; x: number; y: number }
  | { kind: 'parcel'; idx: number }
  | null;

const TUTORIAL = [
  { title: 'Construire une exploitation', text: 'Ouvrez l’onglet <b>Ressources</b> et placez une <b>cabane de cueilleurs</b> ou un <b>puits</b> près des routes.' },
  { title: 'La relier', text: 'Choisissez l’outil <b>Route</b> et tracez une route qui touche le bâtiment et rejoint l’hôtel de ville.' },
  { title: 'Affecter du personnel', text: 'Cliquez sur l’exploitation puis sur <b>+</b> pour affecter des adultes disponibles.' },
  { title: 'Sécuriser eau et nourriture', text: 'Ayez au moins un <b>puits</b> et une <b>cabane de cueilleurs</b> reliés, avec du personnel. Surveillez l’autonomie dans la barre du haut.' },
  { title: 'Améliorer le bonheur', text: 'Construisez un <b>autel</b> relié près des maisons, ou un <b>jardin</b>.' },
  { title: 'Préparer une naissance', text: 'Un couple a besoin d’une <b>place libre</b> dans sa maison. Construisez une maison si besoin et attendez la première grossesse.' },
];

export class App {
  game: Game | null = null;
  runner: Runner | null = null;
  renderer: Renderer;
  settings: Settings = loadSettings();
  tool: Tool = { kind: 'select' };
  sel: Selection = null;
  category: Category = 'habitat';
  keys = new Set<string>();
  hoverTile: [number, number] | null = null;
  mouse: [number, number] = [0, 0];
  panning = false;
  panLast: [number, number] = [0, 0];
  roadDrag: [number, number][] | null = null;
  demolishDrag: [number, number][] | null = null;
  demolishStart: number | null = null;
  touches = new Map<number, [number, number]>();
  touchStart: { x: number; y: number; t: number; moved: boolean } | null = null;
  pinchDist = 0;
  lastFrame = performance.now();
  realTime = 0;
  uiTimer = 0;
  miniTimer = 0;
  autosaveTimer = 0;
  modalOpen = false;
  modalPauses = false;
  speedBeforePause = 1;
  alerts: Alert[] = [];
  demoGame: Game | null = null;
  inMenu = true;
  tutorialHidden = false;
  shownVictory = false;

  constructor() {
    const canvas = $('#view') as HTMLCanvasElement;
    this.renderer = new Renderer(canvas);
    this.renderer.resize();
    window.addEventListener('resize', () => this.renderer.resize());
    this.bindInput(canvas);
    this.bindUI();
    document.addEventListener('visibilitychange', () => {
      this.lastFrame = performance.now();
      this.runner?.reset();
      if (document.hidden && this.game && !this.inMenu && !this.game.s.progress.defeat) writeSlot('auto', this.game);
    });
    this.showMainMenu();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ================================================================ boucle
  frame(now: number) {
    const dt = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.realTime += dt;
    const g = this.game ?? this.demoGame;
    if (g) {
      if (this.game && this.runner && !this.inMenu && !document.hidden && !(this.modalOpen && this.modalPauses)) {
        this.runner.advance(dt);
      }
      this.updateCamera(dt);
      this.renderer.draw(g, this.overlay(), this.runner?.alpha ?? 0, this.realTime);
      if (this.game && !this.inMenu) {
        this.uiTimer -= dt;
        if (this.uiTimer <= 0) {
          this.uiTimer = 0.2;
          this.updateHUD();
        }
        this.miniTimer -= dt;
        if (this.miniTimer <= 0) {
          this.miniTimer = 0.5;
          const mm = $('#minimap') as HTMLCanvasElement;
          drawMinimap(mm, this.game, this.renderer.cam, this.renderer.canvas.clientWidth, this.renderer.canvas.clientHeight);
        }
        if (this.settings.autosave > 0 && !this.game.s.progress.defeat && this.runner && !this.runner.paused) {
          this.autosaveTimer += dt;
          if (this.autosaveTimer >= this.settings.autosave) {
            this.autosaveTimer = 0;
            const r = writeSlot('auto', this.game);
            if (r.ok) this.toast('Sauvegarde automatique effectuée', 'info', 1500);
          }
        }
      } else if (this.inMenu && this.demoGame) {
        const cam = this.renderer.cam;
        cam.x = (MAP.SIZE * TS) / 2 + Math.sin(this.realTime * 0.05) * 200;
        cam.y = (MAP.SIZE * TS) / 2 + Math.cos(this.realTime * 0.04) * 120;
        cam.zoom = 2;
        this.demoGame.agents.update(dt);
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  updateCamera(dt: number) {
    if (this.inMenu) return;
    const cam = this.renderer.cam;
    const sp = (520 * this.settings.panSpeed * dt) / Math.sqrt(cam.zoom);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) cam.y -= sp;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) cam.y += sp;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) cam.x -= sp;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) cam.x += sp;
    cam.clamp();
  }

  overlay(): Overlay {
    const g = this.game;
    const ov: Overlay = {
      hoverTile: this.inMenu ? null : this.hoverTile,
      preview: null,
      roadTiles: [],
      demolishTiles: [],
      selectedBuilding: this.sel?.kind === 'building' ? this.sel.id : null,
      selectedCitizen: this.sel?.kind === 'citizen' ? this.sel.id : null,
      selectedParcel: this.sel?.kind === 'parcel' ? this.sel.idx : null,
      showParcels: this.tool.kind === 'parcel' || this.sel?.kind === 'parcel',
      showGrid: this.settings.showGrid && (this.tool.kind === 'build' || this.tool.kind === 'road'),
      tool: this.tool.kind,
      demolishHover: null,
    };
    if (!g || this.inMenu) return ov;
    if (this.tool.kind === 'build' && this.hoverTile) {
      const [w, h] = g.footprint(this.tool.type, this.tool.rot);
      const x = this.hoverTile[0] - Math.floor((w - 1) / 2);
      const y = this.hoverTile[1] - Math.floor((h - 1) / 2);
      ov.preview = { type: this.tool.type, x, y, w, h, ok: g.canPlace(this.tool.type, x, y, this.tool.rot).ok };
    }
    if (this.tool.kind === 'road') {
      const tiles = this.roadDrag ?? (this.hoverTile ? [this.hoverTile] : []);
      const seen = new Set<string>();
      for (const [x, y] of tiles) {
        const k = x + ',' + y;
        if (seen.has(k) || !g.inBounds(x, y)) continue;
        seen.add(k);
        if (g.s.roads[y * g.N + x]) continue;
        ov.roadTiles.push({ x, y, ok: g.roadCheck(x, y) === null });
      }
    }
    if (this.tool.kind === 'demolish') {
      if (this.demolishDrag) ov.demolishTiles = this.demolishDrag.filter(([x, y]) => g.inBounds(x, y) && g.s.roads[y * g.N + x]);
      else if (this.hoverTile) {
        const b = g.buildingAt(...this.hoverTile);
        if (b) ov.demolishHover = b.id;
        else if (g.inBounds(...this.hoverTile) && g.s.roads[this.hoverTile[1] * g.N + this.hoverTile[0]]) ov.demolishTiles = [this.hoverTile];
      }
    }
    return ov;
  }

  // ================================================================ parties
  newGame(seed?: number) {
    const s = seed ?? Math.floor(Math.random() * 1e9);
    this.startGame(Game.create(s));
    this.toast(`Nouvelle colonie fondée (graine ${s}).`, 'good');
  }

  startGame(g: Game, paused = false) {
    this.game = g;
    this.runner = new Runner(g);
    this.runner.speed = 1;
    this.runner.paused = paused;
    this.speedBeforePause = 1;
    this.demoGame = null;
    this.inMenu = false;
    this.sel = null;
    this.tool = { kind: 'select' };
    this.shownVictory = g.s.progress.victory;
    this.autosaveTimer = 0;
    g.onVictory = () => this.showVictory();
    g.onDefeat = () => this.showDefeat();
    g.onLog = (e) => {
      if (e.kind === 'bad') this.toast(e.text, 'bad', 3500);
    };
    // Pré-calcul des données dérivées sans avancer le calendrier.
    refreshInstant(g);
    this.centerOnTownhall();
    $('#menu').hidden = true;
    $('#hud').hidden = false;
    this.closeModal();
    this.renderBuildBar();
    this.updateHUD();
    this.uiTimer = 0;
  }

  centerOnTownhall() {
    if (!this.game) return;
    const th = this.game.townhall();
    const [cx, cy] = this.game.center(th);
    this.renderer.cam.x = cx * TS;
    this.renderer.cam.y = cy * TS;
    this.renderer.cam.zoom = Math.max(this.renderer.cam.zoom, 2);
  }

  focus(x: number, y: number) {
    this.renderer.cam.x = x * TS;
    this.renderer.cam.y = y * TS;
    this.renderer.cam.clamp();
  }

  setSpeed(s: number) {
    if (!this.runner) return;
    if (s === 0) {
      if (!this.runner.paused) this.speedBeforePause = this.runner.speed;
      this.runner.paused = true;
    } else {
      this.runner.paused = false;
      this.runner.speed = s;
    }
    this.updateHUD();
  }

  // ================================================================ entrées
  bindInput(canvas: HTMLCanvasElement) {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.inMenu) return;
      this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    canvas.addEventListener('pointerdown', (e) => {
      if (this.inMenu) return;
      canvas.setPointerCapture(e.pointerId);
      this.mouse = [e.offsetX, e.offsetY];
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, [e.offsetX, e.offsetY]);
        if (this.touches.size === 1) {
          this.touchStart = { x: e.offsetX, y: e.offsetY, t: performance.now(), moved: false };
          this.panLast = [e.offsetX, e.offsetY];
          this.hoverTile = this.renderer.screenToTile(e.offsetX, e.offsetY);
          if (this.tool.kind === 'road') this.roadDrag = [this.hoverTile];
        } else if (this.touches.size === 2) {
          const [a, b] = [...this.touches.values()];
          this.pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
          this.roadDrag = null;
          this.touchStart = null;
        }
        return;
      }
      if (e.button === 1 || e.button === 2) {
        this.panning = true;
        this.panLast = [e.offsetX, e.offsetY];
        e.preventDefault();
        return;
      }
      if (e.button === 0) this.primaryDown(this.renderer.screenToTile(e.offsetX, e.offsetY), e.offsetX, e.offsetY);
    });

    canvas.addEventListener('pointermove', (e) => {
      this.mouse = [e.offsetX, e.offsetY];
      if (this.inMenu) return;
      const tile = this.renderer.screenToTile(e.offsetX, e.offsetY);
      if (e.pointerType === 'touch') {
        if (!this.touches.has(e.pointerId)) return;
        this.touches.set(e.pointerId, [e.offsetX, e.offsetY]);
        if (this.touches.size === 2) {
          const [a, b] = [...this.touches.values()];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (this.pinchDist > 0) this.zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / this.pinchDist);
          this.pinchDist = d;
          return;
        }
        if (this.touchStart && Math.hypot(e.offsetX - this.touchStart.x, e.offsetY - this.touchStart.y) > 10) this.touchStart.moved = true;
        if (this.tool.kind === 'road' && this.roadDrag) {
          this.hoverTile = tile;
          this.extendDrag(this.roadDrag, tile);
        } else if (this.touchStart?.moved) {
          const cam = this.renderer.cam;
          cam.x -= (e.offsetX - this.panLast[0]) / cam.zoom;
          cam.y -= (e.offsetY - this.panLast[1]) / cam.zoom;
          cam.clamp();
        }
        this.panLast = [e.offsetX, e.offsetY];
        return;
      }
      this.hoverTile = tile;
      if (this.panning) {
        const cam = this.renderer.cam;
        cam.x -= (e.offsetX - this.panLast[0]) / cam.zoom;
        cam.y -= (e.offsetY - this.panLast[1]) / cam.zoom;
        cam.clamp();
        this.panLast = [e.offsetX, e.offsetY];
      }
      if (this.roadDrag) this.extendDrag(this.roadDrag, tile);
      if (this.demolishDrag) this.extendDrag(this.demolishDrag, tile);
      this.updateTooltip();
    });

    const up = (e: PointerEvent) => {
      if (this.inMenu) return;
      if (e.pointerType === 'touch') {
        const wasSingle = this.touches.size === 1;
        this.touches.delete(e.pointerId);
        if (this.touches.size < 2) this.pinchDist = 0;
        if (wasSingle) {
          if (this.tool.kind === 'road' && this.roadDrag) this.finishRoad();
          else if (this.touchStart && !this.touchStart.moved) {
            const tile = this.renderer.screenToTile(e.offsetX, e.offsetY);
            this.hoverTile = tile;
            this.primaryDown(tile, e.offsetX, e.offsetY);
            this.primaryUp();
          }
          this.touchStart = null;
        }
        return;
      }
      if (this.panning && (e.button === 1 || e.button === 2)) this.panning = false;
      if (e.button === 0) this.primaryUp();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', (e) => {
      this.touches.delete(e.pointerId);
      this.panning = false;
      this.roadDrag = null;
      this.demolishDrag = null;
    });
    canvas.addEventListener('pointerleave', () => {
      if (!this.roadDrag && !this.demolishDrag) this.hoverTile = null;
      $('#tooltip').hidden = true;
    });

    window.addEventListener('keydown', (e) => {
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) return;
      if (this.inMenu) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        this.escape();
        return;
      }
      if (this.modalOpen) return;
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyR' && this.tool.kind === 'build') {
        const d = BUILDINGS[this.tool.type];
        if (d.w !== d.h) this.tool.rot = this.tool.rot ? 0 : 1;
        this.updateTooltip();
      }
      if (e.code === 'Space' && this.runner) this.setSpeed(this.runner.paused ? this.speedBeforePause || 1 : 0);
      if (e.code === 'Digit1' || e.code === 'Numpad1') this.setSpeed(1);
      if (e.code === 'Digit2' || e.code === 'Numpad2') this.setSpeed(2);
      if (e.code === 'Digit3' || e.code === 'Numpad3') this.setSpeed(4);
      if (e.code === 'KeyC') this.centerOnTownhall();
      if (e.code === 'KeyP') this.openModal(() => (this.game ? populationModal(this.game) : ''), 'wide');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const cam = this.renderer.cam;
    const [wx, wy] = this.renderer.screenToWorld(sx, sy);
    cam.zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, cam.zoom * factor));
    const [nx, ny] = this.renderer.screenToWorld(sx, sy);
    cam.x += wx - nx;
    cam.y += wy - ny;
    cam.clamp();
  }

  extendDrag(list: [number, number][], tile: [number, number]) {
    const last = list[list.length - 1];
    if (!last) return list.push(tile);
    let [x, y] = last;
    const [tx, ty] = tile;
    // tracé continu 4-connexe
    let guard = 0;
    while ((x !== tx || y !== ty) && guard++ < 400) {
      if (Math.abs(tx - x) >= Math.abs(ty - y)) x += Math.sign(tx - x);
      else y += Math.sign(ty - y);
      list.push([x, y]);
    }
    this.updateTooltip();
  }

  primaryDown(tile: [number, number], sx: number, sy: number) {
    const g = this.game;
    if (!g) return;
    const [x, y] = tile;
    switch (this.tool.kind) {
      case 'build': {
        const [w, h] = g.footprint(this.tool.type, this.tool.rot);
        const bx = x - Math.floor((w - 1) / 2);
        const by = y - Math.floor((h - 1) / 2);
        const res = g.place(this.tool.type, bx, by, this.tool.rot);
        if (res.ok) {
          this.toast(`${BUILDINGS[this.tool.type].name} construit(e).`, 'good', 1500);
          if (!g.canAfford(BUILDINGS[this.tool.type].cost)) this.tool = { kind: 'select' };
          if (res.building) this.sel = { kind: 'building', id: res.building.id };
          this.renderBuildBar();
        } else this.toast(res.reason ?? 'Placement impossible', 'bad', 2500);
        break;
      }
      case 'road':
        this.roadDrag = [tile];
        break;
      case 'demolish': {
        const b = g.buildingAt(x, y);
        this.demolishStart = b ? b.id : null;
        this.demolishDrag = b ? null : [tile];
        break;
      }
      case 'parcel': {
        if (g.inBounds(x, y)) this.sel = { kind: 'parcel', idx: g.parcelIndex(x, y) };
        break;
      }
      default:
        this.selectAt(x, y, sx, sy);
    }
    refreshInstant(g);
    this.updatePanel();
  }

  primaryUp() {
    const g = this.game;
    if (!g) return;
    if (this.roadDrag) this.finishRoad();
    if (this.demolishDrag) {
      const n = g.removeRoads(this.demolishDrag);
      if (n) this.toast(`${n} case(s) de route supprimée(s).`, 'info', 1500);
      this.demolishDrag = null;
    }
    refreshInstant(g);
    if (this.demolishStart !== null) {
      const id = this.demolishStart;
      this.demolishStart = null;
      this.askDemolish(id);
    }
    $('#tooltip').hidden = true;
  }

  finishRoad() {
    const g = this.game!;
    const tiles = this.roadDrag ?? [];
    this.roadDrag = null;
    const inb = tiles.filter(([x, y]) => g.inBounds(x, y));
    const res = g.buildRoads(inb);
    if (res.ok) this.toast(`${res.built} case(s) de route construite(s).`, 'good', 1500);
    else if (inb.some(([x, y]) => !g.s.roads[y * g.N + x])) this.toast(res.reason ?? 'Route impossible', 'bad', 2500);
    this.updatePanel();
  }

  selectAt(x: number, y: number, sx: number, sy: number) {
    const g = this.game!;
    // Habitant sous le pointeur ?
    const [wx, wy] = this.renderer.screenToWorld(sx, sy);
    let best: number | null = null;
    let bestD = 0.8;
    for (const a of g.agents.list.values()) {
      if (a.mode === 'inside') continue;
      const d = Math.hypot(a.x - wx / TS, a.y - 0.4 - wy / TS);
      if (d < bestD) {
        bestD = d;
        best = a.id;
      }
    }
    if (best !== null) {
      this.sel = { kind: 'citizen', id: best };
      return;
    }
    const b = g.buildingAt(x, y);
    if (b) {
      this.sel = { kind: 'building', id: b.id };
      return;
    }
    const n = g.nodeAtTile(x, y);
    if (n) {
      this.sel = { kind: 'node', x, y };
      return;
    }
    if (g.inBounds(x, y) && !g.owned(x, y)) {
      this.sel = { kind: 'parcel', idx: g.parcelIndex(x, y) };
      return;
    }
    this.sel = null;
  }

  async askDemolish(id: number) {
    const g = this.game!;
    const b = g.bById.get(id);
    if (!b) return;
    if (!BUILDINGS[b.type].demolishable) {
      this.toast('L’hôtel de ville ne peut pas être démoli.', 'bad');
      return;
    }
    const residents = b.type === 'house' ? g.occupants(b.id) : 0;
    const ok = await this.confirm(
      `Démolir : ${BUILDINGS[b.type].name} ?`,
      `Remboursement : <b>${fmtCostPlain(g.refundFor(b))}</b> (50 % de l’investissement).` +
        (b.workers.length ? `<br>${b.workers.length} travailleur(s) redeviendront disponibles.` : '') +
        (residents ? `<br>${residents} habitant(s) seront relogés si possible, sinon sans abri.` : ''),
      'Démolir',
    );
    if (ok) {
      const r = g.demolish(id);
      if (!r.ok) this.toast(r.reason ?? 'Démolition impossible', 'bad');
      if (this.sel?.kind === 'building' && this.sel.id === id) this.sel = null;
      refreshInstant(g);
      this.updatePanel();
    }
  }

  escape() {
    if (this.modalOpen) {
      if (this.game?.s.progress.defeat) return;
      this.closeModal();
      return;
    }
    if (this.roadDrag || this.demolishDrag) {
      this.roadDrag = null;
      this.demolishDrag = null;
      return;
    }
    if (this.tool.kind !== 'select') {
      this.setTool({ kind: 'select' });
      return;
    }
    if (this.sel) {
      this.sel = null;
      this.updatePanel();
      return;
    }
    this.openPauseMenu();
  }

  setTool(t: Tool) {
    this.tool = t;
    this.roadDrag = null;
    this.demolishDrag = null;
    if (t.kind !== 'select' && t.kind !== 'parcel' && this.sel?.kind === 'parcel') this.sel = null;
    this.renderBuildBar();
    this.updateTooltip();
    this.updatePanel();
  }

  updateTooltip() {
    const tip = $('#tooltip');
    const g = this.game;
    if (!g || !this.hoverTile || this.inMenu) {
      tip.hidden = true;
      return;
    }
    let html = '';
    if (this.tool.kind === 'build') {
      const [w, h] = g.footprint(this.tool.type, this.tool.rot);
      const bx = this.hoverTile[0] - Math.floor((w - 1) / 2);
      const by = this.hoverTile[1] - Math.floor((h - 1) / 2);
      const chk = g.canPlace(this.tool.type, bx, by, this.tool.rot);
      html = `<b>${esc(BUILDINGS[this.tool.type].name)}</b> ${costHTML(g, chk.cost)}<br>${chk.ok ? '<span class="okc">Emplacement valide</span>' : `<span class="badc">${esc(chk.reason ?? '')}</span>`}`;
      if (BUILDINGS[this.tool.type].w !== BUILDINGS[this.tool.type].h) html += '<br><span class="muted">R : pivoter</span>';
      if (chk.ok && BUILDINGS[this.tool.type].needsRoad) {
        const touches = g.perimeter({ x: bx, y: by, w, h }).some(([px, py]) => g.roadConnected[py * g.N + px]);
        if (!touches) html += '<br><span class="warnc">Pensez à le relier par une route</span>';
      }
    } else if (this.tool.kind === 'road') {
      const tiles = this.roadDrag ?? [this.hoverTile];
      const plan = g.roadPlan(tiles.filter(([x, y]) => g.inBounds(x, y)));
      const reason = !this.roadDrag ? g.roadCheck(...this.hoverTile) : null;
      html = `<b>Route</b> : ${plan.valid.length} case(s) ${costHTML(g, plan.cost)}`;
      if (plan.invalid) html += `<br><span class="badc">${plan.invalid} case(s) impossible(s)</span>`;
      if (reason && reason !== 'Route déjà présente') html += `<br><span class="badc">${esc(reason)}</span>`;
    } else if (this.tool.kind === 'demolish') {
      const b = g.buildingAt(...this.hoverTile);
      if (b) html = `<b>Démolir ${esc(BUILDINGS[b.type].name)}</b><br>${BUILDINGS[b.type].demolishable ? 'Remboursement : ' + costHTML(g, g.refundFor(b), false) : '<span class="badc">Indestructible</span>'}`;
      else html = '<b>Démolir</b> : cliquez sur un bâtiment, ou glissez sur des routes';
    } else if (this.tool.kind === 'parcel') {
      const [x, y] = this.hoverTile;
      if (g.inBounds(x, y) && !g.owned(x, y)) {
        const P = g.N / MAP.PARCEL;
        const chk = g.parcelCheck(Math.floor(x / MAP.PARCEL), Math.floor(y / MAP.PARCEL));
        void P;
        html = `<b>Parcelle</b> ${costHTML(g, chk.cost)}<br>${chk.ok ? 'Cliquez pour l’examiner' : `<span class="badc">${esc(chk.reason ?? '')}</span>`}`;
      } else html = 'Choisissez une parcelle verrouillée adjacente';
    }
    if (!html) {
      tip.hidden = true;
      return;
    }
    tip.hidden = false;
    patch(tip, html);
    const [mx, my] = this.mouse;
    const vw = window.innerWidth;
    tip.style.left = Math.min(vw - 260, mx + 18) + 'px';
    tip.style.top = my + 22 + 'px';
  }

  // ================================================================ interface
  bindUI() {
    const hud = $('#hud');
    hud.addEventListener('click', (e) => this.onAction(e));
    $('#modal-root').addEventListener('click', (e) => this.onAction(e));
    $('#minimap').addEventListener('pointerdown', (e) => {
      const c = e.currentTarget as HTMLCanvasElement;
      const move = (ev: PointerEvent) => {
        const r = c.getBoundingClientRect();
        this.renderer.cam.x = ((ev.clientX - r.left) / r.width) * MAP.SIZE * TS;
        this.renderer.cam.y = ((ev.clientY - r.top) / r.height) * MAP.SIZE * TS;
        this.renderer.cam.clamp();
      };
      move(e);
      c.setPointerCapture(e.pointerId);
      c.onpointermove = (ev) => ev.buttons && move(ev);
      c.onpointerup = () => (c.onpointermove = null);
    });
  }

  onAction(e: Event) {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled) return;
    const act = el.dataset.act!;
    // Les raccourcis clavier (Espace…) ne doivent pas réactiver le dernier bouton cliqué.
    if (el instanceof HTMLButtonElement) el.blur();
    const id = el.dataset.id !== undefined ? Number(el.dataset.id) : NaN;
    const g = this.game;
    switch (act) {
      case 'close':
        this.sel = null;
        break;
      case 'speed':
        this.setSpeed(id);
        break;
      case 'cat':
        this.category = el.dataset.cat as Category;
        this.renderBuildBar();
        break;
      case 'build':
        this.setTool({ kind: 'build', type: el.dataset.type as BuildingType, rot: 0 });
        this.sel = null;
        break;
      case 'tool':
        this.setTool({ kind: el.dataset.tool as 'select' | 'road' | 'demolish' | 'parcel' } as Tool);
        break;
      case 'add-worker':
        if (g) {
          const r = g.addWorker(id);
          if (!r.ok) this.toast(r.reason ?? '', 'bad');
          this.refreshModal();
        }
        break;
      case 'rm-worker':
        g?.removeWorker(id);
        this.refreshModal();
        break;
      case 'upgrade':
        if (g) {
          const r = g.upgrade(id);
          if (!r.ok) this.toast(r.reason ?? '', 'bad');
          else this.toast('Amélioration effectuée.', 'good', 1500);
        }
        break;
      case 'demolish':
        this.askDemolish(id);
        break;
      case 'buy-parcel':
        if (g) {
          const P = g.N / MAP.PARCEL;
          const r = g.buyParcel(id % P, Math.floor(id / P));
          if (!r.ok) this.toast(r.reason ?? '', 'bad');
          else this.toast('Parcelle acquise !', 'good');
        }
        break;
      case 'sel-cit':
        this.sel = { kind: 'citizen', id };
        if (this.modalOpen) this.closeModal();
        break;
      case 'sel-bld':
      case 'goto-bld': {
        const b = g?.bById.get(id);
        if (b) {
          this.sel = { kind: 'building', id };
          this.focus(b.x + b.w / 2, b.y + b.h / 2);
          if (this.modalOpen && act === 'goto-bld') this.closeModal();
        }
        break;
      }
      case 'alert': {
        const a = this.alerts.find((x) => x.id === el.dataset.aid);
        if (a && a.x !== undefined && a.y !== undefined) this.focus(a.x, a.y);
        if (a?.buildingId !== undefined) this.sel = { kind: 'building', id: a.buildingId };
        break;
      }
      case 'log': {
        const x = Number(el.dataset.x);
        const y = Number(el.dataset.y);
        if (!Number.isNaN(x) && !Number.isNaN(y)) this.focus(x, y);
        break;
      }
      case 'recenter':
        this.centerOnTownhall();
        break;
      case 'population':
        this.openModal(() => (this.game ? populationModal(this.game) : ''), 'wide');
        break;
      case 'objectives':
        this.openModal(() => (this.game ? objectivesModal(this.game) : ''));
        break;
      case 'help':
        this.openModal(() => helpModal());
        break;
      case 'menu':
        this.openPauseMenu();
        break;
      case 'modal-close':
        this.closeModal();
        break;
      case 'tuto-hide':
        this.tutorialHidden = !this.tutorialHidden;
        break;
      case 'quick-save':
        this.manualSave();
        break;
      default:
        this.onMenuAction(act, el);
        return;
    }
    if (g) refreshInstant(g);
    this.updatePanel();
    this.updateHUD();
  }

  renderBuildBar() {
    const g = this.game;
    if (!g) return;
    const cats = (Object.keys(CATEGORY_LABEL) as Category[])
      .map((c) => `<button class="tab${this.category === c ? ' on' : ''}" data-act="cat" data-cat="${c}">${CATEGORY_LABEL[c]}</button>`)
      .join('');
    const tools = [
      ['select', 'select', 'Sélection'],
      ['road', 'road', 'Route'],
      ['demolish', 'demolish', 'Démolir'],
      ['parcel', 'parcel', 'Parcelles'],
    ]
      .map(([t, ic, label]) => `<button class="tool${this.tool.kind === t ? ' on' : ''}" data-act="tool" data-tool="${t}" title="${label}">${icon(ic as any)}<span>${label}</span></button>`)
      .join('');
    patch($('#cats'), `<div class="tabs">${cats}</div><div class="tools">${tools}</div>`);
    let items = '';
    for (const def of Object.values(BUILDINGS)) {
      if (def.category !== this.category || !def.buildable) continue;
      const unlocked = g.isUnlocked(def.type);
      const on = this.tool.kind === 'build' && this.tool.type === def.type;
      const afford = g.canAfford(def.cost);
      const title = `${def.name} (${def.w}×${def.h}) — ${def.desc}${def.workers ? ` Postes : ${def.workers[0]}.` : ''}${def.housing ? ` Capacité : ${def.housing[0]}.` : ''}`;
      items += `<button class="item${on ? ' on' : ''}${unlocked ? '' : ' locked'}${afford ? '' : ' poor'}" data-act="build" data-type="${def.type}" ${unlocked ? '' : 'disabled'} title="${esc(title)}">
        <img src="${buildingThumb(def.type)}" alt=""><span class="nm">${def.name}</span>
        <span class="cs">${unlocked ? costHTML(g, def.cost) : `Dès ${g.unlockPop(def.type)} hab.`}</span></button>`;
    }
    if (this.category === 'infra')
      items += `<button class="item${this.tool.kind === 'road' ? ' on' : ''}" data-act="tool" data-tool="road" title="Route 1×1 — relie les bâtiments à l’hôtel de ville"><img src="${iconURL('road')}" alt=""><span class="nm">Route</span><span class="cs">${costHTML(g, { wood: 1 })}/case</span></button>`;
    patch($('#items'), items);
  }

  updateHUD() {
    const g = this.game;
    if (!g || this.inMenu) return;
    // Ressources
    const r = recentRates(g);
    const d = demand(g);
    let res = '';
    for (const k of RES_KEYS) {
      const net = k === 'food' ? r.prod.food - r.cons.food : r.prod[k] - r.cons[k];
      let extra = '';
      let cls = '';
      if (k === 'food' || k === 'water') {
        const a = autonomy(g, k);
        extra = a === Infinity ? 'Autonomie : stable ou en hausse' : `Autonomie estimée : ${Math.max(0, a * 12).toFixed(0)} mois`;
        if (g.s.shortage[k] > 0) cls = 'crit';
        else if (a < 0.5) cls = 'warn';
      }
      const title = `${RES_LABEL[k]} : ${fmt(g.s.stock[k])} / ${fmt(g.capacity[k])}\nProduction : ${r.prod[k].toFixed(0)}/an · Consommation : ${r.cons[k].toFixed(0)}/an${k === 'food' ? `\nBesoin de la population : ${d.food.toFixed(0)}/an` : ''}${k === 'water' ? `\nBesoin de la population : ${d.water.toFixed(0)}/an` : ''}${extra ? '\n' + extra : ''}`;
      const auto = k === 'food' || k === 'water' ? autonomy(g, k) : Infinity;
      res += `<div class="res ${cls}" title="${esc(title)}">${icon(RES_ICON[k])}<div><b>${fmt(g.s.stock[k])}</b><small>/${fmt(g.capacity[k])}</small><div class="delta ${net >= 0 ? 'up' : 'down'}">${signed(net)}/an${auto !== Infinity ? ` · ${Math.max(0, auto * 12).toFixed(0)} mois` : ''}</div></div></div>`;
    }
    patch($('#res'), res);
    const cs = g.s.citizens;
    const kids = cs.filter((c) => c.age < 18).length;
    const elders = cs.filter((c) => c.age >= 65).length;
    const workers = cs.filter((c) => c.jobId !== null).length;
    const avail = g.availableAdults().length;
    const hap = averageHappiness(g);
    patch(
      $('#popbox'),
      `<button class="pop" data-act="population" title="Population : ${cs.length}\nEnfants : ${kids} · Adultes disponibles : ${avail} · Travailleurs : ${workers} · Retraités : ${elders}\n(P) Tableau de la population et des emplois">${icon('pop')}<b>${cs.length}</b>
         <span class="mini" title="Enfants">${icon('child')}${kids}</span><span class="mini" title="Adultes disponibles">${icon('pop')}${avail}</span><span class="mini" title="Travailleurs">${icon('work')}${workers}</span><span class="mini" title="Retraités">${icon('elder')}${elders}</span></button>
       <div class="hap ${hap >= 70 ? 'good' : hap >= 50 ? '' : 'bad'}" title="Bonheur moyen des habitants">${icon('happy')}<b>${Math.round(hap)} %</b></div>`,
    );
    const s = SEASONS[g.seasonIndex];
    const ev = g.s.events.map((e) => `<span class="ev" title="${esc(EVENT_LABEL[e.kind])}">${esc(EVENT_LABEL[e.kind])} · ${Math.ceil(e.remaining * 12)} mois</span>`).join('');
    patch(
      $('#datebox'),
      `<div class="date" title="${esc(s.effects)}"><b>Année ${g.year}</b> · <span class="season s${g.seasonIndex}">${s.name}</span><div class="sbar"><div style="width:${(g.seasonProgress * 100).toFixed(0)}%"></div></div></div>${ev}`,
    );
    const run = this.runner!;
    const sp = (v: number, label: string) =>
      `<button class="${(v === 0 && run.paused) || (!run.paused && run.speed === v && v !== 0) ? 'on' : ''}" data-act="speed" data-id="${v}" title="${v === 0 ? 'Pause (Espace)' : 'Vitesse ×' + v}">${label}</button>`;
    patch($('#speed'), sp(0, '❚❚') + sp(1, '×1') + sp(2, '×2') + sp(4, '×4'));

    // Alertes
    this.alerts = computeAlerts(g);
    patch(
      $('#alerts'),
      this.alerts
        .slice(0, 7)
        .map((a) => `<button class="alert ${a.level}" data-act="alert" data-aid="${a.id}" title="Cliquer pour recentrer">${icon(a.level === 'info' ? 'warn' : 'warn')}<span>${esc(a.text)}</span></button>`)
        .join('') + (this.alerts.length > 7 ? `<div class="more">+ ${this.alerts.length - 7} autre(s)</div>` : ''),
    );
    // Journal
    const log = g.s.log.slice(-7).reverse();
    patch(
      $('#log'),
      '<h4>Journal</h4>' +
        log
          .map(
            (e) =>
              `<div class="le ${e.kind}" ${e.x !== undefined ? `data-act="log" data-x="${e.x}" data-y="${e.y}"` : ''}><span class="t">An ${Math.floor(e.t / 60) + 1}</span> ${esc(e.text)}</div>`,
          )
          .join(''),
    );
    // Tutoriel
    const p = g.s.progress;
    const tut = $('#tutorial');
    if (!this.settings.tutorial || p.tutorialDone) {
      tut.hidden = true;
    } else {
      tut.hidden = false;
      const step = TUTORIAL[Math.min(p.tutorialStep, TUTORIAL.length - 1)];
      patch(
        tut,
        `<div class="th"><b>Tutoriel ${p.tutorialStep + 1}/${TUTORIAL.length}</b><button data-act="tuto-hide">${this.tutorialHidden ? 'Afficher' : 'Réduire'}</button></div>` +
          (this.tutorialHidden
            ? ''
            : `<div class="tt">${step.title}</div><div class="tx">${step.text}</div><ol>${TUTORIAL.map((t, i) => `<li class="${i < p.tutorialStep ? 'done' : i === p.tutorialStep ? 'cur' : ''}">${t.title}</li>`).join('')}</ol>`),
      );
    }
    // Objectif
    const vic = p.victory
      ? '<b class="okc">Victoire !</b> Mode libre'
      : `Objectif : ${cs.length}/${VICTORY.population} hab. · bonheur ${Math.round(hap)}/${VICTORY.happiness} % · ${p.victoryHold.toFixed(1)}/${VICTORY.holdYears} ans`;
    patch($('#goal'), `<button data-act="objectives" title="Objectifs et paliers">${vic}</button>`);
    // Barre de construction (coûts abordables / paliers)
    this.renderBuildBar();
    this.updatePanel();
  }

  updatePanel() {
    const g = this.game;
    const panel = $('#panel');
    if (!g || !this.sel) {
      panel.hidden = true;
      return;
    }
    let html = '';
    const s = this.sel;
    if (s.kind === 'building') {
      const b = g.bById.get(s.id);
      if (b) html = buildingPanel(g, b);
    } else if (s.kind === 'citizen') {
      const c = g.cById.get(s.id);
      if (c) html = citizenPanel(g, c);
    } else if (s.kind === 'node') html = nodePanel(g, s.x, s.y);
    else if (s.kind === 'parcel') html = parcelPanel(g, s.idx);
    if (!html) {
      this.sel = null;
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    patch(panel, html);
  }

  // ================================================================ fenêtres
  modalRender: (() => string) | null = null;
  openModal(render: () => string, cls = '', pauses = true) {
    this.modalOpen = true;
    this.modalPauses = pauses;
    this.modalRender = render;
    const root = $('#modal-root');
    root.hidden = false;
    root.className = cls;
    patch(root, `<div class="modal ${cls}"><button class="x" data-act="modal-close">✕</button><div class="mc">${render()}</div></div>`);
    this.keys.clear();
  }
  refreshModal() {
    if (!this.modalOpen || !this.modalRender) return;
    const mc = document.querySelector('#modal-root .mc');
    if (mc) patch(mc, this.modalRender());
  }
  closeModal() {
    this.modalOpen = false;
    this.modalRender = null;
    const root = $('#modal-root');
    root.hidden = true;
    patch(root, '');
    this.lastFrame = performance.now();
  }

  confirm(title: string, body: string, okLabel = 'Confirmer'): Promise<boolean> {
    return new Promise((resolve) => {
      const wasOpen = this.modalOpen;
      const prev = this.modalRender;
      this.modalOpen = true;
      this.modalPauses = true;
      const root = $('#modal-root');
      root.hidden = false;
      root.className = '';
      const box = document.createElement('div');
      box.className = 'modal confirm';
      box.innerHTML = `<h2>${title}</h2><p>${body}</p><div class="actions end"><button data-c="no">Annuler</button><button class="primary" data-c="yes">${okLabel}</button></div>`;
      const layer = document.createElement('div');
      layer.className = 'confirm-layer';
      layer.appendChild(box);
      document.body.appendChild(layer);
      const done = (v: boolean) => {
        layer.remove();
        window.removeEventListener('keydown', onKey, true);
        if (wasOpen && prev) {
          this.modalOpen = true;
          this.modalRender = prev;
          this.refreshModal();
        } else if (!wasOpen) this.closeModal();
        resolve(v);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code === 'Escape') {
          e.stopPropagation();
          e.preventDefault();
          done(false);
        } else if (e.code === 'Enter') {
          e.stopPropagation();
          e.preventDefault();
          done(true);
        }
      };
      window.addEventListener('keydown', onKey, true);
      box.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('[data-c]') as HTMLElement | null;
        if (b) done(b.dataset.c === 'yes');
      });
    });
  }

  toast(text: string, kind: 'good' | 'bad' | 'info' | 'warn' = 'info', ms = 2500) {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = text;
    const root = $('#toasts');
    root.appendChild(t);
    while (root.children.length > 4) root.firstChild!.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  // ================================================================ menus
  showMainMenu() {
    this.inMenu = true;
    this.game = null;
    this.runner = null;
    this.sel = null;
    this.tool = { kind: 'select' };
    $('#hud').hidden = true;
    this.closeModal();
    if (!this.demoGame) this.demoGame = Game.create(hashSeed('menu') ^ Math.floor(Math.random() * 1000));
    const auto = slotInfo('auto');
    const manual = slotInfo('manual');
    const info = (i: ReturnType<typeof slotInfo>) =>
      i ? (i.savedAt === 'corrompue' ? '<small class="badc">corrompue</small>' : `<small>Année ${i.year} · ${i.pop} hab.</small>`) : '';
    const menu = $('#menu');
    menu.hidden = false;
    menu.innerHTML = `<div class="menu-box">
      <h1><span>Les</span> Premiers Foyers</h1>
      <p class="tag">Bâtissez un village, nourrissez les foyers, voyez grandir les générations.</p>
      <button class="big primary" data-m="new">Nouvelle partie</button>
      <button class="big" data-m="continue" ${auto || manual ? '' : 'disabled'}>Continuer ${info(auto ?? manual)}</button>
      <button class="big" data-m="load-manual" ${manual ? '' : 'disabled'}>Charger la sauvegarde manuelle ${info(manual)}</button>
      <button class="big" data-m="import">Importer un fichier…</button>
      <div class="row2"><button data-m="settings">Paramètres</button><button data-m="help">Aide</button></div>
      <p class="foot">Jeu 100 % local · aucune connexion requise</p>
    </div>`;
    menu.onclick = (e) => {
      const b = (e.target as HTMLElement).closest('[data-m]') as HTMLButtonElement | null;
      if (!b || b.disabled) return;
      this.onMenuAction(b.dataset.m!, b);
    };
  }

  async onMenuAction(act: string, _el?: HTMLElement) {
    switch (act) {
      case 'new': {
        const hasSave = slotInfo('auto') !== null || (this.game !== null && !this.inMenu);
        this.openNewGameDialog(hasSave);
        break;
      }
      case 'new-go': {
        const input = document.querySelector('#seed-input') as HTMLInputElement | null;
        const v = input?.value.trim() ?? '';
        const seed = v ? (/^\d+$/.test(v) ? Number(v) % 4294967296 : hashSeed(v)) : undefined;
        this.closeModal();
        this.newGame(seed);
        writeSlot('auto', this.game!);
        break;
      }
      case 'continue': {
        const a = slotInfo('auto');
        const m = slotInfo('manual');
        const slot: Slot = a && (!m || (a.savedAt ?? '') >= (m.savedAt ?? '')) ? 'auto' : 'manual';
        this.loadSlot(slot);
        break;
      }
      case 'load-manual':
        this.loadSlot('manual');
        break;
      case 'load-auto':
        this.loadSlot('auto');
        break;
      case 'import': {
        const text = await pickFile();
        if (text === null) return;
        const r = parseSave(text);
        if (!r.game) return this.errorModal(r.error ?? 'Fichier invalide');
        if (this.game && !this.inMenu) {
          const ok = await this.confirm('Importer cette sauvegarde ?', 'La partie en cours sera remplacée (pensez à la sauvegarder).', 'Importer');
          if (!ok) return;
        }
        this.startGame(r.game, true);
        this.toast('Sauvegarde importée — en pause (Espace pour reprendre).', 'good', 3500);
        break;
      }
      case 'export':
        if (this.game) {
          downloadSave(this.game);
          this.toast('Fichier de sauvegarde exporté.', 'good');
        }
        break;
      case 'save':
        this.closeModal();
        await this.manualSave();
        break;
      case 'settings':
        this.openSettings();
        break;
      case 'help':
        this.openModal(() => helpModal());
        break;
      case 'resume':
        this.closeModal();
        break;
      case 'free-play':
        if (this.game) this.game.s.progress.freePlay = true;
        this.closeModal();
        break;
      case 'main-menu': {
        if (this.game && !this.game.s.progress.defeat) {
          const ok = await this.confirm('Retourner au menu principal ?', 'La partie sera sauvegardée automatiquement.', 'Menu principal');
          if (!ok) return;
          writeSlot('auto', this.game);
        }
        this.showMainMenu();
        break;
      }
      case 'restart':
        this.closeModal();
        this.newGame();
        break;
      case 'set-save':
        this.settingsFromForm();
        break;
    }
  }

  async manualSave() {
    if (!this.game) return;
    const info = slotInfo('manual');
    if (info) {
      const ok = await this.confirm(
        'Écraser la sauvegarde manuelle ?',
        `La sauvegarde existante (${info.savedAt === 'corrompue' ? 'corrompue' : `année ${info.year}, ${info.pop} habitants`}) sera remplacée.`,
        'Écraser',
      );
      if (!ok) return;
    }
    const r = writeSlot('manual', this.game);
    this.toast(r.ok ? 'Partie sauvegardée.' : r.error ?? 'Erreur', r.ok ? 'good' : 'bad');
  }

  async loadSlot(slot: Slot) {
    if (this.game && !this.inMenu) {
      const ok = await this.confirm('Charger la sauvegarde ?', 'La progression non sauvegardée de la partie en cours sera perdue.', 'Charger');
      if (!ok) return;
    }
    const r = readSlot(slot);
    if (!r.game) return this.errorModal(r.error ?? 'Chargement impossible');
    this.startGame(r.game, true);
    this.toast('Partie chargée — en pause (Espace pour reprendre).', 'good', 3500);
  }

  errorModal(msg: string) {
    this.openModal(() => `<h2>Chargement impossible</h2><p class="badc">${esc(msg)}</p><p>Le fichier ou la sauvegarde locale semble endommagé(e). Vous pouvez commencer une nouvelle partie ou importer un autre fichier.</p><div class="actions end"><button class="primary" data-act="modal-close">Fermer</button></div>`);
  }

  openNewGameDialog(hasSave: boolean) {
    this.openModal(
      () => `<h2>Nouvelle partie</h2>
      ${hasSave ? '<p class="warnc">Attention : la sauvegarde automatique actuelle sera remplacée par la nouvelle partie. La sauvegarde manuelle est conservée.</p>' : ''}
      <label class="field">Graine de la carte (facultatif) <input id="seed-input" type="text" placeholder="aléatoire" maxlength="24"></label>
      <p class="muted">Une même graine produit la même carte et les mêmes habitants de départ.</p>
      <div class="actions end"><button data-act="modal-close">Annuler</button><button class="primary" data-act="new-go">Fonder la colonie</button></div>`,
    );
  }

  openPauseMenu() {
    if (!this.game) return;
    const auto = slotInfo('auto');
    const manual = slotInfo('manual');
    this.openModal(
      () => `<h2>Pause</h2><div class="menu-list">
      <button class="primary" data-act="resume">Reprendre</button>
      <button data-act="save">Sauvegarder${manual ? ' (écrase la sauvegarde manuelle)' : ''}</button>
      <button data-act="load-manual" ${manual ? '' : 'disabled'}>Charger la sauvegarde manuelle ${manual ? `<small>année ${manual.year}</small>` : ''}</button>
      <button data-act="load-auto" ${auto ? '' : 'disabled'}>Charger la sauvegarde automatique ${auto ? `<small>année ${auto.year}</small>` : ''}</button>
      <button data-act="export">Exporter (JSON)</button>
      <button data-act="import">Importer (JSON)…</button>
      <button data-act="settings">Paramètres</button>
      <button data-act="help">Aide</button>
      <button data-act="main-menu">Menu principal</button></div>`,
    );
  }

  openSettings() {
    const s = this.settings;
    this.openModal(
      () => `<h2>Paramètres</h2>
      <label class="check"><input type="checkbox" id="st-grid" ${s.showGrid ? 'checked' : ''}> Afficher la grille en mode construction</label>
      <label class="check"><input type="checkbox" id="st-tuto" ${s.tutorial ? 'checked' : ''}> Afficher le tutoriel guidé</label>
      <label class="field">Sauvegarde automatique
        <select id="st-auto">${[
          [0, 'Désactivée'],
          [30, 'Toutes les 30 s'],
          [AUTOSAVE_SECONDS, `Toutes les ${AUTOSAVE_SECONDS} s`],
          [90, 'Toutes les 90 s'],
          [180, 'Toutes les 3 min'],
        ]
          .map(([v, l]) => `<option value="${v}" ${s.autosave === v ? 'selected' : ''}>${l}</option>`)
          .join('')}</select></label>
      <label class="field">Vitesse de défilement de la caméra
        <input type="range" id="st-pan" min="0.5" max="2" step="0.1" value="${s.panSpeed}"></label>
      <div class="actions end"><button data-act="modal-close">Fermer</button><button class="primary" data-act="set-save">Enregistrer</button></div>`,
      '',
    );
  }

  settingsFromForm() {
    const q = (id: string) => document.getElementById(id) as HTMLInputElement;
    this.settings = {
      showGrid: q('st-grid').checked,
      tutorial: q('st-tuto').checked,
      autosave: Number((document.getElementById('st-auto') as HTMLSelectElement).value),
      panSpeed: Number(q('st-pan').value),
    };
    saveSettings(this.settings);
    this.toast('Paramètres enregistrés.', 'good', 1500);
    if (this.inMenu) this.closeModal();
    else this.openPauseMenu();
  }

  showVictory() {
    if (this.shownVictory) return;
    this.shownVictory = true;
    const g = this.game!;
    writeSlot('auto', g);
    this.openModal(
      () => `<h2 class="okc">Victoire !</h2><p>Votre colonie compte <b>${g.s.citizens.length} habitants</b> heureux depuis ${VICTORY.holdYears} années, sans pénurie. Les Premiers Foyers sont devenus un vrai village.</p>
      <ul class="facts"><li>Année ${g.year} · ${g.s.progress.births} naissances · ${g.s.progress.deaths} décès</li><li>${g.s.buildings.length} bâtiments · ${g.s.parcelsBought} parcelles achetées</li></ul>
      <div class="actions end"><button data-act="main-menu">Menu principal</button><button class="primary" data-act="free-play">Continuer en mode libre</button></div>`,
    );
  }

  showDefeat() {
    const g = this.game!;
    const manual = slotInfo('manual');
    this.openModal(
      () => `<h2 class="badc">La colonie s’est éteinte</h2><p>Il ne reste plus aucun habitant. Année ${g.year} · ${g.s.progress.births} naissances · ${g.s.progress.deaths} décès.</p>
      <div class="actions end"><button data-act="load-manual" ${manual ? '' : 'disabled'}>Charger la sauvegarde manuelle</button><button class="primary" data-act="restart">Recommencer</button></div>`,
    );
  }
}
