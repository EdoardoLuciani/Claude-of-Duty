type Accessory = 'bandage' | 'radio' | 'grenade';
type HandState = 'weapon' | Accessory | 'cooking' | 'throwing' | 'released';
type CookAction = 'fire' | 'ads';

/** Gameplay hand state; input priority, inventory, clips and their effects are caller-owned. */
export class HandEquipment {
  private _state: HandState = 'weapon';
  private _action: CookAction = 'fire';
  // Elapsed cook time, then the remaining fuse at commitment.
  private _timer = 0;

  get state(): HandState {
    return this._state;
  }

  get grenadeEquipped(): boolean {
    return this._state === 'grenade' || this.grenadeLive;
  }

  get grenadeLive(): boolean {
    return this._state === 'cooking' || this._state === 'throwing' || this._state === 'released';
  }

  get cookAction(): CookAction | null {
    return this._state === 'cooking' ? this._action : null;
  }

  get throwType(): 'short' | 'long' {
    return this._action === 'ads' ? 'short' : 'long';
  }

  hold(item: Accessory): boolean {
    if (this._state !== 'weapon') return false;
    this._state = item;
    return true;
  }

  stow(item: Accessory): boolean {
    if (this._state !== item) return false;
    this._state = 'weapon';
    return true;
  }

  startCook(action: CookAction): boolean {
    if (this._state !== 'grenade') return false;
    this._action = action;
    this._timer = 0;
    this._state = 'cooking';
    return true;
  }

  updateCook(dt: number, fuse: number, released: boolean): 'overcooked' | 'committed' | null {
    if (this._state !== 'cooking') return null;
    this._timer += dt;
    if (this._timer >= fuse) {
      this.reset();
      return 'overcooked';
    }
    if (!released) return null;
    this._timer = fuse - this._timer;
    this._state = 'throwing';
    return 'committed';
  }

  dropCooked(fuse: number): number | null {
    if (this._state !== 'cooking') return null;
    this._state = 'grenade';
    return fuse - this._timer;
  }

  /** Mark the release before the caller launches, so late or repeated beats are no-ops. */
  releaseThrow(): number | null {
    if (this._state !== 'throwing') return null;
    this._state = 'released';
    return this._timer;
  }

  finishThrow(): boolean {
    if (this._state !== 'released') return false;
    this.reset();
    return true;
  }

  reset(): void {
    this._state = 'weapon';
  }
}
