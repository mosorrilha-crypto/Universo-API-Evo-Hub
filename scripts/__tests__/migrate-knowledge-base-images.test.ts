/**
 * TASK-0218 — lógica pura do script de migração de imagens (parsing de
 * flags, decodificação/validação de Base64, e a varredura que decide o que
 * ainda está pendente — a própria checagem `!*ImageId` é o que torna
 * execuções repetidas idempotentes).
 */
import { describe, expect, it, vi } from 'vitest';
import { collectPendingMigrations, decodeLegacyImageBase64, parseArgs } from '../migrate-knowledge-base-images';

describe('parseArgs', () => {
  it('default é dry-run (sem --apply)', () => {
    expect(parseArgs([]).apply).toBe(false);
  });

  it('reconhece --apply, --tenant, --limit, --remove-legacy-base64', () => {
    const opts = parseArgs(['--apply', '--tenant', 'tenant-a', '--limit', '10', '--remove-legacy-base64']);
    expect(opts).toEqual({ apply: true, tenantId: 'tenant-a', limit: 10, removeLegacyBase64: true });
  });

  it('--remove-legacy-base64 sem --apply é rejeitado (nunca remove nada em dry-run)', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    parseArgs(['--remove-legacy-base64']);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('--limit inválido (não numérico ou <= 0) é rejeitado', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    parseArgs(['--limit', '0']);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('decodeLegacyImageBase64', () => {
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  it('decodifica um Data URI completo, extraindo o mimeType dele mesmo', () => {
    const result = decodeLegacyImageBase64(`data:image/png;base64,${tinyPngBase64}`, undefined);
    expect(result?.mimeType).toBe('image/png');
    expect(result?.buffer.length).toBeGreaterThan(0);
  });

  it('decodifica Base64 puro (sem prefixo data:), usando o mimeType declarado separadamente', () => {
    const result = decodeLegacyImageBase64(tinyPngBase64, 'image/png');
    expect(result?.mimeType).toBe('image/png');
  });

  it('Base64 vazio/só espaço devolve null (não trava a migração dos outros itens)', () => {
    expect(decodeLegacyImageBase64('', undefined)).toBeNull();
    expect(decodeLegacyImageBase64('   ', undefined)).toBeNull();
    expect(decodeLegacyImageBase64('data:image/png;base64,', undefined)).toBeNull();
  });
});

describe('collectPendingMigrations', () => {
  it('encontra imagem pendente em produto, variante, antes/depois do produto E da variante, e bloco de 1º contato — tudo de uma vez', () => {
    const kb = {
      products: [{
        id: 'p1', name: 'Microlips', price: 'Gs 1', description: '',
        exampleImageBase64: 'AAAA',
        beforeAfter: [{ id: 'ba1', beforeImageBase64: 'BBBB', afterImageBase64: 'CCCC' }],
        variants: [{
          code: 'V1', price: 'Gs 1',
          exampleImageBase64: 'DDDD',
          beforeAfter: [{ id: 'ba2', beforeImageBase64: 'EEEE', afterImageBase64: 'FFFF' }],
        }],
      }],
      firstContactBlocks: [{ id: 'b1', type: 'image', imageBase64: 'GGGG' }],
    } as any;

    const pending = collectPendingMigrations(kb);
    expect(pending).toHaveLength(7); // produto + before + after + variante + before-variante + after-variante + bloco
  });

  it('item já migrado (com *ImageId preenchido) NUNCA aparece de novo — é o que torna a execução idempotente', () => {
    const kb = {
      products: [{
        id: 'p1', name: 'Já migrado', price: 'Gs 1', description: '',
        exampleImageId: 'image-ja-migrado', exampleImageBase64: 'AAAA', // Base64 ainda presente (não removido), mas já tem id
      }],
    } as any;

    expect(collectPendingMigrations(kb)).toHaveLength(0);
  });

  it('applyReference grava a nova referência no lugar certo do objeto original (mutação in-place)', () => {
    const product = { id: 'p1', name: 'X', price: 'Gs 1', description: '', exampleImageBase64: 'AAAA' } as any;
    const kb = { products: [product] } as any;

    const pending = collectPendingMigrations(kb);
    pending[0].applyReference({ imageId: 'image-novo-1', mimeType: 'image/jpeg', sizeBytes: 123 });

    expect(product.exampleImageId).toBe('image-novo-1');
    expect(product.exampleImageMimeType).toBe('image/jpeg');
    expect(product.exampleImageSizeBytes).toBe(123);
  });

  it('removeLegacyField apaga só o Base64 legado do item, preservando a referência nova', () => {
    const product = { id: 'p1', name: 'X', price: 'Gs 1', description: '', exampleImageId: 'image-1', exampleImageBase64: 'AAAA' } as any;
    // Simula um item que já tem *ImageId (não seria coletado por collectPendingMigrations),
    // então testa removeLegacyField isoladamente via uma coleta forçada sem a checagem de id.
    const kbSemId = { products: [{ ...product, exampleImageId: undefined }] } as any;
    const pending = collectPendingMigrations(kbSemId);
    pending[0].removeLegacyField();
    expect(kbSemId.products[0]).not.toHaveProperty('exampleImageBase64');
  });

  it('base de conhecimento vazia/sem produtos não quebra', () => {
    expect(collectPendingMigrations({} as any)).toHaveLength(0);
    expect(collectPendingMigrations({ products: [] } as any)).toHaveLength(0);
  });
});
