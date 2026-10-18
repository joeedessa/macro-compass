// Text of a PDF, page by page, via macOS PDFKit (no install needed).
//   swift scripts/report/pdftext.swift report.pdf > report.txt
import PDFKit
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let doc = PDFDocument(url: url) else { print("open failed"); exit(1) }
for i in 0..<doc.pageCount { print("=====PAGE \(i+1)"); print(doc.page(at: i)?.string ?? "") }
