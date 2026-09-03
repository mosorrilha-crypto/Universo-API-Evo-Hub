import sharp from 'sharp';

const THUMBNAIL_MAX_WIDTH = 640;
const THUMBNAIL_MAX_HEIGHT = 800;
const THUMBNAIL_JPEG_QUALITY = 72;

/**
 * Gera uma miniatura leve (JPEG, recortada em 4:5) a partir da foto de
 * exemplo de um produto — a foto original (hoje no Storage via
 * `knowledgeBaseImageStore.ts`, antes inline em `exampleImageBase64`) só é
 * usada pra o agente mandar por WhatsApp; nunca foi pensada pra ir num
 * payload público servido a qualquer visitante. Comprimida, cada miniatura
 * fica na casa de poucas dezenas de KB — prática de mostrar no catálogo
 * público e no PDF sem inflar o carregamento da página nem o arquivo baixado.
 *
 * TASK-0218: recebe o binário já resolvido (Buffer), não mais um Base64 —
 * quem chama é responsável por buscar a foto (Storage ou fallback legado, via
 * `resolveKnowledgeBaseImageBinary`) antes de comprimir, evitando um
 * round-trip buffer→base64→buffer desnecessário.
 *
 * 4:5 (não 4:3) de propósito: as fotos reais são tiradas na vertical, tipo
 * celular (ex: 900x1600, ~9:16) — um recorte 4:3 (paisagem) exigia cortar
 * mais da metade da altura da foto, e o resultado real (achado no catálogo
 * em produção) cortava a sobrancelha/lábio fora e sobrava só cabelo/testa.
 * 4:5 é o mesmo padrão de retrato do Instagram — exige um corte bem menor,
 * reduzindo bastante o risco de cortar o que interessa na foto.
 */
export async function buildCatalogThumbnail(imageBuffer: Buffer | undefined): Promise<string | undefined> {
  if (!imageBuffer || imageBuffer.length === 0) return undefined;
  try {
    const resized = await sharp(imageBuffer)
      .resize(THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: THUMBNAIL_JPEG_QUALITY })
      .toBuffer();
    return `data:image/jpeg;base64,${resized.toString('base64')}`;
  } catch {
    // Imagem corrompida/formato não suportado — o catálogo segue sem foto
    // pra esse produto em vez de derrubar a página inteira.
    return undefined;
  }
}
