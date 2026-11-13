declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(value: unknown): Expectation;
}

type Expectation = {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toHaveLength(length: number): void;
  toBeGreaterThan(value: number): void;
  toContain(value: unknown): void;
};
