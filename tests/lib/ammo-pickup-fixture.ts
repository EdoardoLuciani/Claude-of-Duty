import { BoxGeometry } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';

import { AmmoPickups } from '../../src/weapons/ammo-pickups.ts';

export function ammoPickupFixture(
  owner: ConstructorParameters<typeof AmmoPickups>[0]
): AmmoPickups {
  return new AmmoPickups(owner, new BoxGeometry(), new MeshStandardNodeMaterial());
}
