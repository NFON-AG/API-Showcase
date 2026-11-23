/* Local vector export. No DOM capture, remote requests or print-dialog dependency. */
(function (global) {
  'use strict';
  const INK = '#202426', MUTED = '#596366', LINE = '#d7e0de';
  function create(model) {
    const font = global.NfonPdfFont;
    if (!global.jspdf?.jsPDF || !font || !model.nodes?.length) throw new Error('PDF unavailable');
    const ink = model.textColor || INK, muted = model.mutedColor || MUTED, line = model.borderColor || LINE;
    const pdf = new global.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true, putOnlyUsedFonts: true });
    pdf.addFileToVFS(font.fileName, font.data);
    pdf.addFont(font.fileName, font.family, font.style);
    pdf.setFont(font.family, font.style);
    pdf.setLineHeightFactor(1.4);
    pdf.setProperties({ title: `${model.overviewTitle} - ${model.number}`, creator: 'NFON Portal API Demo' });
    const width = pdf.internal.pageSize.getWidth(), height = pdf.internal.pageSize.getHeight();
    const margin = 32, bottom = height - margin, contentWidth = width - 2 * margin;
    const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
    const content = [model.overviewTitle, model.detailsTitle, model.continued, model.number,
      ...model.nodes.flatMap(node => [node.type, node.title, ...node.metadata]),
      ...model.labels.map(label => label.text),
      ...model.details.flatMap(node => [node.type, node.title, ...node.metadata, ...node.rows])];
    if (content.some(value => [...clean(value)].some(char => char !== '\n' && !pdf.getFont().metadata.characterToGlyph(char.codePointAt(0))))) {
      const error = new Error('Unsupported PDF font character');
      error.code = 'PDF_FONT_CHARACTER';
      throw error;
    }
    function lines(text, size, available) {
      pdf.setFontSize(size);
      return pdf.splitTextToSize(clean(text), Math.max(available, size * 2));
    }
    function text(value, x, y, size, color = ink) {
      pdf.setFontSize(size).setTextColor(color).text(value, x, y);
    }
    function header(title) {
      text(title, margin, 42, 16);
      pdf.setFontSize(11);
      const numberWidth = pdf.getTextWidth(model.number || '');
      if (numberWidth) text(model.number, width - margin - numberWidth, 42, 11);
      pdf.setDrawColor(model.accent || '#3200c8').setLineWidth(1).line(margin, 56, width - margin, 56);
    }
    header(model.overviewTitle);
    const bounds = model.bounds;
    const scale = Math.min(contentWidth / bounds.width, (bottom - 76) / bounds.height, 0.75);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid diagram bounds');
    const offsetX = margin + (contentWidth - bounds.width * scale) / 2;
    const offsetY = 76 + ((bottom - 76) - bounds.height * scale) / 2;
    const point = (x, y) => [offsetX + (x - bounds.left) * scale, offsetY + (y - bounds.top) * scale];
    let detailsNeeded = 14 * scale < 9 || model.details.some(node => node.rows.length > 0 && node.hasMembers);
    if (model.canvas?.background) {
      pdf.setFillColor(model.canvas.background).rect(offsetX, offsetY, bounds.width * scale, bounds.height * scale, 'F');
      const grid = model.canvas.grid;
      if (grid && [grid.stepX, grid.stepY, grid.radius].every(value => Number.isFinite(value) && value > 0)) {
        // Flatten the CSS dot alpha over the canvas; no raster capture or hover spotlight.
        const rgba = String(grid.color).match(/[\d.]+/g)?.map(Number);
        const background = String(model.canvas.background).match(/[\d.]+/g)?.map(Number);
        if (rgba?.length >= 3 && background?.length >= 3) {
          const alpha = rgba[3] ?? 1;
          pdf.setFillColor(...rgba.slice(0, 3).map((value, index) => value * alpha + background[index] * (1 - alpha)));
          // Keep an overview of a very large flow finite and avoid sub-pixel moire.
          const stepX = grid.stepX * Math.max(1, Math.ceil(6 / (grid.stepX * scale)));
          const stepY = grid.stepY * Math.max(1, Math.ceil(6 / (grid.stepY * scale)));
          const firstX = grid.originX + Math.ceil((bounds.left - grid.originX) / stepX) * stepX;
          const firstY = grid.originY + Math.ceil((bounds.top - grid.originY) / stepY) * stepY;
          pdf.saveGraphicsState();
          pdf.rect(offsetX, offsetY, bounds.width * scale, bounds.height * scale, null).clip().discardPath();
          for (let x = firstX; x <= bounds.left + bounds.width; x += stepX) {
            for (let y = firstY; y <= bounds.top + bounds.height; y += stepY) {
              pdf.circle(...point(x, y), Math.max(0.35, grid.radius * scale), 'F');
            }
          }
          pdf.restoreGraphicsState();
        }
      }
    }
    for (const edge of model.edges) {
      const p = edge.points;
      if (p.length !== 8 || !p.every(Number.isFinite)) throw new Error('Invalid diagram edge');
      const start = point(p[0], p[1]), c1 = point(p[2], p[3]), c2 = point(p[4], p[5]), end = point(p[6], p[7]);
      pdf.setDrawColor(muted).setFillColor(muted).setLineWidth(Math.max(0.5, 2 * scale));
      pdf.path([{ op: 'm', c: start }, { op: 'c', c: [...c1, ...c2, ...end] }]).stroke();
      const angle = Math.atan2(end[1] - c2[1], end[0] - c2[0]);
      const length = 8 * scale, half = 3.5 * scale;
      const x = end[0] - Math.cos(angle) * length, y = end[1] - Math.sin(angle) * length;
      pdf.triangle(end[0], end[1], x - Math.sin(angle) * half, y + Math.cos(angle) * half, x + Math.sin(angle) * half, y - Math.cos(angle) * half, 'F');
    }
    for (const arrow of model.arrows || []) {
      if (![arrow.x, arrow.y, arrow.width, arrow.height, arrow.angle].every(Number.isFinite)) continue;
      const [x, y] = point(arrow.x, arrow.y), angle = arrow.angle * Math.PI / 180;
      pdf.setDrawColor(arrow.borderColor || line).setFillColor(arrow.background || '#ffffff')
        .setLineWidth(Math.max(0.5, (arrow.borderWidth || 1) * scale)).ellipse(x, y, arrow.width * scale / 2, arrow.height * scale / 2, 'FD');
      const rotate = (a, b) => [x + (a * Math.cos(angle) - b * Math.sin(angle)) * scale, y + (a * Math.sin(angle) + b * Math.cos(angle)) * scale];
      pdf.setDrawColor(arrow.color || muted).setLineWidth(Math.max(0.6, 1.5 * scale));
      pdf.line(...rotate(-6, 0), ...rotate(6, 0));
      pdf.line(...rotate(2, -4), ...rotate(6, 0));
      pdf.line(...rotate(2, 4), ...rotate(6, 0));
    }
    for (const label of model.labels) {
      const [x, y] = point(label.x, label.y), size = 14 * scale;
      pdf.setFontSize(size);
      const w = pdf.getTextWidth(clean(label.text)) + 12 * scale, h = 22 * scale;
      pdf.setDrawColor(line).setFillColor('#ffffff').setLineWidth(0.5).rect(x - w / 2, y - h / 2, w, h, 'FD');
      text(clean(label.text), x - w / 2 + 6 * scale, y + size / 3, size);
    }
    for (const node of model.nodes) {
      const [x, y] = point(node.x, node.y), w = node.width * scale, h = node.height * scale, inset = 12 * scale;
      pdf.setDrawColor(node.borderColor || line).setFillColor(node.background || '#ffffff').setLineWidth(0.5).rect(x, y, w, h, 'FD');
      pdf.setDrawColor(node.accent || model.accent || '#3200c8').setLineWidth(2 * scale).line(x, y, x + w, y);
      const parts = [{ value: node.type, size: 14, color: node.typeColor || muted }, { value: node.title, size: 18, color: node.titleColor || ink }, ...node.metadata.map((value, index) => ({ value, size: 14, color: node.metadataColors?.[index] || muted }))];
      const blocks = parts.filter(part => part.value).map(part => ({ ...part, lines: lines(part.value, part.size * scale, w - 2 * inset) }));
      const needed = blocks.reduce((total, block) => total + (block.lines.length * block.size * 1.4 + 6) * scale, 0);
      // Preserve every character in the overview even with long names; details stay at 11pt.
      const fit = Math.min(1, (h - 2 * inset) / Math.max(needed, 1));
      if (14 * scale * fit < 9) detailsNeeded = true;
      let cursor = y + inset;
      for (const block of blocks) {
        const size = block.size * scale * fit;
        cursor += size;
        text(block.lines, x + inset, cursor, size, block.color);
        cursor += (block.lines.length * 1.4 - 1) * size + 6 * scale * fit;
      }
    }
    if (detailsNeeded) {
      let cursor = bottom;
      const newPage = () => { pdf.addPage(); header(model.detailsTitle); cursor = 76; };
      for (const node of model.details) {
        const paragraphs = [
          { value: node.type, size: 11, color: node.typeColor || muted },
          { value: node.title, size: 13, color: node.titleColor || ink },
          ...node.metadata.map(value => ({ value, size: 11, color: muted })),
          ...node.rows.map(value => ({ value, size: 11, color: ink, rule: true })),
        ].filter(item => item.value);
        if (cursor + 100 > bottom) newPage();
        let firstLine = true;
        for (const item of paragraphs) {
          const wrapped = lines(item.value, item.size, contentWidth - 24);
          const lineHeight = item.size * 1.4;
          for (let index = 0; index < wrapped.length; index++) {
            if (cursor + lineHeight + 12 > bottom) {
              newPage();
              pdf.setDrawColor(node.accent || model.accent || '#3200c8').setLineWidth(1).line(margin, cursor, width - margin, cursor);
              const continued = lines(`${node.type} · ${node.title} · ${model.continued}`, 11, contentWidth - 24);
              // A continuation heading stays compact even if a node has a very long name.
              text(continued[0], margin + 12, cursor + 11, 11, muted);
              cursor += 28;
            }
            if (firstLine) {
              pdf.setDrawColor(node.accent || model.accent || '#3200c8').setLineWidth(1).line(margin, cursor, width - margin, cursor);
              cursor += 12;
              firstLine = false;
            } else if (item.rule && index === 0) {
              pdf.setDrawColor(line).setLineWidth(0.5).line(margin + 12, cursor, width - margin - 12, cursor);
              cursor += 5;
            }
            text(wrapped[index], margin + 12, cursor + item.size, item.size, item.color);
            cursor += lineHeight;
          }
          cursor += 6;
        }
        cursor += 16;
      }
    }
    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      pdf.setPage(page);
      text(`${page} / ${pages}`, width - margin - 30, height - 14, 11, muted);
    }
    return new Uint8Array(pdf.output('arraybuffer'));
  }
  global.NfonCallflowPdf = { create };
})(typeof window === 'undefined' ? globalThis : window);
