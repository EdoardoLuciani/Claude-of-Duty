export interface PoolRecord<Node extends HTMLElement | null = HTMLElement> {
  node: Node;
  alive: boolean;
  t: number;
  life: number;
  i: number;
  a: number;
  b: number;
  c: number;
  d: number;
  s: string;
}
export interface ElementPool<Node extends HTMLElement | null = HTMLElement> {
  items: PoolRecord<Node>[];
  acquire(): PoolRecord<Node>;
  release(item: PoolRecord<Node>): void;
  releaseAll(): void;
}
