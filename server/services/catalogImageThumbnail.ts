import sharp from 'sharp';

const THUMBNAIL_MAX_WIDTH = 640;
const THUMBNAIL_MAX_HEIGHT = 480;
const THUMBNAIL_JPEG_QUALITY = 72;

/**
 * Gera uma miniatura leve (JPEG, recortada em 640x480) a partir da foto de
 * exemplo de um produto (`AgentProduct.exampleImageBase64`) — essa foto
 * original é guardada inline no jsonb sem limite de tamanho (já chegou a
 * ~3MB em base64 num produto real) porque hoje só é usada pra o agente
 * mandar por WhatsApp; nunca foi pensada pra ir num payload público servido
 * a qualquer visitante. Comprimida, cada miniatura fica na casa de
 * poucas dezenas de KB — prática de mostrar no catálogo público e no PDF
 * sem inflar o carregamento da página nem o arquivo baixado.
 */
export async function buildCatalogThumbnail(exampleImageBase64: string | undefined): Promise<string | undefined> {
  if (!exampleImageBase64) return undefined;
  try {
    const rawBase64 = exampleImageBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(rawBase64, 'base64');
    const resized = await sharp(buffer)
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
