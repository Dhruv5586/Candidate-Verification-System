import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { logger } from '../utils/logger';

export interface ExtractionResult {
  text: string;
  status: 'completed' | 'unreadable' | 'failed';
  parserName: string;
  parserVersion: string;
  data: Record<string, any>;
}

const MAX_EXTRACTED_CHARS = 250000; // Limit extracted text size to protect memory

export class ExtractionService {
  /**
   * Extract plain text from PDF or DOCX buffer safely without executing macros or scripts.
   */
  public async extractText(
    buffer: Buffer,
    originalFileName: string
  ): Promise<ExtractionResult> {
    const ext = path.extname(originalFileName).toLowerCase();

    if (ext === '.pdf') {
      return this.extractFromPdf(buffer);
    } else if (ext === '.docx') {
      return this.extractFromDocx(buffer);
    }

    return {
      text: '',
      status: 'unreadable',
      parserName: 'unsupported',
      parserVersion: '1.0.0',
      data: { error: `Unsupported extension: ${ext}` },
    };
  }

  private async extractFromPdf(buffer: Buffer): Promise<ExtractionResult> {
    try {
      let cleanText = '';
      let numPages = 1;

      // Support pdf-parse v2 (PDFParse class) and v1 (function)
      const parseLib = pdfParse as any;
      if (parseLib.PDFParse) {
        try {
          const parser = new parseLib.PDFParse({ data: buffer });
          const textResult = await parser.getText();
          cleanText = typeof textResult === 'string' ? textResult.trim().slice(0, MAX_EXTRACTED_CHARS) : (textResult?.text || '').trim().slice(0, MAX_EXTRACTED_CHARS);
          numPages = textResult?.total || 1;
        } catch (_) {}
      }

      if (!cleanText && typeof parseLib === 'function') {
        try {
          const data = await parseLib(buffer, { max: 50 });
          cleanText = data.text ? data.text.trim().slice(0, MAX_EXTRACTED_CHARS) : '';
          numPages = data.numpages || 1;
        } catch (_) {}
      } else if (!cleanText && typeof parseLib.default === 'function') {
        try {
          const data = await parseLib.default(buffer, { max: 50 });
          cleanText = data.text ? data.text.trim().slice(0, MAX_EXTRACTED_CHARS) : '';
          numPages = data.numpages || 1;
        } catch (_) {}
      }

      // Fallback: extract plain text strings from buffer if stream is readable
      if (!cleanText) {
        const rawString = buffer.toString('binary');
        const matches = rawString.match(/\(([^()]{2,})\)\s*Tj/g) || rawString.match(/BT[\s\S]*?ET/g);
        if (matches && matches.length > 0) {
          cleanText = matches
            .map((m) => m.replace(/[\(\)Tj\n\r]/g, ' ').trim())
            .filter((s) => s.length > 2)
            .join(' ')
            .slice(0, MAX_EXTRACTED_CHARS);
        }
      }

      if (!cleanText) {
        return {
          text: '',
          status: 'unreadable',
          parserName: 'pdf-parse',
          parserVersion: '2.4.5',
          data: { pages: numPages, reason: 'Empty text content' },
        };
      }

      return {
        text: cleanText,
        status: 'completed',
        parserName: 'pdf-parse',
        parserVersion: '2.4.5',
        data: {
          numPages,
        },
      };
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to parse PDF document');
      return {
        text: '',
        status: 'failed',
        parserName: 'pdf-parse',
        parserVersion: '2.4.5',
        data: { error: err.message },
      };
    }
  }

  private async extractFromDocx(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      const cleanText = result.value ? result.value.trim().slice(0, MAX_EXTRACTED_CHARS) : '';

      if (!cleanText) {
        return {
          text: '',
          status: 'unreadable',
          parserName: 'mammoth',
          parserVersion: '1.8.0',
          data: { messages: result.messages, reason: 'Empty text content' },
        };
      }

      return {
        text: cleanText,
        status: 'completed',
        parserName: 'mammoth',
        parserVersion: '1.8.0',
        data: {
          warningMessages: result.messages || [],
        },
      };
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to parse DOCX document');
      return {
        text: '',
        status: 'failed',
        parserName: 'mammoth',
        parserVersion: '1.8.0',
        data: { error: err.message },
      };
    }
  }
}

export const extractionService = new ExtractionService();
