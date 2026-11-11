// Extract text from a PDF File using the bundled pdf.js. Rebuilds line breaks from item positions
// so the syllabus parser can see headings and bullet lines.
import * as pdfjs from '../vendor/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.mjs');

export async function pdfToText(file, { maxPages = 40 } = {}) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const pages = Math.min(doc.numPages, maxPages);
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let lastY = null;
    let line = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        out.push(line);
        line = '';
      }
      line += (line && !line.endsWith(' ') && item.str && !item.str.startsWith(' ') ? ' ' : '') + item.str;
      if (item.hasEOL) {
        out.push(line);
        line = '';
        lastY = null;
        continue;
      }
      lastY = y;
    }
    if (line) out.push(line);
    out.push('');
  }
  await doc.destroy();
  const text = out.map((l) => l.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, pages: doc.numPages, truncated: doc.numPages > maxPages };
}
