import { createEmptyMap, isBlockingTile, PLAYER_COLORS, TileType, type MapData, type SpawnPoint } from "@brawlers/shared";
import { deleteMap, getMap, listMaps, saveMap, type MapSummary } from "./net/MapApi";

const TILE_PX = 28;

type Tool = TileType.Empty | TileType.Wall | TileType.Bush | "spawn";

const TILE_COLORS: Record<TileType, string> = {
  [TileType.Empty]: "#4a8f4a",
  [TileType.Wall]: "#6b6f7a",
  [TileType.Bush]: "#2f6b2a",
};

export class Editor {
  private map: MapData;
  private tool: Tool = TileType.Wall;
  private isPainting = false;
  private lastPaintedTile: string | undefined;
  private mapSummaries: MapSummary[] = [];

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly statusEl: HTMLElement;
  private readonly mapSelect: HTMLSelectElement;
  private readonly nameInput: HTMLInputElement;
  private readonly widthInput: HTMLInputElement;
  private readonly heightInput: HTMLInputElement;
  private readonly toolButtons: Map<Tool, HTMLButtonElement> = new Map();

  constructor(private readonly root: HTMLElement) {
    this.map = createEmptyMap("Untitled Map", 15, 11, 2);

    root.innerHTML = "";
    const layout = document.createElement("div");
    layout.className = "editor-layout";

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    layout.appendChild(toolbar);

    const canvasWrap = document.createElement("div");
    canvasWrap.className = "canvas-wrap";
    layout.appendChild(canvasWrap);

    this.canvas = document.createElement("canvas");
    canvasWrap.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    // --- Map name ---
    toolbar.appendChild(sectionTitle("Map"));
    this.nameInput = input("text");
    this.nameInput.value = this.map.name;
    this.nameInput.oninput = () => (this.map.name = this.nameInput.value);
    toolbar.appendChild(labeled("Name", this.nameInput));

    // --- Size ---
    const sizeRow = document.createElement("div");
    sizeRow.className = "row";
    this.widthInput = input("number");
    this.widthInput.value = String(this.map.width);
    this.widthInput.min = "3";
    this.widthInput.max = "60";
    this.heightInput = input("number");
    this.heightInput.value = String(this.map.height);
    this.heightInput.min = "3";
    this.heightInput.max = "60";
    sizeRow.appendChild(labeled("Width", this.widthInput));
    sizeRow.appendChild(labeled("Height", this.heightInput));
    toolbar.appendChild(sizeRow);
    const resizeButton = button("Resize", () => this.resize());
    toolbar.appendChild(resizeButton);

    // --- Tools ---
    toolbar.appendChild(sectionTitle("Tools"));
    const toolRow = document.createElement("div");
    toolRow.className = "tool-row";
    toolRow.appendChild(this.toolButton("Empty", TileType.Empty));
    toolRow.appendChild(this.toolButton("Wall", TileType.Wall));
    toolRow.appendChild(this.toolButton("Bush", TileType.Bush));
    toolRow.appendChild(this.toolButton("Spawn", "spawn"));
    toolbar.appendChild(toolRow);
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Paint by dragging. Right-click a tile to remove a spawn point.";
    toolbar.appendChild(hint);

    // --- File actions ---
    toolbar.appendChild(sectionTitle("File"));
    toolbar.appendChild(button("New Map", () => this.newMap()));
    toolbar.appendChild(button("Save to Server", () => void this.save()));
    toolbar.appendChild(button("Delete from Server", () => void this.deleteCurrent()));
    toolbar.appendChild(button("Export JSON", () => this.exportJson()));

    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = "application/json";
    importInput.className = "file-input";
    importInput.onchange = () => this.importJson(importInput.files?.[0]);
    toolbar.appendChild(importInput);

    toolbar.appendChild(sectionTitle("Load"));
    this.mapSelect = document.createElement("select");
    this.mapSelect.className = "text-input";
    toolbar.appendChild(this.mapSelect);
    toolbar.appendChild(button("Load Selected", () => void this.loadSelected()));

    this.statusEl = document.createElement("p");
    this.statusEl.className = "status-text";
    toolbar.appendChild(this.statusEl);

    root.appendChild(layout);

    this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
    this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
    window.addEventListener("mouseup", () => this.onMouseUp());
    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.onRightClick(e);
    });

    this.setActiveTool(TileType.Wall);
    this.redraw();
    void this.refreshMapList();
  }

  private toolButton(label: string, tool: Tool): HTMLButtonElement {
    const b = button(label, () => this.setActiveTool(tool));
    this.toolButtons.set(tool, b);
    return b;
  }

  private setActiveTool(tool: Tool): void {
    this.tool = tool;
    for (const [t, b] of this.toolButtons) b.classList.toggle("active", t === tool);
  }

  private tileFromEvent(e: MouseEvent): { tx: number; ty: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const tx = Math.floor((e.clientX - rect.left) / TILE_PX);
    const ty = Math.floor((e.clientY - rect.top) / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return null;
    return { tx, ty };
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    this.isPainting = true;
    this.lastPaintedTile = undefined;
    this.paintAt(e);
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isPainting) return;
    this.paintAt(e);
  }

  private onMouseUp(): void {
    this.isPainting = false;
    this.lastPaintedTile = undefined;
  }

  private onRightClick(e: MouseEvent): void {
    const tile = this.tileFromEvent(e);
    if (!tile) return;
    this.map.spawnPoints = this.map.spawnPoints.filter((s) => !(s.x === tile.tx && s.y === tile.ty));
    this.redraw();
  }

  private paintAt(e: MouseEvent): void {
    const tile = this.tileFromEvent(e);
    if (!tile) return;
    const key = `${tile.tx},${tile.ty}`;
    if (key === this.lastPaintedTile) return;
    this.lastPaintedTile = key;

    if (this.tool === "spawn") {
      const existing = this.map.spawnPoints.find((s) => s.x === tile.tx && s.y === tile.ty);
      if (existing) {
        this.map.spawnPoints = this.map.spawnPoints.filter((s) => s !== existing);
      } else {
        const team = this.map.spawnPoints.length % PLAYER_COLORS.length;
        this.map.spawnPoints.push({ x: tile.tx, y: tile.ty, team });
      }
    } else {
      const row = this.map.tiles[tile.ty];
      if (row) row[tile.tx] = this.tool;
    }
    this.redraw();
  }

  private resize(): void {
    const newWidth = clamp(parseInt(this.widthInput.value, 10) || this.map.width, 3, 60);
    const newHeight = clamp(parseInt(this.heightInput.value, 10) || this.map.height, 3, 60);

    const newTiles: TileType[][] = [];
    for (let y = 0; y < newHeight; y++) {
      const row: TileType[] = [];
      for (let x = 0; x < newWidth; x++) {
        row.push(this.map.tiles[y]?.[x] ?? TileType.Empty);
      }
      newTiles.push(row);
    }

    this.map.width = newWidth;
    this.map.height = newHeight;
    this.map.tiles = newTiles;
    this.map.spawnPoints = this.map.spawnPoints.filter((s) => s.x < newWidth && s.y < newHeight);
    this.widthInput.value = String(newWidth);
    this.heightInput.value = String(newHeight);
    this.redraw();
  }

  private newMap(): void {
    if (!confirm("Discard the current map and start a new one?")) return;
    this.map = createEmptyMap("Untitled Map", 15, 11, 2);
    this.nameInput.value = this.map.name;
    this.widthInput.value = String(this.map.width);
    this.heightInput.value = String(this.map.height);
    this.redraw();
  }

  private async save(): Promise<void> {
    try {
      await saveMap(this.map);
      this.setStatus(`Saved "${this.map.name}".`);
      await this.refreshMapList();
    } catch (err) {
      this.setStatus(`Save failed: ${(err as Error).message}`);
    }
  }

  private async deleteCurrent(): Promise<void> {
    if (!confirm(`Delete "${this.map.name}" from the server?`)) return;
    try {
      await deleteMap(this.map.id);
      this.setStatus(`Deleted "${this.map.name}".`);
      await this.refreshMapList();
    } catch (err) {
      this.setStatus(`Delete failed: ${(err as Error).message}`);
    }
  }

  private async refreshMapList(): Promise<void> {
    try {
      this.mapSummaries = await listMaps();
    } catch {
      this.mapSummaries = [];
    }
    this.mapSelect.innerHTML = "";
    for (const summary of this.mapSummaries) {
      const option = document.createElement("option");
      option.value = summary.id;
      option.textContent = `${summary.name} (${summary.width}x${summary.height})`;
      this.mapSelect.appendChild(option);
    }
  }

  private async loadSelected(): Promise<void> {
    const id = this.mapSelect.value;
    if (!id) return;
    try {
      this.map = await getMap(id);
      this.nameInput.value = this.map.name;
      this.widthInput.value = String(this.map.width);
      this.heightInput.value = String(this.map.height);
      this.redraw();
      this.setStatus(`Loaded "${this.map.name}".`);
    } catch (err) {
      this.setStatus(`Load failed: ${(err as Error).message}`);
    }
  }

  private exportJson(): void {
    const blob = new Blob([JSON.stringify(this.map, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.map.name.replace(/\s+/g, "_") || "map"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private importJson(file: File | undefined): void {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as MapData;
        if (!data.tiles || !data.width || !data.height) throw new Error("Missing required fields");
        this.map = data;
        this.nameInput.value = this.map.name;
        this.widthInput.value = String(this.map.width);
        this.heightInput.value = String(this.map.height);
        this.redraw();
        this.setStatus(`Imported "${this.map.name}".`);
      } catch (err) {
        this.setStatus(`Import failed: ${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
  }

  private setStatus(message: string): void {
    this.statusEl.textContent = message;
  }

  private redraw(): void {
    this.canvas.width = this.map.width * TILE_PX;
    this.canvas.height = this.map.height * TILE_PX;

    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const tile = this.map.tiles[y]?.[x] ?? TileType.Empty;
        this.ctx.fillStyle = TILE_COLORS[tile];
        this.ctx.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
        this.ctx.strokeStyle = "rgba(0,0,0,0.15)";
        this.ctx.strokeRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
        if (isBlockingTile(tile)) {
          this.ctx.fillStyle = "rgba(0,0,0,0.15)";
          this.ctx.fillRect(x * TILE_PX + 3, y * TILE_PX + 3, TILE_PX - 6, TILE_PX - 6);
        }
      }
    }

    for (const spawn of this.map.spawnPoints) this.drawSpawn(spawn);
  }

  private drawSpawn(spawn: SpawnPoint): void {
    const cx = spawn.x * TILE_PX + TILE_PX / 2;
    const cy = spawn.y * TILE_PX + TILE_PX / 2;
    const color = PLAYER_COLORS[spawn.team % PLAYER_COLORS.length]?.hex ?? 0xffffff;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, TILE_PX / 2 - 4, 0, Math.PI * 2);
    this.ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    this.ctx.fill();
    this.ctx.strokeStyle = "white";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.fillStyle = "white";
    this.ctx.font = "bold 12px sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(String(spawn.team + 1), cx, cy);
  }
}

function sectionTitle(text: string): HTMLElement {
  const h = document.createElement("h2");
  h.className = "section-title";
  h.textContent = text;
  return h;
}

function labeled(labelText: string, field: HTMLElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(field);
  return wrap;
}

function input(type: string): HTMLInputElement {
  const i = document.createElement("input");
  i.type = type;
  i.className = "text-input";
  return i;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tool-button";
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
