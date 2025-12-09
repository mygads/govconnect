declare module 'pdf.js-extract' {
  interface PDFExtractOptions {
    firstPage?: number;
    lastPage?: number;
    password?: string;
    verbosity?: number;
    normalizeWhitespace?: boolean;
    disableCombineTextItems?: boolean;
  }

  interface PDFExtractTextItem {
    x: number;
    y: number;
    str: string;
    dir: string;
    width: number;
    height: number;
    fontName: string;
  }

  interface PDFExtractPage {
    pageInfo: {
      num: number;
      scale: number;
      rotation: number;
      offsetX: number;
      offsetY: number;
      width: number;
      height: number;
    };
    content: PDFExtractTextItem[];
  }

  interface PDFExtractResult {
    filename: string;
    meta: {
      info: Record<string, any>;
      metadata: Record<string, any> | null;
    };
    pages: PDFExtractPage[];
  }

  export class PDFExtract {
    extract(filename: string, options: PDFExtractOptions): Promise<PDFExtractResult>;
    extractBuffer(buffer: Buffer, options: PDFExtractOptions): Promise<PDFExtractResult>;
  }
}
