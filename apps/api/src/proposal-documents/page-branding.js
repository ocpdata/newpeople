import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright-core";

const CHROME_EXECUTABLE_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function dataImageToBuffer(value) {
  const match = String(value || "").match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!match) return null;
  return { type: match[1].toLowerCase().startsWith("jp") ? "jpg" : "png", buffer: Buffer.from(match[2], "base64") };
}

async function resolveImageSource(value) {
  const dataSource = dataImageToBuffer(value);
  if (dataSource) return dataSource;
  const source = String(value || "").trim();
  if (source.startsWith("data:image/") || /^https?:\/\//i.test(source)) {
    try {
      const browser = await chromium.launch({ executablePath: CHROME_EXECUTABLE_PATH, headless: true, args: ["--no-sandbox"] });
      const page = await browser.newPage({ viewport: { width: 240, height: 90 }, deviceScaleFactor: 2 });
      await page.setContent(`<img id="logo" src="${source.replaceAll('"', '&quot;')}" style="max-width:240px;max-height:90px;object-fit:contain" />`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => {
        const image = document.querySelector("#logo");
        return image?.complete && image.naturalWidth > 0;
      }, null, { timeout: 10000 });
      const image = await page.locator("#logo").screenshot({ type: "png" });
      await browser.close();
      return { type: "png", buffer: image };
    } catch {
      return null;
    }
  }
  return null;
}

async function embedImage(pdf, source) {
  return source.type === "png"
    ? pdf.embedPng(source.buffer)
    : pdf.embedJpg(source.buffer);
}

export async function addProposalCoverLogos(buffer, { companyLogoUrl, clientLogoUrl } = {}) {
  const [companySource, clientSource] = await Promise.all([
    resolveImageSource(companyLogoUrl),
    resolveImageSource(clientLogoUrl),
  ]);
  if (!companySource && !clientSource) return buffer;

  const pdf = await PDFDocument.load(buffer);
  const page = pdf.getPage(0);
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const logos = [
    { source: companySource, x: 54 },
    { source: clientSource, x: null },
  ];

  for (const logo of logos) {
    if (!logo.source) continue;
    const image = await embedImage(pdf, logo.source);
    const scale = Math.min(128 / image.width, 42 / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      x: logo.x === null ? pageWidth - 54 - width : logo.x,
      y: pageHeight - 64 - height,
      width,
      height,
      opacity: 0.96,
    });
  }

  return Buffer.from(await pdf.save());
}

export async function addInstitutionalLogo(buffer, logoUrl, { skipFirstPage = true } = {}) {
  const source = await resolveImageSource(logoUrl);
  if (!source) return buffer;
  const pdf = await PDFDocument.load(buffer);
  const image = await embedImage(pdf, source);
  const totalPages = pdf.getPageCount();
  const maxWidth = 112;
  const maxHeight = 32;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;

  for (let index = skipFirstPage ? 1 : 0; index < totalPages; index += 1) {
    const page = pdf.getPage(index);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    page.drawImage(image, {
      x: pageWidth - 54 - width,
      y: pageHeight - 24 - height,
      width,
      height,
      opacity: 0.92,
    });
  }
  return Buffer.from(await pdf.save());
}
