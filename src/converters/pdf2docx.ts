import { boundedExecFile as execFileOriginal } from "../helpers/boundedExec";
import { ExecFileFn } from "./types";

/**
 * PDF to Word via pdf2docx.
 *
 * LibreOffice's `writer_pdf_import` treats a PDF page as a drawing canvas and
 * drops every element into an independent text frame, so ruled tables arrive in
 * Word as loose boxes with no borders. pdf2docx analyses the page layout
 * instead and rebuilds real paragraphs, images and bordered tables, which is
 * what a PDF that "looks like a table" is expected to become.
 */
export const properties = {
  from: {
    text: ["pdf"],
  },
  to: {
    text: ["docx"],
  },
};

export async function convert(
  filePath: string,
  fileType: string,
  convertTo: string,
  targetPath: string,
  options?: unknown,
  execFile: ExecFileFn = execFileOriginal,
): Promise<string> {
  // pdf2docx refuses to overwrite, and the target is a fresh work directory entry,
  // but it still expects the destination's directory to exist.
  return new Promise((resolve, reject) => {
    execFile("pdf2docx", ["convert", filePath, targetPath], (err, stdout, stderr) => {
      if (err) {
        reject(`pdf2docx error: ${err}`);
        return;
      }

      if (stdout) {
        console.log(`stdout: ${stdout}`);
      }

      if (stderr) {
        console.error(`stderr: ${stderr}`);
      }

      resolve("Done");
    });
  });
}
