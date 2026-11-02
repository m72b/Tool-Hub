# Third-party components in the PDF Tools add-on

| Component | Version | License | Used for |
|---|---|---|---|
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.x | MIT (see `pdf-lib-LICENSE.md`) | Creating and editing PDFs |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | 1.1.1 | MIT | Embedding Unicode fonts for OCR text |
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | 3.11.174 | Apache-2.0 (see `pdfjs-LICENSE.txt`) | Rendering pages and reading text |
| [qpdf](https://github.com/qpdf/qpdf) | 11.9.1 | Apache-2.0 | Password protection, unlocking and repair (Windows build bundled) |
| Microsoft Visual C++ runtime DLLs | 14.x | Microsoft redistributable | Required by the bundled qpdf on Windows |

The Apache-2.0 license text is in `pdfjs-LICENSE.txt` and applies to qpdf as well (https://www.apache.org/licenses/LICENSE-2.0).
