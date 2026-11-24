// Unified keyboard / mouse / touch input. Produces an Intent for the local player each frame.

export class InputManager {
  keys = new Set<string>();
  mouseFire = false;
  touchFire = false;
  joyX = 0;
  joyY = 0;
  lookX = 0;
  lookY = 0;
  dashQueued = false;
  selectQueued: number | null = null;
  cycleQueued = 0;
  pauseQueued = false;
  locked = false;
  everLocked = false;
  fallback = false;
  cursorX = 0;
  cursorY = 0;
  sensitivity = 1;
  onPointerLockLost: (() => void) | null = null;
  private attached = false;

  constructor(private el: HTMLElement) {}

  attach() {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("blur", this.onBlur);
    this.el.addEventListener("mousedown", this.onMouseDown);
    this.el.addEventListener("wheel", this.onWheel, { passive: true });
    this.el.addEventListener("contextmenu", this.onContext);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("pointerlockerror", this.onLockError);
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("blur", this.onBlur);
    this.el.removeEventListener("mousedown", this.onMouseDown);
    this.el.removeEventListener("wheel", this.onWheel);
    this.el.removeEventListener("contextmenu", this.onContext);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("pointerlockerror", this.onLockError);
    if (document.pointerLockElement === this.el) document.exitPointerLock();
    this.locked = false;
  }

  releaseAll() {
    this.keys.clear();
    this.mouseFire = false;
    this.touchFire = false;
    this.joyX = this.joyY = 0;
  }

  requestLock() {
    if (this.locked) return;
    try {
      const r = this.el.requestPointerLock?.() as Promise<void> | undefined;
      if (r && typeof r.catch === "function") r.catch(() => (this.fallback = true));
    } catch {
      this.fallback = true;
    }
  }

  queueSelect(index: number) {
    if (Number.isInteger(index) && index >= 0 && index < 5) this.selectQueued = index;
  }

  exitLock() {
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  private onLockChange = () => {
    const was = this.locked;
    this.locked = document.pointerLockElement === this.el;
    if (this.locked) this.everLocked = true;
    if (was && !this.locked) this.onPointerLockLost?.();
  };
  private onLockError = () => {
    this.fallback = true;
  };
  private onBlur = () => this.releaseAll();
  private onContext = (e: Event) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) {
      if (["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
      return;
    }
    this.keys.add(e.code);
    switch (e.code) {
      case "Space":
      case "ShiftLeft":
      case "ShiftRight":
        this.dashQueued = true;
        e.preventDefault();
        break;
      case "Digit1":
      case "Digit2":
      case "Digit3":
      case "Digit4":
      case "Digit5":
        this.selectQueued = Number(e.code.slice(5)) - 1;
        break;
      case "KeyQ":
        this.cycleQueued = -1;
        break;
      case "KeyE":
        this.cycleQueued = 1;
        break;
      case "Escape":
      case "KeyP":
        this.pauseQueued = true;
        break;
      case "ArrowUp":
      case "ArrowDown":
        e.preventDefault();
        break;
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      this.mouseFire = true;
      this.requestLock();
    } else if (e.button === 2) this.dashQueued = true;
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseFire = false;
  };
  private onMouseMove = (e: MouseEvent) => {
    if (this.locked) {
      this.lookX += e.movementX * 0.0022 * this.sensitivity;
      this.lookY += e.movementY * 0.0022 * this.sensitivity;
    }
    const r = this.el.getBoundingClientRect();
    this.cursorX = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.cursorY = ((e.clientY - r.top) / r.height) * 2 - 1;
  };
  private onWheel = (e: WheelEvent) => {
    this.cycleQueued = e.deltaY > 0 ? 1 : -1;
  };

  /** Touch look delta in pixels */
  addTouchLook(dx: number, dy: number) {
    this.lookX += dx * 0.0052 * this.sensitivity;
    this.lookY += dy * 0.0046 * this.sensitivity;
  }

  get fire() {
    return this.mouseFire || this.touchFire || this.keys.has("KeyF");
  }

  getMove() {
    let mx = this.joyX;
    let mz = this.joyY;
    if (this.keys.has("KeyW")) mz += 1;
    if (this.keys.has("KeyS")) mz -= 1;
    if (this.keys.has("KeyD")) mx += 1;
    if (this.keys.has("KeyA")) mx -= 1;
    return { mx, mz };
  }

  /** Returns yaw/pitch deltas (radians, positive yaw = turn left) for this frame. */
  consumeLook(dt: number) {
    let yaw = -this.lookX;
    let pitch = -this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    const turn = 2.2 * dt * this.sensitivity;
    if (this.keys.has("ArrowLeft")) yaw += turn;
    if (this.keys.has("ArrowRight")) yaw -= turn;
    if (this.keys.has("ArrowUp")) pitch += turn * 0.7;
    if (this.keys.has("ArrowDown")) pitch -= turn * 0.7;
    if (this.fallback && !this.locked && !this.touchFire && Math.abs(this.joyX) + Math.abs(this.joyY) === 0) {
      const dead = 0.28;
      const cx = Math.abs(this.cursorX) > dead ? (Math.abs(this.cursorX) - dead) / (1 - dead) * Math.sign(this.cursorX) : 0;
      const cy = Math.abs(this.cursorY) > 0.45 ? (Math.abs(this.cursorY) - 0.45) / 0.55 * Math.sign(this.cursorY) : 0;
      yaw -= cx * cx * Math.sign(cx) * 2.4 * dt * this.sensitivity;
      pitch -= cy * cy * Math.sign(cy) * 1.2 * dt * this.sensitivity;
    }
    return { yaw, pitch };
  }
}
