import AppKit
let directory = CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
  for factor in [1, 2] {
    let pixels = size * factor
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: pixels * 4, bitsPerPixel: 32)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let scale = CGFloat(pixels) / 1024
    NSGraphicsContext.current!.cgContext.scaleBy(x: scale, y: scale)
    NSColor(calibratedRed: 0.07, green: 0.12, blue: 0.09, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 60, y: 60, width: 904, height: 904), xRadius: 215, yRadius: 215).fill()
    NSColor(calibratedRed: 0.77, green: 0.83, blue: 0.72, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 160, y: 160, width: 704, height: 704), xRadius: 180, yRadius: 180).fill()
    let font = NSFont(name: "HelveticaNeue-BoldItalic", size: 700) ?? NSFont.boldSystemFont(ofSize: 700)
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor(calibratedRed: 0.09, green: 0.15, blue: 0.11, alpha: 1)]
    ("a" as NSString).draw(at: NSPoint(x: 300, y: 95), withAttributes: attrs)
    NSGraphicsContext.restoreGraphicsState()
    let data = bitmap.representation(using: .png, properties: [:])!
    let suffix = factor == 2 ? "@2x" : ""
    try data.write(to: URL(fileURLWithPath: "\(directory)/icon_\(size)x\(size)\(suffix).png"))
  }
}
