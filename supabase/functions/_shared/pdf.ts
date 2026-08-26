import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1?target=deno";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const PAGE_SIZE = 1200;
const JPEG_QUALITY = 85;

async function fetchImageBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Falha ao baixar imagem ${url}: HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

// Downscales + crops to an exact PAGE_SIZE x PAGE_SIZE JPEG ("cover" fit,
// centered) *before* handing it to pdf-lib. UpSeller photos can be several
// MB / large-dimension PNGs — embedding those directly blew past the Edge
// Function's memory/CPU budget on multi-photo products (WORKER_RESOURCE_LIMIT).
// Composited onto white first since JPEG has no alpha channel.
async function toCoverSquareJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  const decoded = await Image.decode(bytes);

  const scale = Math.max(PAGE_SIZE / decoded.width, PAGE_SIZE / decoded.height);
  const targetWidth = Math.round(decoded.width * scale);
  const targetHeight = Math.round(decoded.height * scale);
  decoded.resize(targetWidth, targetHeight);

  const x = Math.round((targetWidth - PAGE_SIZE) / 2);
  const y = Math.round((targetHeight - PAGE_SIZE) / 2);
  decoded.crop(x, y, PAGE_SIZE, PAGE_SIZE);

  const canvas = new Image(PAGE_SIZE, PAGE_SIZE);
  canvas.fill(Image.rgbaToColor(255, 255, 255, 255));
  canvas.composite(decoded, 0, 0);

  return await canvas.encodeJPEG(JPEG_QUALITY);
}

export async function buildSquarePdf(imageUrls: string[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  if (imageUrls.length === 0) {
    pdfDoc.addPage([PAGE_SIZE, PAGE_SIZE]);
    return await pdfDoc.save();
  }

  for (const url of imageUrls) {
    const rawBytes = await fetchImageBytes(url);
    const jpegBytes = await toCoverSquareJpeg(rawBytes);
    const image = await pdfDoc.embedJpg(jpegBytes);

    const page = pdfDoc.addPage([PAGE_SIZE, PAGE_SIZE]);
    page.drawImage(image, { x: 0, y: 0, width: PAGE_SIZE, height: PAGE_SIZE });
  }

  return await pdfDoc.save();
}
