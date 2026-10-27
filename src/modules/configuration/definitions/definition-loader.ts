import { notFound } from '../../../platform/errors/app-error.js';
import { log } from '../../../platform/logging/logger.js';
import type { DefinitionRelease } from '../domain/types.js';
import type { DefinitionRepository } from '../persistence/definition.repository.js';
import { assembleDefinitionRelease } from '../service/assemble-release.js';
import {
  toCompiledSummary,
  type CompiledDefinition,
  type CompiledDefinitionSummary
} from './compiled-definition.js';
import { DefinitionCache } from './definition-cache.js';
import { definitionCacheKey, isImmutableRelease, validateCompiledDefinition } from './definition-validator.js';
import { compileRuleExpressions } from '../../../rules/compile-rules.js';
import { compileBusinessSchema } from './schema-compiler.js';

export class DefinitionLoader {
  constructor(
    private readonly repository: DefinitionRepository,
    private readonly cache = new DefinitionCache()
  ) {}

  getCache(): DefinitionCache {
    return this.cache;
  }

  async loadByReleaseId(releaseId: number | string): Promise<CompiledDefinition> {
    const cached = this.cache.getByReleaseId(String(releaseId));
    if (cached) {
      this.logCache('info', 'Definition cache hit', {
        event: 'definition.cache_hit',
        cacheKey: cached.cacheKey,
        releaseId: cached.releaseId
      });
      return cached;
    }
    const record = await this.repository.findReleaseById(Number(releaseId));
    if (!record) {
      throw notFound('OPTIC-CONFIG-40402', `Release ${releaseId} was not found.`);
    }
    const assembled = await assembleDefinitionRelease(this.repository, record);
    return this.compileAndMaybeCache(assembled, false);
  }

  async loadByKeyVersion(definitionKey: string, version: string): Promise<CompiledDefinition> {
    const cacheKey = definitionCacheKey(definitionKey, version);
    const cached = this.cache.getByCacheKey(cacheKey);
    if (cached) {
      this.logCache('info', 'Definition cache hit', {
        event: 'definition.cache_hit',
        cacheKey,
        releaseId: cached.releaseId
      });
      return cached;
    }
    const record = await this.repository.findReleaseByKeyAndVersion(definitionKey, version);
    if (!record) {
      throw notFound('OPTIC-CONFIG-40402', `Release ${definitionKey} ${version} was not found.`);
    }
    const assembled = await assembleDefinitionRelease(this.repository, record);
    return this.compileAndMaybeCache(assembled, false);
  }

  compile(release: DefinitionRelease): CompiledDefinition {
    return this.compileAndMaybeCache(release, true);
  }

  async summarizeByKeyVersion(definitionKey: string, version: string): Promise<CompiledDefinitionSummary> {
    const cacheKey = definitionCacheKey(definitionKey, version);
    const alreadyCached = Boolean(this.cache.peekByCacheKey(cacheKey));
    const compiled = await this.loadByKeyVersion(definitionKey, version);
    return toCompiledSummary(compiled, alreadyCached);
  }

  private compileAndMaybeCache(release: DefinitionRelease, fromMemory: boolean): CompiledDefinition {
    validateCompiledDefinition(release);
    const schema = compileBusinessSchema(release.schema);
    const compiledRegexes = compileRuleExpressions(release);
    const compiled: CompiledDefinition = {
      releaseId: release.id,
      definitionKey: release.definitionKey,
      version: release.version,
      lifecycleStatus: release.lifecycleStatus,
      rowVersion: release.rowVersion,
      cacheKey: definitionCacheKey(release.definitionKey, release.version),
      release,
      schema,
      compiledRegexes
    };

    if (isImmutableRelease(release.lifecycleStatus)) {
      this.cache.set(compiled);
      this.logCache('info', fromMemory ? 'Compiled definition cached' : 'Definition loaded and cached', {
        event: 'definition.cache_store',
        cacheKey: compiled.cacheKey,
        releaseId: compiled.releaseId,
        lifecycleStatus: compiled.lifecycleStatus
      });
    } else {
      this.logCache('info', 'Compiled DRAFT definition without long-lived cache', {
        event: 'definition.compiled_uncached',
        cacheKey: compiled.cacheKey,
        releaseId: compiled.releaseId,
        rowVersion: compiled.rowVersion
      });
    }

    return compiled;
  }

  private logCache(level: 'info', message: string, fields: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    log(level, message, fields);
  }
}
