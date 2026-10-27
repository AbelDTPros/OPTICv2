import type { CompiledDefinition } from './compiled-definition.js';

export class DefinitionCache {
  private readonly byReleaseId = new Map<string, CompiledDefinition>();
  private readonly byKeyVersion = new Map<string, string>();
  hits = 0;
  misses = 0;

  peekByReleaseId(releaseId: string): CompiledDefinition | undefined {
    return this.byReleaseId.get(releaseId);
  }

  getByReleaseId(releaseId: string): CompiledDefinition | undefined {
    const compiled = this.peekByReleaseId(releaseId);
    if (compiled) {
      this.hits += 1;
    } else {
      this.misses += 1;
    }
    return compiled;
  }

  peekByCacheKey(cacheKey: string): CompiledDefinition | undefined {
    const releaseId = this.byKeyVersion.get(cacheKey);
    return releaseId ? this.byReleaseId.get(releaseId) : undefined;
  }

  getByCacheKey(cacheKey: string): CompiledDefinition | undefined {
    const compiled = this.peekByCacheKey(cacheKey);
    if (compiled) {
      this.hits += 1;
    } else {
      this.misses += 1;
    }
    return compiled;
  }

  set(compiled: CompiledDefinition): void {
    this.byReleaseId.set(compiled.releaseId, compiled);
    this.byKeyVersion.set(compiled.cacheKey, compiled.releaseId);
  }

  evict(releaseId: string): void {
    const compiled = this.byReleaseId.get(releaseId);
    if (compiled) {
      this.byKeyVersion.delete(compiled.cacheKey);
      this.byReleaseId.delete(releaseId);
    }
  }

  size(): number {
    return this.byReleaseId.size;
  }

  clear(): void {
    this.byReleaseId.clear();
    this.byKeyVersion.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
