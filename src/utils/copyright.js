/**
 * ProcureFlow Intellectual Property & Statutory Copyright Specification
 *
 * Authors & Copyright Holders:
 * Anish Mogam, Madhura Lakade and Isha Joshi
 */

export const COPYRIGHT_AUTHORS = ['Anish Mogam', 'Madhura Lakade', 'Isha Joshi'];
export const COPYRIGHT_AUTHORS_STRING = 'Anish Mogam, Madhura Lakade and Isha Joshi';
export const COPYRIGHT_YEAR = String(new Date().getFullYear());
export const COPYRIGHT_SYSTEM_NAME = 'ProcureFlow';

export const COPYRIGHT_SHORT = `Copyright © ${COPYRIGHT_YEAR} ${COPYRIGHT_AUTHORS_STRING}. All Rights Reserved.`;
export const COPYRIGHT_WATERMARK_PRIMARY = `Copyright © ${COPYRIGHT_YEAR} ${COPYRIGHT_AUTHORS_STRING}`;
export const COPYRIGHT_WATERMARK_SECONDARY = `${COPYRIGHT_SYSTEM_NAME} — All Rights Reserved · Proprietary System`;

export const COPYRIGHT_NOTICE_PARAGRAPHS = [
  'All Rights Reserved.',
  'ProcureFlow and this repository, including all source code, software architecture, documentation, user interfaces, designs, graphics, workflows, databases, configurations, and associated files, are proprietary works developed by Anish Mogam, Madhura Lakade and Isha Joshi.',
  'These works are protected under the Copyright Act, 1957, as amended, including protection applicable to computer programs and software as literary works under Section 2(o), subject to the ownership and authorship rights applicable to the work.',
  'The copyright holders reserve the rights provided under the Copyright Act, 1957, including the exclusive rights to reproduce, issue copies, adapt, modify, translate, distribute, communicate, publish, license, and commercially exploit the protected work, subject to applicable law.',
  'No permission is granted to copy, reproduce, modify, adapt, translate, distribute, publish, sublicense, sell, lease, reverse engineer, create derivative works from, or use any part of this repository or its contents for personal, educational, institutional, commercial, or any other purpose without prior written permission from all authorized copyright holders.',
  'Access to, demonstration of, or public availability of this repository does not grant any ownership rights, licence, or permission to use, reuse, redistribute, modify, or commercially exploit the software or any part of its contents.',
  'Any access provided to a third party is strictly limited to the purpose expressly authorized in writing. Such access does not constitute a transfer or assignment of copyright, source-code ownership, intellectual-property rights, or any other proprietary rights.',
  'No part of this repository may be used to develop, reproduce, operate, distribute, or commercialize a substantially similar product or service without prior written authorization from the copyright holders.',
  'All rights not expressly granted are reserved.',
  'Unauthorized copying, disclosure, distribution, modification, publication, reverse engineering, or use may constitute copyright infringement and breach of confidentiality and may result in legal action and claims for injunctive relief, damages, and other remedies available under applicable law.',
];

export const COPYRIGHT_NOTICE_FULL = `Copyright © ${COPYRIGHT_YEAR} ${COPYRIGHT_AUTHORS_STRING}\n\n` +
  COPYRIGHT_NOTICE_PARAGRAPHS.join('\n\n');
