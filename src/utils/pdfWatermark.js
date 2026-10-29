import { COPYRIGHT_AUTHORS_STRING, COPYRIGHT_YEAR } from './copyright.js';

/**
 * Applies official copyright watermark and attribution footer to every page of a jsPDF document.
 *
 * @param {import('jspdf').jsPDF} doc - The jsPDF document instance
 */
export function addPdfWatermark(doc) {
  if (!doc) return;
  const totalPages = doc.internal?.getNumberOfPages ? doc.internal.getNumberOfPages() : doc.getNumberOfPages();
  const pageWidth = doc.internal?.pageSize?.getWidth() || 595.28;
  const pageHeight = doc.internal?.pageSize?.getHeight() || 841.89;
  const centerX = pageWidth / 2;
  const centerY = pageHeight / 2;

  const watermarkPrimary = `Copyright © ${COPYRIGHT_YEAR} ${COPYRIGHT_AUTHORS_STRING}`;
  const watermarkSecondary = 'ProcureFlow — All Rights Reserved · Proprietary Institutional System';
  const footerNotice = `Copyright © ${COPYRIGHT_YEAR} ${COPYRIGHT_AUTHORS_STRING}. All Rights Reserved.`;

  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);

    // Save current styling state
    const originalFont = doc.getFont();
    const originalFontSize = doc.getFontSize();
    const originalTextColor = doc.getTextColor();

    // 1. Semi-transparent diagonal watermark across the page center
    if (typeof doc.GState === 'function') {
      const gs = new doc.GState({ opacity: 0.11 });
      doc.setGState(gs);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(140, 150, 165);
    doc.text(watermarkPrimary, centerX, centerY - 10, {
      align: 'center',
      angle: -38,
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(watermarkSecondary, centerX, centerY + 10, {
      align: 'center',
      angle: -38,
    });

    // Reset GState opacity
    if (typeof doc.GState === 'function') {
      const gsReset = new doc.GState({ opacity: 1.0 });
      doc.setGState(gsReset);
    }

    // 2. Clear running copyright footer notice on every page
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(footerNotice, centerX, 828, { align: 'center' });

    // Restore prior doc state
    doc.setFont(originalFont.fontName, originalFont.fontStyle);
    doc.setFontSize(originalFontSize);
    if (typeof originalTextColor === 'string') {
      doc.setTextColor(originalTextColor);
    }
  }
}
