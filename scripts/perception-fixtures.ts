import sharp from "sharp";
/** Synthetic UI only; no user documents, desktops or camera data. */
export async function perceptionFixture(after: boolean) {
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#172133"/><text x="35" y="55" fill="white" font-size="26">Synthetic editing workspace</text><rect x="35" y="90" width="730" height="290" fill="#27334b"/><text x="55" y="145" fill="white" font-size="24">Timeline preview</text><text x="35" y="450" fill="#abc" font-size="20">TEST FIXTURE — NO REAL PROJECT</text>${after ? '<rect x="170" y="145" width="460" height="240" rx="16" fill="#fff"/><text x="210" y="205" fill="#142033" font-size="36">Export Media</text><text x="210" y="255" fill="#142033" font-size="22">Ready to export</text><rect x="435" y="300" width="150" height="45" rx="8" fill="#284ba0"/><text x="470" y="330" fill="white" font-size="24">Export</text>' : ""}</svg>`,
    ),
  )
    .png()
    .toBuffer();
}
