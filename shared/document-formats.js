const mb = 1024 * 1024;

export const DOCUMENT_FORMATS = {
  ".pdf": { maxBytes: 20 * mb, kind: "pdf", mimeTypes: ["application/pdf"] },
  ".docx": { maxBytes: 15 * mb, kind: "docx", mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  ".xlsx": { maxBytes: 10 * mb, kind: "spreadsheet", mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
  ".xls": { maxBytes: 10 * mb, kind: "spreadsheet", mimeTypes: ["application/vnd.ms-excel"] },
  ".csv": { maxBytes: 5 * mb, kind: "spreadsheet", mimeTypes: ["text/csv", "application/vnd.ms-excel", "text/plain"] },
  ".txt": { maxBytes: 2 * mb, kind: "text", mimeTypes: ["text/plain"] },
  ".md": { maxBytes: 2 * mb, kind: "text", mimeTypes: ["text/plain", "text/markdown", "text/x-markdown"] },
  ".eml": { maxBytes: 10 * mb, kind: "text", mimeTypes: ["message/rfc822", "text/plain"] },
  ".png": { maxBytes: 10 * mb, kind: "image", mimeTypes: ["image/png"] },
  ".jpg": { maxBytes: 10 * mb, kind: "image", mimeTypes: ["image/jpeg"] },
  ".jpeg": { maxBytes: 10 * mb, kind: "image", mimeTypes: ["image/jpeg"] },
  ".mp3": { maxBytes: 50 * mb, kind: "audio", mimeTypes: ["audio/mpeg", "audio/mp3"] },
  ".wav": { maxBytes: 50 * mb, kind: "audio", mimeTypes: ["audio/wav", "audio/x-wav", "audio/wave"] },
  ".m4a": { maxBytes: 50 * mb, kind: "audio", mimeTypes: ["audio/mp4", "audio/x-m4a"] },
};

export const LEGACY_DOCUMENT_FORMATS = {
  ".ppt": { maxBytes: 20 * mb, kind: "presentation", mimeTypes: ["application/vnd.ms-powerpoint", "application/mspowerpoint", "application/x-mspowerpoint"] },
  ".pptx": { maxBytes: 20 * mb, kind: "presentation", mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"] },
  ".mp4": { maxBytes: 80 * mb, kind: "audio", mimeTypes: ["video/mp4", "audio/mp4", "application/mp4"] },
};

export const DOCUMENT_FILE_ACCEPT = Object.keys(DOCUMENT_FORMATS).join(",");
export const DOCUMENT_FORMAT_HELP =
  "PDF (20 MB), DOCX (15 MB), XLSX/XLS (10 MB), CSV (5 MB), TXT/MD (2 MB), EML (10 MB), PNG/JPG/JPEG (10 MB), MP3/WAV/M4A (50 MB).";

export const DOCUMENT_MIME_TYPES = [
  ...new Set([
    ...Object.values({ ...DOCUMENT_FORMATS, ...LEGACY_DOCUMENT_FORMATS })
      .flatMap((format) => format.mimeTypes),
    "application/octet-stream",
  ]),
];
