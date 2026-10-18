// One PDF page rendered to PNG, to read levels printed on the charts
// (last full day, negation) that the report's text leaves out.
//   swift scripts/report/pdfpage.swift report.pdf 1 page1.png
import PDFKit
import AppKit
let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
let page = doc.page(at: Int(CommandLine.arguments[2])! - 1)!
let box = page.bounds(for: .mediaBox)
let scale: CGFloat = 2.0
let img = NSImage(size: NSSize(width: box.width * scale, height: box.height * scale))
img.lockFocus()
NSColor.white.set(); NSRect(origin: .zero, size: img.size).fill()
let ctx = NSGraphicsContext.current!.cgContext
ctx.scaleBy(x: scale, y: scale)
page.draw(with: .mediaBox, to: ctx)
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[3]))
