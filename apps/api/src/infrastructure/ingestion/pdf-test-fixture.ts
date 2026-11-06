// A compressed monochrome raster of two synthetic lines for offline OCR tests.
// The image has no embedded text layer, and does not depend on system fonts.
const scannedText = Buffer.from(
  "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" +
  "yyyCK3y38BgzWb4Q==",
  "base64"
);

const portugueseScan = Buffer.from(
  "eJzt1jFu5DYUBuCnncBsFsvWRWBeY4tgXpEi58gNst0WhihjgjBFkDlCrqKBgEy5VyCjC1DdC0Dwj0nJs0ayiGZjINhCf2FY9nC+scX/icCWLV" +
  "u2bNmyZcuWLS+JWLiPF7eXb82nXpy5fP1wWfk8n1zwD42r9me98Ndou5dopmrT9RrpF2uhXgyyruW3L9H0c+2KxXnPn9SuiqjP1D6u/PK1b/9X" +
  "7Xs4PKDjaJDpLTzwgKRgINGixzjkHTAFHGDyHUeGZ/Rl4Xsr5SMppDs+ZjZHhayv0DLZjjtVNTKZrG+K1ptMZmwiAVOXCDrfca9KA4iB/tb2O0" +
  "AI8aZqvzSIzZr2A5yQ6Zh2RcukhbgnayCdFtJ/7DwxpkaIdd5zt8ukUqlcR5YaIJL1r6r2M1lPa9p762KrQzan0rfELrbmEItmnFjldydhxCYm" +
  "c0x71qfEB2EFqN5qD/jEp1i1TvgUV+5l0Tx0SByqZs8RWqei8RDhvHWZETlk41LLJogdxB4A7VsTgSEbJ1U7JHaJV7R7dgEuJDvN2hBw1IkNxI" +
  "4Tzh4uG0Q7QJ9TuzdRMEYMyCa2LGUbG5dmLZtjXtNa4wacQ37SEHD8bdbChHPAh6JhwPEs7d4gYZwwIrNUzUEfc9UcjM4rxZFWV60O5nLfMAKo" +
  "Wilh+UXVznCDZC5bfAwISCwWVTvqi2ZWNVu0IdSCD5L0M20C3JPm4EbJvCsz4KJF4HjRjtBmbSiIde5c3iA1RctUBwotWlQB6IrWkRpj5o4hu4" +
  "AJiZPNVIqgzUUjWtUOs9ZVDWQGwC9aJhUQadHClGu7L1r/N+3NFdpQtUzvqubVAHSvZ02ac0B/s2hTyCxNovFJo7efr4WqJV13CfJuAHbLfYt8" +
  "DnhY7humMTNIzJPWKin3DebZfVuJWF93SeJZwzAAetFC2ZPuSZOiRbFPe/KeZ63sknStFqsmdtHCiN/N0oCq6aUBkCHz45NhbkBeNHfRSgPWNV" +
  "Glb2LLGJJK/LRo41gaoJd2OznnPUtEWNp9X5Y89u24aPmKdltRZXKJ9VWzIeBXI3WWDLOWZk2n7/LeSMRpmVxVG6DL5JKqHde1pMpUFtvPs2SM" +
  "eGMi16kcoAK0FK2oKu9NjHiYp3K8Zw+cshmEnVw5lW1WsdUxcVc1c5DWaF80o3wqf3csmk8m6cwqiG2WJ8696coTx5wiH3x54thTtG5VEzLxa6" +
  "J5lighptpu0rE0uavtjsRZZ+4aoWZ+mn7VEtnyc0/cv2LTETytalCJbLwrVS2zRJdzww3Xk4LQENDvipbIZlNmSaJ39aTgX1u6teWkIDfs37D5" +
  "sZ4UVrVyCkqP/4h5llg8IO5NOQUhqzFAjC7j91BrLAbNNJ+CvrF9ssAO+Y7Tno1TyGpF+5fPcfUr52fof3U2bdM2bcuWLVu2bNnyJeYvN0WxeA" +
  "==",
  "base64"
);

function stream(dictionary: string, bytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`),
    bytes,
    Buffer.from("\nendstream")
  ]);
}

/** A string creates a text-native page, and null or a language option creates a scan. */
export function makePdf(pages: ReadonlyArray<string | null | { scan: "pt" }>): Buffer {
  const pageIds = pages.map((_, index) => 6 + index * 2);
  const objects: Array<string | Buffer> = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    stream("/Type /XObject /Subtype /Image /Width 880 /Height 136 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode", scannedText),
    stream("/Type /XObject /Subtype /Image /Width 880 /Height 80 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode", portugueseScan)
  ];
  pages.forEach((text, index) => {
    const pageId = pageIds[index]!;
    const content = typeof text === "string"
      ? `BT /F1 16 Tf 42 690 Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`
      : text === null
        ? "q 528 0 0 81.6 42 610 cm /Scan Do Q"
        : "q 528 0 0 48 42 648 cm /ScanPt Do Q";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Scan 4 0 R /ScanPt 5 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
      stream("", Buffer.from(content))
    );
  });

  const parts = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let size = parts[0]!.length;
  objects.forEach((object, index) => {
    offsets.push(size);
    const block = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      Buffer.from(object),
      Buffer.from("\nendobj\n")
    ]);
    size += block.length;
    parts.push(block);
  });
  parts.push(Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`
  ));
  return Buffer.concat(parts);
}

export function makeScannedPdf(language: "en" | "pt" = "en"): Buffer {
  return makePdf([language === "pt" ? { scan: "pt" } : null]);
}
